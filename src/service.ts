/**
 * Remote service for `shareWebui`: mints the tokenized URL of the live GUI
 * and applies selection changes by delegating to the plugin body that owns
 * the fixed-port gateway.
 *
 * @module dsh-share-webui/service
 */

import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { DeviceStore } from './pairing.ts'
import type { ShareWebuiDevice, ShareWebuiPairing, ShareWebuiPortCheck, ShareWebuiResult } from './wire.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Browser-session connection host (declared structurally). */
    connection: {
      /** Attach this process's launch token to an application URL. */
      authenticatedUrl(baseUrl: string): string
    }
    /** Served Web GUI facts (declared structurally). */
    webServer: {
      /** Listening port of the served GUI. */
      port: number
    }
  }
}

/** Addresses that always mean this machine. */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1'])

/**
 * Loopback origin of the served GUI. Prefer the official `webServer.getOrigin`
 * (it normalizes wildcard binds and interface zones) and fall back to the
 * listening port.
 * @param webServer - served web server service.
 * @returns absolute origin.
 */
export function originOf(webServer: Context['webServer']): string {
  try {
    if (typeof webServer?.getOrigin === 'function') return webServer.getOrigin()
  } catch {}
  const port = webServer?.port
  if (!Number.isInteger(port)) throw new Error('shareWebui: webServer.port is unavailable')
  return `http://127.0.0.1:${String(port)}`
}

/** Whether the origin is the Desktop shell's custom scheme. */
function isShellOrigin(origin: string): boolean {
  try {
    return new URL(origin).protocol === 'dsh-app:'
  } catch {
    return false
  }
}

/**
 * Whether an origin may mint a token.
 * @param origin - absolute origin.
 * @param allowed - configured hosts beyond loopback.
 */
function trustedOrigin(origin: string, allowed: readonly string[]): boolean {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  if (url.username !== '' || url.password !== '') return false
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return false
  if (LOOPBACK.has(url.hostname) || url.hostname === '0:0:0:0:0:0:0:1') return true
  return allowed.includes(url.hostname)
}

/** Surface of the gateway the service reports. */
export interface GatewayFace {
  /** Stable public URL once listening, else null. */
  readonly url: string | null
}

/** State the service mirrors from the plugin body. */
export interface SelectionState {
  /** Normalized selection keys. */
  readonly selection: readonly string[]
  /** Concrete hosts behind the selection. */
  readonly hosts: readonly string[]
  /** Whether the gateway skips the Host allow-list. */
  readonly open: boolean
}

/** Construction-time state. */
export interface ShareWebuiServiceConfig extends Partial<SelectionState> {
  /** Paired devices, shared with the fixed-port gateway. */
  readonly pairing?: DeviceStore
  /** Fixed port currently in effect. */
  readonly port?: number
}

/** What the plugin body offers for port management. */
export interface PortHook {
  /** Probe whether a candidate port can be bound. */
  readonly check: (port: number) => Promise<'free' | 'busy' | 'invalid' | 'current'>
  /** Switch to a new port, rebind, and roll back when the bind fails. */
  readonly apply: (port: number) => Promise<void>
}

/**
 * Parse a port from wire text.
 * @param raw - submitted text.
 * @returns 0..65535, or null when invalid.
 */
function parsePort(raw: string): number | null {
  const text = String(raw).trim()
  if (!/^\d{1,5}$/u.test(text)) return null
  const value = Number(text)
  return value <= 65_535 ? value : null
}

/**
 * `shareWebui` service: mints links and forwards selection changes.
 */
export class ShareWebuiService extends TypertRemoteService {
  /** Hard dependencies. */
  static inject = ['connection', 'webServer']

  /** Gateway attached by the plugin body. */
  private gateway: GatewayFace | null = null

  /** Current selection keys. */
  private selection: readonly string[] = ['loopback']

  /** Concrete hosts behind the selection. */
  private hosts: readonly string[] = ['127.0.0.1']

  /** Whether the gateway skips the Host allow-list. */
  private open = false

  /** Rebinding hook owned by the plugin body. */
  private selectionHook: ((selection: readonly string[]) => Promise<void>) | null = null

  /** Paired devices shared with the gateway, or null when disabled. */
  private readonly pairing: DeviceStore | null

  /** Fixed port currently in effect. */
  private port: number

  /** Port management hook owned by the plugin body. */
  private portHook: PortHook | null = null

  /**
   * @param ctx - context carrying the `connection` service.
   * @param config - initial selection and allow-list.
   */
  constructor(ctx: Context, config?: ShareWebuiServiceConfig) {
    super(ctx, 'shareWebui')
    if (config?.selection !== undefined && config.selection.length > 0) this.selection = config.selection
    if (config?.hosts !== undefined && config.hosts.length > 0) this.hosts = config.hosts
    this.open = config?.open === true
    this.pairing = config?.pairing ?? null
    this.port = typeof config?.port === 'number' ? config.port : 0
  }

  /**
   * Install (or clear) the port management hook.
   * @param hook - hook installed by the plugin body, or null.
   */
  setPortHook(hook: PortHook | null): void {
    this.portHook = hook
  }

  /**
   * Reject a caller that is not on the host machine.
   * @param origin - page origin.
   */
  private assertLocal(origin: string): void {
    if (!this.localCaller(origin)) {
      throw new Error(`shareWebui: this action is only available on the host machine: ${origin}`)
    }
  }

  /**
   * Probe whether a port can be bound before committing to it.
   * @param origin - page origin; must be the host machine.
   * @param raw - candidate port as text.
   * @returns the probe outcome.
   */
  async checkPort(origin: string, raw: string): Promise<ShareWebuiPortCheck> {
    this.assertLocal(origin)
    const port = parsePort(raw)
    if (port === null) return { status: 'invalid', message: 'port must be 0 or 1-65535' }
    if (this.portHook === null) return { status: 'invalid', message: 'gateway is unavailable' }
    const status = await this.portHook.check(port)
    return {
      status,
      message: status === 'free' || status === 'current' ? 'port is available' : 'port is taken',
    }
  }

  /**
   * Switch the fixed port and rebind.
   * @param origin - page origin; must be the host machine.
   * @param raw - new port as text.
   * @returns refreshed links, selection, devices and port.
   */
  async applyPort(origin: string, raw: string): Promise<ShareWebuiResult> {
    this.assertLocal(origin)
    const port = parsePort(raw)
    if (port === null) throw new Error('shareWebui: invalid port (0 or 1-65535)')
    if (this.portHook === null) throw new Error('shareWebui: port management is unavailable')
    await this.portHook.apply(port)
    this.port = port
    return this.current(origin)
  }

  /**
   * Attach (or detach) the gateway whose URL this service reports.
   * @param gateway - gateway face, or null.
   */
  attachFace(gateway: GatewayFace | null): void {
    this.gateway = gateway
    console.info(`[dsh-share-webui] gateway attached: ${gateway?.url ?? 'null'}`)
  }

  /**
   * Adopt the state the plugin body just bound.
   * @param state - selection, hosts and open flag.
   */
  adopt(state: SelectionState): void {
    this.selection = state.selection
    this.hosts = state.hosts
    this.open = state.open
  }

  /**
   * Install (or clear) the rebinding hook.
   * @param hook - handler receiving a new selection, or null.
   */
  setSelectionHook(hook: ((selection: readonly string[]) => Promise<void>) | null): void {
    this.selectionHook = hook
  }

  /**
   * Mint the tokenized URL for the page that asked.
   * @param origin - page origin.
   * @returns links and current selection.
   */
  current(origin: string): ShareWebuiResult {
    console.info(`[dsh-share-webui] current() from ${origin}`)
    const local = this.localCaller(origin)
    const shell = isShellOrigin(origin)
    if (!shell && !this.open && !trustedOrigin(origin, this.hosts)) {
      throw new Error(`shareWebui: origin rejected (configure hosts first): ${origin}`)
    }
    let base = origin
    if (shell) {
      base = originOf(this.ctx.webServer)
    }
    let url: string
    try {
      url = this.ctx.connection.authenticatedUrl(base)
    } catch (error) {
      throw new Error(`shareWebui: could not mint the authenticated URL for ${base}: ${error instanceof Error ? error.message : String(error)}`)
    }
    return {
      url,
      fixedUrl: this.gateway?.url ?? null,
      hosts: this.hosts,
      selection: this.selection,
      local: local ? 'host' : 'remote',
      devices: local ? this.devices() : [],
      port: String(this.port),
    }
  }

  /** Devices the settings page may manage (host only). */
  private devices(): ShareWebuiDevice[] {
    if (this.pairing === null) return []
    return this.pairing.list().map((device) => ({
      id: device.id,
      label: device.label,
      address: device.address,
      pairedAt: new Date(device.createdAt).toISOString(),
      seenAt: new Date(device.lastSeenAt).toISOString(),
    }))
  }

  /**
   * Forget one paired device and return the refreshed state.
   * @param origin - page origin; must be the host machine.
   * @param id - device id.
   * @returns refreshed links, selection and devices.
   */
  revokeDevice(origin: string, id: string): ShareWebuiResult {
    if (!this.localCaller(origin)) {
      throw new Error(`shareWebui: paired devices are only managed on the host machine: ${origin}`)
    }
    if (this.pairing === null) throw new Error('shareWebui: pairing is unavailable on this host')
    this.pairing.revoke(String(id))
    return this.current(origin)
  }

  /**
   * Whether the caller runs on this machine: the desktop shell, or a page on
   * loopback. Only then may pairing codes be minted.
   * @param origin - page origin.
   */
  private localCaller(origin: string): boolean {
    if (isShellOrigin(origin)) return true
    try {
      const url = new URL(origin)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
      if (url.username !== '' || url.password !== '') return false
      return LOOPBACK.has(url.hostname) || url.hostname === '0:0:0:0:0:0:0:1'
    } catch {
      return false
    }
  }

  /**
   * Drop the pending pairing code so it can no longer be redeemed.
   * @param origin - page origin; must be the host machine.
   * @returns refreshed state.
   */
  cancelPairing(origin: string): ShareWebuiResult {
    this.assertLocal(origin)
    if (this.pairing !== null) this.pairing.cancel()
    return this.current(origin)
  }

  /**
   * Mint a pairing code for a device that is about to be paired.
   * @param origin - page origin; must be the host machine.
   * @returns the code and its expiry.
   */
  issuePairing(origin: string): ShareWebuiPairing {
    if (!this.localCaller(origin)) {
      throw new Error(`shareWebui: pairing codes are only issued on the host machine: ${origin}`)
    }
    if (this.pairing === null) throw new Error('shareWebui: pairing is unavailable on this host')
    const issued = this.pairing.issue()
    return { code: issued.code, expiresAt: new Date(issued.expiresAt).toISOString() }
  }

  /**
   * Adopt a new selection, rebind through the plugin body, persist it, and
   * return the refreshed state.
   * @param origin - page origin.
   * @param selection - requested keys.
   * @returns refreshed links and selection.
   */
  async updateHosts(origin: string, selection: readonly string[]): Promise<ShareWebuiResult> {
    if (this.selectionHook === null) throw new Error('shareWebui: selection updates are unavailable')
    await this.selectionHook(Array.isArray(selection) ? selection : [])
    return this.current(origin)
  }

  /**
   * Mint a URL for the gateway's own loopback handshake.
   * @param origin - loopback origin.
   * @returns the tokenized URL.
   */
  mintLoopback(origin: string): string {
    return this.ctx.connection.authenticatedUrl(origin)
  }
}
