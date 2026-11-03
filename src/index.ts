/**
 * `dsh-share-webui` host entry: builds the host allow-list from the selection,
 * mounts the remote service, and owns the fixed-port gateway that keeps one
 * address stable across restarts. The browser half renders the settings page.
 *
 * @module dsh-share-webui
 */

import { execFileSync } from 'node:child_process'
import { createSocket } from 'node:dgram'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { CloudflareConfig } from './cloudflare.ts'
import { forgetJwks, verifyAccessRequest } from './cloudflare.ts'
import { createServer as createNetServer } from 'node:net'
import { homedir, hostname, networkInterfaces } from 'node:os'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { FixedPortGateway } from './fixed-entry.ts'
import { DeviceStore } from './pairing.ts'
import { ShareWebuiService, originOf } from './service.ts'
import { TYPERT } from './typert.host.ts'

export const name = 'dsh-share-webui'

export { TYPERT }

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Served Web GUI facts (declared structurally). */
    webServer: {
      /** Listening port of the served GUI. */
      port: number
    }
  }
}

/** Plugin configuration. */
export interface Config {
  /** Fixed port; 0 disables the gateway. Default 30800. */
  fixedPort?: number
  /** Force one bind interface instead of deriving one per host. */
  fixedHost?: string
  /** Initial selection when nothing is persisted. */
  hosts?: readonly string[]
  /**
   * Access policy for peers that are not on loopback. `pair` (default) makes
   * each device redeem a short-lived code once; `open` keeps the old
   * "anyone who can reach the port is in" behaviour.
   */
  access?: 'pair' | 'open'
  /** Whether loopback peers skip pairing. Default true. */
  trustLoopback?: boolean
}

/** Addresses that always mean this machine. */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1'])
/** Tailscale / CGNAT range. */
const TAILNET_V4 = /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./u
/** RFC1918 LAN addresses. */
const LAN_V4 = /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/u
/** Dotted-quad convenience test. */
const DOTTED_V4 = /^\d{1,3}(?:\.\d{1,3}){3}$/u
/** Keys a selection may contain. */
const SELECTABLE = new Set(['loopback', 'lan', 'tailscale', 'any'])

/** Every non-internal IPv4 address on this machine. */
function ipv4Addresses(): Array<{ name: string; address: string }> {
  const found: Array<{ name: string; address: string }> = []
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family !== 'IPv4' || item.internal) continue
      found.push({ name, address: item.address })
    }
  }
  return found
}

/** How long the probed default-route address is reused. */
const ROUTE_TTL_MS = 60 * 1_000

/** Local address the default route leaves from, or null when unknown. */
let routeAddress: string | null = null

/** When {@link routeAddress} was probed. */
let routeAddressAt = 0

/** Whether a probe is already in flight. */
let routeProbe: Promise<string | null> | null = null

/**
 * Ask the OS which local address the default route uses: a UDP `connect`
 * resolves the route without sending a packet or resolving a name, so this
 * works the same on macOS, Linux and Windows — no shell parsing.
 * @param timeoutMs - give up after this long.
 * @returns the local IPv4 address, or null.
 */
export function probeDefaultRouteAddress(timeoutMs = 500): Promise<string | null> {
  if (routeProbe !== null) return routeProbe
  const probe = new Promise<string | null>((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const socket = createSocket('udp4')
    const finish = (value: string | null): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      try { socket.close() } catch {}
      resolve(value)
    }
    timer = setTimeout(() => { finish(null) }, timeoutMs)
    socket.on('error', () => { finish(null) })
    try {
      socket.connect(53, '8.8.8.8', () => {
        try {
          const address = socket.address().address
          finish(typeof address === 'string' && address !== '' ? address : null)
        } catch {
          finish(null)
        }
      })
    } catch {
      finish(null)
    }
  }).finally(() => { routeProbe = null })
  routeProbe = probe
  return probe
}

/** Interface the default route egresses on, when the platform tool exists. */
function defaultRouteInterface(): string | null {
  try {
    if (process.platform === 'darwin') {
      return execFileSync('route', ['-n', 'get', 'default'], { encoding: 'utf8' }).match(/interface:\s*(\S+)/u)?.[1] ?? null
    }
    if (process.platform === 'linux') {
      return execFileSync('ip', ['route', 'show', 'default'], { encoding: 'utf8' }).match(/dev\s+(\S+)/u)?.[1] ?? null
    }
  } catch {}
  return null
}

/** How long one interface snapshot is reused before rescanning. */
const ADDRESS_TTL_MS = 10 * 1_000

/** How long the MagicDNS name is cached (it only changes on rename). */
const DNS_TTL_MS = 5 * 60 * 1_000

/** Candidate Tailscale CLI locations, most specific first. */
const TAILSCALE_CLI = [
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  '/usr/local/bin/tailscale',
  '/opt/homebrew/bin/tailscale',
  '/usr/bin/tailscale',
  '/usr/sbin/tailscale',
  'C:\\Program Files\\Tailscale\\tailscale.exe',
  'tailscale',
]

/** Cached MagicDNS lookup. */
let dnsCache: { at: number; name: string | null } = { at: 0, name: null }

/**
 * MagicDNS name of this machine (`host.tailnet.ts.net`), or null when
 * Tailscale is unavailable. Cached: the CLI costs a process spawn.
 * @returns the name without the trailing dot, or null.
 */
export function tailscaleDnsName(): string | null {
  const now = Date.now()
  if (now - dnsCache.at < DNS_TTL_MS) return dnsCache.name
  let name: string | null = null
  for (const cli of TAILSCALE_CLI) {
    try {
      const raw = execFileSync(cli, ['status', '--json'], { encoding: 'utf8', timeout: 2_000, stdio: ['ignore', 'pipe', 'ignore'] })
      const parsed: unknown = JSON.parse(raw)
      const dns = (parsed as { Self?: { DNSName?: unknown } }).Self?.DNSName
      if (typeof dns === 'string' && dns.length > 1) {
        name = dns.replace(/\.$/u, '')
        break
      }
    } catch {}
  }
  dnsCache = { at: now, name }
  return name
}

/** Cached interface snapshot. */
let addressCache: { addresses: Array<{ name: string; address: string }>; lan: string | null } | null = null
let addressCacheAt = 0

/**
 * Pick the LAN address to display. Three sources, best first: the OS route
 * probe (every platform), the platform's default-route tool (macOS/Linux),
 * then an interface-name heuristic (covers Windows when the probe fails).
 * @param list - candidate interfaces.
 * @returns the address, or null.
 */
function lanFrom(list: Array<{ name: string; address: string }>): string | null {
  const candidates = list.filter(({ address }) => !/^169\.254\./u.test(address) && LAN_V4.test(address))
  if (candidates.length === 0) return null
  if (routeAddress !== null) {
    const routed = candidates.find(({ address }) => address === routeAddress)
    if (routed !== undefined) return routed.address
  }
  const preferred = defaultRouteInterface()
  if (preferred !== null) {
    const named = candidates.find(({ name }) => name === preferred)
    if (named !== undefined) return named.address
  }
  const physical = candidates.find(({ name }) => /^(?:en|eth|wlan|wi-?fi|ethernet)/iu.test(name))
  return (physical ?? candidates[0]).address
}

/** Interface snapshot reused for a short window (avoids shelling out per toggle). */
function addressSnapshot(): { addresses: Array<{ name: string; address: string }>; lan: string | null } {
  const now = Date.now()
  if (addressCache !== null && now - addressCacheAt < ADDRESS_TTL_MS) return addressCache
  if (now - routeAddressAt > ROUTE_TTL_MS) {
    void probeDefaultRouteAddress().then((address) => {
      routeAddress = address
      routeAddressAt = Date.now()
    })
  }
  const addresses = ipv4Addresses()
  addressCache = { addresses, lan: lanFrom(addresses) }
  addressCacheAt = now
  return addressCache
}

/** Normalize arbitrary keys into a selection; loopback is always present. */
export function selectionOf(raw: readonly string[] | undefined): string[] {
  const keys = ['loopback']
  for (const value of raw ?? []) {
    const key = String(value).toLowerCase()
    if (SELECTABLE.has(key) && !keys.includes(key)) keys.push(key)
  }
  return keys
}

/** Translate the `hosts` config into an initial selection plus literal hosts. */
export function configHosts(configured: readonly string[] | undefined): { keys: string[]; literals: string[] } {
  const keys = ['loopback']
  const literals: string[] = []
  for (const entry of configured ?? []) {
    const text = String(entry).trim()
    if (text === '') continue
    const key = text.toLowerCase()
    if (key === 'loopback' || key === 'localhost' || key === '127.0.0.1') continue
    if (key === '*' || key === 'any') {
      if (!keys.includes('any')) keys.push('any')
      continue
    }
    if (key === 'lan' || key === 'tailscale') {
      if (!keys.includes(key)) keys.push(key)
      continue
    }
    if (!literals.includes(text)) literals.push(text)
  }
  return { keys, literals }
}

/** Concrete hosts a selection advertises. */
export function hostsOf(keys: readonly string[], literals: readonly string[]): string[] {
  const snapshot = addressSnapshot()
  const hosts = ['127.0.0.1']
  if (keys.includes('lan') && snapshot.lan !== null) hosts.push(snapshot.lan)
  const all = snapshot.addresses.map(({ address }) => address)
  if (keys.includes('tailscale')) hosts.push(...all.filter((address) => TAILNET_V4.test(address)))
  if (keys.includes('any')) hosts.push(...all)
  // The MagicDNS name resolves to the tailnet address above; accepting it too
  // means `http://<machine>.<tailnet>.ts.net:<port>` is not rejected as a Host.
  if (keys.includes('tailscale') || keys.includes('any')) {
    const dns = tailscaleDnsName()
    if (dns !== null) hosts.push(dns)
  }
  hosts.push(...literals)
  return [...new Set(hosts)]
}

/** Interfaces to listen on: one per concrete address, or wildcard when open. */
export function bindsOf(keys: readonly string[], hosts: readonly string[]): string[] {
  if (keys.includes('any')) return ['0.0.0.0']
  return [...new Set(['127.0.0.1', ...hosts.filter((host) => !LOOPBACK.has(host) && DOTTED_V4.test(host))])]
}

/** Resolved DSH home. */
function homeDirectory(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/** File holding the persisted selection. */
function selectionPath(): string {
  return join(homeDirectory(), 'share-webui.json')
}

/** File holding the paired devices. */
function devicesPath(): string {
  return join(homeDirectory(), 'share-webui-devices.json')
}

/** Persisted user state: selection, fixed port and Cloudflare Access. */
interface PersistedState {
  /** Selection keys. */
  hosts: string[]
  /** Fixed port, or null when the file predates port persistence. */
  port: number | null
  /** Cloudflare Access settings, or null when never configured. */
  cloudflare: CloudflareConfig | null
}

/** Read the persisted state, if any. */
function loadState(): PersistedState | null {
  try {
    const data: unknown = JSON.parse(readFileSync(selectionPath(), 'utf8'))
    if (typeof data !== 'object' || data === null) return null
    const hosts = Array.isArray((data as { hosts?: unknown }).hosts) ? (data as { hosts: string[] }).hosts : null
    const raw = (data as { port?: unknown }).port
    const port = typeof raw === 'number' && Number.isInteger(raw) ? raw : null
    const rawCloudflare = (data as { cloudflare?: unknown }).cloudflare
    const cloudflare = typeof rawCloudflare === 'object' && rawCloudflare !== null
      ? {
          enabled: (rawCloudflare as { enabled?: unknown }).enabled === true,
          teamDomain: typeof (rawCloudflare as { teamDomain?: unknown }).teamDomain === 'string' ? (rawCloudflare as { teamDomain: string }).teamDomain : '',
          audience: typeof (rawCloudflare as { audience?: unknown }).audience === 'string' ? (rawCloudflare as { audience: string }).audience : '',
          host: typeof (rawCloudflare as { host?: unknown }).host === 'string' ? (rawCloudflare as { host: string }).host : '',
        }
      : null
    if (hosts === null && port === null && cloudflare === null) return null
    return { hosts: hosts ?? [], port, cloudflare }
  } catch {
    return null
  }
}

/** Persist the selection and port. */
function saveState(keys: readonly string[], port: number, cloudflare: CloudflareConfig): void {
  try {
    const file = selectionPath()
    mkdirSync(dirname(file), { recursive: true })
    const temporary = `${file}.${String(process.pid)}.tmp`
    writeFileSync(temporary, `${JSON.stringify({ hosts: keys, port, cloudflare }, null, 2)}\n`, 'utf8')
    renameSync(temporary, file)
    console.info(`[dsh-share-webui] state saved: ${keys.join(', ')} on port ${String(port)}`)
  } catch (error) {
    console.error(`[dsh-share-webui] could not persist the state: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Default fixed port. */
const DEFAULT_PORT = 30_800

/**
 * Probe whether a TCP port can be bound on loopback right now.
 * @param port - candidate port (0 means "disabled" and is always fine).
 * @param current - port the gateway already holds.
 * @returns the probe outcome.
 */
export async function portStatus(port: number, current: number): Promise<'free' | 'busy' | 'invalid' | 'current'> {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) return 'invalid'
  if (port === 0) return 'free'
  if (port === current) return 'current'
  return await new Promise((resolve) => {
    const probe = createNetServer()
    const finish = (status: 'free' | 'busy'): void => {
      try { probe.close() } catch {}
      resolve(status)
    }
    probe.once('error', () => { finish('busy') })
    probe.once('listening', () => { finish('free') })
    try {
      probe.listen(port, '127.0.0.1')
    } catch {
      finish('busy')
    }
  })
}

/**
 * Mount the service and the gateway, then keep them in sync with the
 * selection the settings page writes.
 * @param ctx - plugin context.
 * @param config - plugin configuration.
 */
async function mount(ctx: Context, config: Config | undefined): Promise<void> {
  // Resolve the default route before the first host list is computed, so the
  // LAN address is right from the very first bind.
  routeAddress = await probeDefaultRouteAddress()
  routeAddressAt = Date.now()
  const configured = configHosts(config?.hosts)
  const persisted = loadState()
  const initial = selectionOf(persisted?.hosts.length === 0 || persisted === null ? configured.keys : persisted.hosts)
  const configPort = typeof config?.fixedPort === 'number' ? Math.trunc(config.fixedPort) : DEFAULT_PORT
  let activePort = persisted?.port ?? configPort
  const literals = configured.literals
  const access = config?.access === 'open' ? 'open' : 'pair'
  const trustLoopback = config?.trustLoopback !== false
  const devices = new DeviceStore(devicesPath())
  // Cloudflare Access: mutable config plus the last verification outcome, which
  // the settings page reads back.
  const cloudflareState: {
    config: CloudflareConfig
    last: { email: string; reason: string; at: number }
  } = {
    config: persisted?.cloudflare ?? { enabled: false, teamDomain: '', audience: '', host: '' },
    last: { email: '', reason: '', at: 0 },
  }
  const cloudflarePolicy = {
    enabled: (): boolean => cloudflareState.config.enabled,
    config: (): CloudflareConfig => cloudflareState.config,
    verify: async (token: string) => verifyAccessRequest(token, cloudflareState.config),
    remember: (email: string, address: string): { id: string; secret: string } | null => devices.remember(email, address),
    report: (result: { identity: { email: string } | null; reason: string }, address: string): void => {
      cloudflareState.last = { email: result.identity?.email ?? '', reason: result.reason, at: Date.now() }
      if (result.identity === null) console.warn(`[dsh-share-webui] cloudflare rejected ${address}: ${result.reason}`)
      else console.info(`[dsh-share-webui] cloudflare verified ${result.identity.email} (${address})`)
    },
  }
  console.info(`[dsh-share-webui] cloudflare access: ${cloudflareState.config.enabled ? `on (${cloudflareState.config.teamDomain})` : 'off'}`)
  console.info(`[dsh-share-webui] selection: ${initial.join(', ')}${literals.length > 0 ? ` (+ ${literals.join(', ')})` : ''}`)
  console.info(`[dsh-share-webui] access: ${access}${trustLoopback ? ', loopback trusted' : ''}, ${String(devices.count)} paired device(s)`)

  await ctx.plugin(ShareWebuiService, {
    selection: initial,
    hosts: hostsOf(initial, literals),
    open: initial.includes('any'),
    pairing: devices,
    port: activePort,
  })
  console.info('[dsh-share-webui] host mounted: shareWebui/current is available')

  if (activePort < 0 || activePort > 65_535) {
    console.info(`[dsh-share-webui] fixed entry disabled (port=${String(activePort)})`)
    return
  }

  ctx.inject(['connection', 'webServer', 'shareWebui'], (scope) => {
    scope.effect(() => {
      const service = ctx.get('shareWebui') as ShareWebuiService
      // Official origin API: normalizes wildcard binds and interface zones.
      const origin = originOf(scope.webServer)
      const parsed = new URL(origin)
      const connectHost = parsed.hostname
      const connectPort = Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80)
      let gateway: FixedPortGateway | null = null
      let desired = initial
      let applied: string[] | null = null
      let chain: Promise<void> = Promise.resolve()
      let disposed = false

      const sameKeys = (left: readonly string[], right: readonly string[]): boolean =>
        left.length === right.length && left.every((key, index) => key === right[index])

      const rebind = async (keys: readonly string[]): Promise<void> => {
        const hosts = hostsOf(keys, literals)
        const open = keys.includes('any')
        const previous = gateway
        gateway = null
        // Await the close so the same port is free before rebinding.
        if (previous !== null) {
          try {
            await previous.close()
          } catch {}
        }
        if (activePort === 0) {
          gateway = null
          if (service !== undefined) {
            service.adopt({ selection: keys, hosts, open })
            service.attachFace(null)
          }
          return
        }
        const forward = new FixedPortGateway(bindsOf(keys, hosts), activePort, {
          authority: parsed.host,
          hostname: connectHost,
          port: connectPort,
          displayHost: hosts[0] ?? connectHost,
          // The Host check stays on even when the port is bound everywhere:
          // a rebinding page presents its own Host and is rejected here.
          allowedHosts: [...new Set([
            connectHost,
            'localhost',
            '::1',
            hostname(),
            hostname().replace(/\.local$/u, ''),
            ...hosts,
            ...(cloudflareState.config.enabled && cloudflareState.config.host !== '' ? [cloudflareState.config.host] : []),
          ].map((entry) => entry.toLowerCase()))],
          access,
          trustLoopback,
          devices,
          cloudflare: cloudflarePolicy,
          mintUrl: () => service.mintLoopback(origin),
        })
        try {
          await forward.open()
        } catch (error) {
          console.error(`[dsh-share-webui] gateway failed to open: ${error instanceof Error ? error.message : String(error)}`)
        }
        gateway = forward
        if (open) {
          console.warn(access === 'open'
            ? '[dsh-share-webui] bound to every interface with access=open: anyone who can reach this port controls the harness'
            : '[dsh-share-webui] bound to every interface; every new device still needs a pairing code')
        }
        console.info(`[dsh-share-webui] pairing page: http://127.0.0.1:${String(activePort)}/__pair`)
        if (service !== undefined) {
          service.adopt({ selection: keys, hosts, open })
          service.attachFace(forward)
        }
      }

      // Coalesce bursts: runs are serialized against the latest desired keys.
      const schedule = (next: readonly string[]): Promise<void> => {
        desired = selectionOf(next)
        chain = chain.then(async () => {
          if (disposed) return
          // Snapshot: `desired` may change while the rebind is in flight, and
          // recording it afterwards would mark a stale binding as applied.
          const target = desired
          if (applied !== null && sameKeys(applied, target)) return
          await rebind(target)
          applied = target
        }).catch((error: unknown) => {
          console.error(`[dsh-share-webui] rebind failed: ${error instanceof Error ? error.message : String(error)}`)
        })
        return chain
      }

      if (service !== undefined) {
        service.setSelectionHook(async (next) => {
          await schedule(next)
          saveState(desired, activePort, cloudflareState.config)
        })
        service.setPortHook({
          check: async (candidate: number) => portStatus(candidate, activePort),
          apply: async (candidate: number) => {
            const previous = activePort
            activePort = candidate
            saveState(desired, activePort, cloudflareState.config)
            // Force a rebind even when the selection did not change.
            applied = null
            await schedule(desired)
            const current = gateway
            if (current !== null && current.url === null) {
              // The new port could not be bound: put the old one back.
              activePort = previous
              saveState(desired, activePort, cloudflareState.config)
              applied = null
              await schedule(desired)
              throw new Error(`port ${String(candidate)} could not be bound`)
            }
          },
        })
        service.setCloudflareHook({
          read: () => ({
            enabled: cloudflareState.config.enabled ? 'on' : 'off',
            teamDomain: cloudflareState.config.teamDomain,
            audience: cloudflareState.config.audience,
            host: cloudflareState.config.host,
            lastEmail: cloudflareState.last.email,
            lastReason: cloudflareState.last.reason,
            lastAt: cloudflareState.last.at === 0 ? '' : new Date(cloudflareState.last.at).toISOString(),
          }),
          apply: async (next) => {
            const hostChanged = cloudflareState.config.host !== next.host
              || cloudflareState.config.enabled !== next.enabled
            cloudflareState.config = next
            forgetJwks()
            saveState(desired, activePort, cloudflareState.config)
            // The public hostname feeds the Host allow-list, so rebind on change.
            if (hostChanged) {
              applied = null
              await schedule(desired)
            }
          },
        })
      }
      void schedule(initial)

      return async () => {
        disposed = true
        if (service !== undefined) {
          service.setSelectionHook(null)
          service.setPortHook(null)
          service.setCloudflareHook(null)
          service.attachFace(null)
        }
        await chain.catch(() => {})
        const current = gateway
        gateway = null
        if (current !== null) await current.close()
      }
    }, 'dsh-share-webui: gateway')
  })
}

/**
 * Safety wrapper: failures are logged and contained so the Host (and the
 * Desktop welcome RPC) never dies because of this plugin.
 * @param ctx - plugin context.
 * @param config - plugin configuration.
 */
export async function apply(ctx: Context, config: Config | undefined): Promise<void> {
  try {
    await mount(ctx, config)
  } catch (error) {
    console.error(`[dsh-share-webui] apply failed, plugin skipped (host keeps running): ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  }
}
