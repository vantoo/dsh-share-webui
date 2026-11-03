/**
 * Device pairing for the fixed-port gateway: one short-lived code turns a
 * browser into a named device that owns its own revocable credential. Opening
 * a port therefore stops meaning "hand the harness to whoever can reach it".
 *
 * ⚠️ `lib/pairing.js` is the hand-maintained runtime twin of this module (a
 * standalone clone cannot run the monorepo build, so the shipped artifact is
 * patched in parallel). Keep both files in sync — same order, same names.
 *
 * @module dsh-share-webui/pairing
 */

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Cookie carrying the paired-device credential. */
export const DEVICE_COOKIE = 'dsh-share-device'

/** Lifetime of one pairing code. */
export const CODE_TTL_MS = 10 * 60 * 1_000

/** Sliding window for per-address attempt limiting. */
const ATTEMPT_WINDOW_MS = 5 * 60 * 1_000

/**
 * Wrong guesses one address may make per window. There is deliberately no
 * per-code cap: a global "burn the code" counter would let any unauthenticated
 * peer lock the operator out with a handful of empty submissions.
 */
const MAX_ATTEMPTS_PER_WINDOW = 5

/** How often `lastSeenAt` changes are written back. */
const SAVE_INTERVAL_MS = 60 * 1_000

/** One paired browser, as persisted. */
export interface DeviceRecord {
  /** Short public id (left half of the cookie). */
  id: string
  /** Label captured at pairing time. */
  label: string
  /** Address seen at the last authorized request. */
  address: string
  /** Epoch ms of pairing. */
  createdAt: number
  /** Epoch ms of the most recent authorized request. */
  lastSeenAt: number
  /** Hex SHA-256 of the device secret. */
  secretHash: string
}

/** Device shape exposed to the admin page (no secret material). */
export interface DeviceView {
  /** Short public id. */
  id: string
  /** Label shown to the operator. */
  label: string
  /** Address seen last. */
  address: string
  /** Epoch ms of pairing. */
  createdAt: number
  /** Epoch ms of the most recent authorized request. */
  lastSeenAt: number
}

/** A live pairing code. */
export interface PairingCode {
  /** Six digits. */
  code: string
  /** Epoch ms after which it is dead. */
  expiresAt: number
}

/** Outcome of one claim attempt. */
export type ClaimResult =
  | { readonly ok: true; readonly device: DeviceView; readonly secret: string }
  | { readonly ok: false; readonly reason: 'no-code' | 'mismatch' | 'expired' | 'rate-limited' }

/** SHA-256 of a device secret (the secret is 256-bit, so no stretching needed). */
function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

/** Constant-time string comparison. */
function same(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Random public id. */
function randomId(): string {
  return randomBytes(9).toString('base64url')
}

/** Random 256-bit device secret. */
function randomSecret(): string {
  return randomBytes(32).toString('base64url')
}

/** Strip everything but digits, then trim to the code width. */
function normalizeCode(input: string): string {
  return input.replace(/\D/gu, '').slice(0, 6)
}

/** Narrow one parsed record. */
function isRecord(value: unknown): value is DeviceRecord {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Partial<DeviceRecord>
  return typeof record.id === 'string'
    && typeof record.label === 'string'
    && typeof record.address === 'string'
    && typeof record.createdAt === 'number'
    && typeof record.lastSeenAt === 'number'
    && typeof record.secretHash === 'string'
}

/**
 * Paired devices plus the single live pairing code.
 */
export class DeviceStore {
  /** Persisted devices. */
  private devices: DeviceRecord[] = []

  /** Live code, until it is used, replaced or expired. */
  private code: { code: string; expiresAt: number } | null = null

  /** Per-address wrong-guess timestamps. */
  private readonly attempts = new Map<string, number[]>()

  /** Epoch ms of the last successful write. */
  private savedAt = 0

  /** @param file - JSON file to persist to, or null to stay in memory only. */
  constructor(private readonly file: string | null) {
    this.load()
  }

  /** Devices for the admin page. */
  list(): DeviceView[] {
    return this.devices.map(({ id, label, address, createdAt, lastSeenAt }) => ({ id, label, address, createdAt, lastSeenAt }))
  }

  /** Number of paired devices. */
  get count(): number {
    return this.devices.length
  }

  /** Issue a fresh code, invalidating any previous one. */
  issue(): PairingCode {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    const expiresAt = Date.now() + CODE_TTL_MS
    this.code = { code, expiresAt }
    return { code, expiresAt }
  }

  /**
   * Drop the pending code, if any.
   * @returns whether a live code was discarded.
   */
  cancel(): boolean {
    const had = this.code !== null
    this.code = null
    return had
  }

  /** The code still worth showing, if any. */
  pending(): PairingCode | null {
    if (this.code === null || this.code.expiresAt <= Date.now()) return null
    return { code: this.code.code, expiresAt: this.code.expiresAt }
  }

  /**
   * Redeem a code and mint the device credential that goes with it.
   * @param raw - submitted code.
   * @param address - peer address.
   * @param label - label captured at pairing time.
   */
  claim(raw: string, address: string, label: string): ClaimResult {
    const now = Date.now()
    if (!this.admitted(address, now)) return { ok: false, reason: 'rate-limited' }
    const pending = this.code
    if (pending === null || pending.expiresAt <= now) {
      this.code = null
      return { ok: false, reason: 'no-code' }
    }
    if (normalizeCode(raw) !== pending.code) {
      this.note(address, now)
      return { ok: false, reason: 'mismatch' }
    }
    this.code = null
    const created = this.create(label, address)
    return { ok: true, device: created.device, secret: created.secret }
  }

  /**
   * Remember one device without a pairing code (Cloudflare Access already
   * proved who it is).
   * @param label - label for the device list, usually the Access email.
   * @param address - peer address.
   * @returns the credential to hand back, or null when persistence failed.
   */
  remember(label: string, address: string): { id: string; secret: string } | null {
    const created = this.create(label, address)
    return { id: created.device.id, secret: created.secret }
  }

  /**
   * Append one device record and persist it.
   * @param label - label for the device list.
   * @param address - peer address.
   * @returns the stored device plus its plaintext secret.
   */
  private create(label: string, address: string): { device: DeviceView; secret: string } {
    const now = Date.now()
    const secret = randomSecret()
    const record: DeviceRecord = {
      id: randomId(),
      label: label.trim().slice(0, 120) || 'device',
      address,
      createdAt: now,
      lastSeenAt: now,
      secretHash: hashSecret(secret),
    }
    this.devices.push(record)
    this.save()
    return {
      device: {
        id: record.id,
        label: record.label,
        address: record.address,
        createdAt: record.createdAt,
        lastSeenAt: record.lastSeenAt,
      },
      secret,
    }
  }

  /**
   * Whether a cookie value belongs to a live device.
   * @param value - cookie value (`id.secret`).
   * @param address - peer address.
   */
  verify(value: string | null | undefined, address: string): boolean {
    if (typeof value !== 'string' || value === '') return false
    const cut = value.indexOf('.')
    if (cut <= 0 || cut === value.length - 1) return false
    const id = value.slice(0, cut)
    const secret = value.slice(cut + 1)
    const device = this.devices.find((entry) => entry.id === id)
    if (device === undefined) return false
    if (!same(hashSecret(secret), device.secretHash)) return false
    const now = Date.now()
    device.lastSeenAt = now
    device.address = address
    if (now - this.savedAt > SAVE_INTERVAL_MS) this.save()
    return true
  }

  /**
   * Forget one device.
   * @param id - device id.
   */
  revoke(id: string): boolean {
    const before = this.devices.length
    this.devices = this.devices.filter((entry) => entry.id !== id)
    if (this.devices.length === before) return false
    this.save()
    return true
  }

  /** Load the persisted list; corrupt or missing state degrades to empty. */
  private load(): void {
    if (this.file === null) return
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
      const list = typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { devices?: unknown }).devices)
        ? (parsed as { devices: unknown[] }).devices
        : []
      this.devices = list.filter(isRecord)
    } catch {
      this.devices = []
    }
  }

  /** Write the list back atomically, owner-only. */
  private save(): void {
    this.savedAt = Date.now()
    if (this.file === null) return
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const temporary = `${this.file}.${String(process.pid)}.tmp`
      writeFileSync(temporary, `${JSON.stringify({ version: 1, devices: this.devices }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      renameSync(temporary, this.file)
    } catch (error) {
      console.error(`[dsh-share-webui] could not persist devices: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Prune the attempt window and answer whether this address may try again.
   * @param address - peer address.
   * @param now - current epoch ms.
   */
  private admitted(address: string, now: number): boolean {
    const recent = (this.attempts.get(address) ?? []).filter((at) => now - at < ATTEMPT_WINDOW_MS)
    // Never keep an empty entry: a peer that only ever probes for a code must
    // not grow this map.
    if (recent.length === 0) this.attempts.delete(address)
    else this.attempts.set(address, recent)
    if (this.attempts.size > 256) this.prune(now)
    return recent.length < MAX_ATTEMPTS_PER_WINDOW
  }

  /**
   * Record one wrong guess.
   * @param address - peer address.
   * @param now - current epoch ms.
   */
  private note(address: string, now: number): void {
    const recent = this.attempts.get(address) ?? []
    recent.push(now)
    this.attempts.set(address, recent)
    if (this.attempts.size > 256) this.prune(now)
  }

  /**
   * Drop addresses whose window has fully expired.
   * @param now - current epoch ms.
   */
  private prune(now: number): void {
    for (const [key, value] of this.attempts) {
      if (value.length === 0 || value.every((at) => now - at >= ATTEMPT_WINDOW_MS)) this.attempts.delete(key)
    }
  }
}
