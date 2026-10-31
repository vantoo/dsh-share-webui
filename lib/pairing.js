/**
 * Device pairing for the fixed-port gateway: one short-lived code turns a
 * browser into a named device that owns its own revocable credential.
 *
 * ⚠️ This file is the hand-maintained runtime twin of `src/pairing.ts` (a
 * standalone clone cannot run the monorepo build, so the shipped artifact is
 * patched in parallel with the source). Keep both files in sync — same order,
 * same names. A proper monorepo build inlines `src/pairing.ts` into
 * `lib/index.js` and this file then becomes redundant.
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

/** SHA-256 of a device secret (the secret is 256-bit, so no stretching needed). */
function hashSecret(secret) {
  return createHash('sha256').update(secret).digest('hex')
}

/** Constant-time string comparison. */
function same(left, right) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Random public id. */
function randomId() {
  return randomBytes(9).toString('base64url')
}

/** Random 256-bit device secret. */
function randomSecret() {
  return randomBytes(32).toString('base64url')
}

/** Strip everything but digits, then trim to the code width. */
function normalizeCode(input) {
  return String(input).replace(/\D/gu, '').slice(0, 6)
}

/** Narrow one parsed record. */
function isRecord(value) {
  if (typeof value !== 'object' || value === null) return false
  return typeof value.id === 'string'
    && typeof value.label === 'string'
    && typeof value.address === 'string'
    && typeof value.createdAt === 'number'
    && typeof value.lastSeenAt === 'number'
    && typeof value.secretHash === 'string'
}

/**
 * Paired devices plus the single live pairing code.
 */
export class DeviceStore {
  /** @param file - JSON file to persist to, or null to stay in memory only. */
  constructor(file) {
    this.file = file
    /** @type {Array<object>} */
    this.devices = []
    /** @type {{ code: string, expiresAt: number } | null} */
    this.code = null
    /** @type {Map<string, number[]>} */
    this.attempts = new Map()
    this.savedAt = 0
    this.load()
  }

  /** Devices for the admin page. */
  list() {
    return this.devices.map(({ id, label, address, createdAt, lastSeenAt }) => ({ id, label, address, createdAt, lastSeenAt }))
  }

  /** Number of paired devices. */
  get count() {
    return this.devices.length
  }

  /** Issue a fresh code, invalidating any previous one. */
  issue() {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    const expiresAt = Date.now() + CODE_TTL_MS
    this.code = { code, expiresAt }
    return { code, expiresAt }
  }

  /**
   * Drop the pending code, if any.
   * @returns {boolean} whether a live code was discarded.
   */
  cancel() {
    const had = this.code !== null
    this.code = null
    return had
  }

  /** The code still worth showing, if any. */
  pending() {
    if (this.code === null || this.code.expiresAt <= Date.now()) return null
    return { code: this.code.code, expiresAt: this.code.expiresAt }
  }

  /**
   * Redeem a code and mint the device credential that goes with it.
   * @param {string} raw - submitted code.
   * @param {string} address - peer address.
   * @param {string} label - label captured at pairing time.
   * @returns {{ ok: true, device: object, secret: string } | { ok: false, reason: string }}
   */
  claim(raw, address, label) {
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
    const secret = randomSecret()
    const record = {
      id: randomId(),
      label: String(label).trim().slice(0, 120) || 'device',
      address,
      createdAt: now,
      lastSeenAt: now,
      secretHash: hashSecret(secret),
    }
    this.devices.push(record)
    this.save()
    return {
      ok: true,
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
   * @param {string | null | undefined} value - cookie value (`id.secret`).
   * @param {string} address - peer address.
   */
  verify(value, address) {
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
   * @param {string} id - device id.
   */
  revoke(id) {
    const before = this.devices.length
    this.devices = this.devices.filter((entry) => entry.id !== id)
    if (this.devices.length === before) return false
    this.save()
    return true
  }

  /** Load the persisted list; corrupt or missing state degrades to empty. */
  load() {
    if (this.file === null) return
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'))
      const list = typeof parsed === 'object' && parsed !== null && Array.isArray(parsed.devices) ? parsed.devices : []
      this.devices = list.filter(isRecord)
    } catch {
      this.devices = []
    }
  }

  /** Write the list back atomically, owner-only. */
  save() {
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
   * @param {string} address - peer address.
   * @param {number} now - current epoch ms.
   */
  admitted(address, now) {
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
   * @param {string} address - peer address.
   * @param {number} now - current epoch ms.
   */
  note(address, now) {
    const recent = this.attempts.get(address) ?? []
    recent.push(now)
    this.attempts.set(address, recent)
    if (this.attempts.size > 256) this.prune(now)
  }

  /**
   * Drop addresses whose window has fully expired.
   * @param {number} now - current epoch ms.
   */
  prune(now) {
    for (const [key, value] of this.attempts) {
      if (value.length === 0 || value.every((at) => now - at >= ATTEMPT_WINDOW_MS)) this.attempts.delete(key)
    }
  }
}
