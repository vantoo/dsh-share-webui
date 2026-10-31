/**
 * Fixed-port gateway: an in-process HTTP/WebSocket reverse proxy that gives
 * the Web GUI a stable address. It performs the launch-token exchange itself,
 * holds the resulting session cookie, and relays traffic for as long as the
 * surrounding plugin fiber lives.
 *
 * Access to that session is gated: loopback peers are trusted, everyone else
 * must present a paired-device cookie minted by the control plane in
 * `gate.ts` / `pairing.ts`.
 *
 * @module dsh-share-webui/fixed-entry
 */

import { createServer, request as httpRequest } from 'node:http'
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from 'node:http'
import { authorized, handleControl, serveDoor } from './gate.ts'
import type { ControlContext } from './gate.ts'
import type { DeviceStore } from './pairing.ts'

/** Live harness server plus the credentials source behind the gateway. */
export interface GatewayTarget {
  /** Host:port written into forwarded `Host`/`Origin` headers. */
  readonly authority: string
  /** Loopback address of the harness server. */
  readonly hostname: string
  /** Port of the harness server. */
  readonly port: number
  /** Host advertised in the public fixed URL. */
  readonly displayHost: string
  /** Hostnames accepted by the inbound `Host` check. */
  readonly allowedHosts: readonly string[]
  /** Whether non-loopback peers must present a paired-device cookie. */
  readonly access: 'pair' | 'open'
  /** Whether loopback peers skip pairing. */
  readonly trustLoopback: boolean
  /** Paired devices and the live pairing code. */
  readonly devices: DeviceStore
  /** Mint one fresh tokenized handshake URL. */
  readonly mintUrl: () => string
}

/** Headers the gateway owns and regenerates on every hop. */
const OWNED = new Set([
  'host', 'cookie', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection',
  // Forwarding headers are client-controlled here; drop them so the harness
  // cannot be told a forged peer address.
  'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded',
])

/** Response headers never relayed to the browser. */
const HIDDEN_RESPONSE = new Set(['set-cookie', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection'])

/** How long a held cookie is reused (the server grants 24h). */
const COOKIE_TTL_MS = 22 * 60 * 60 * 1_000

/**
 * Issue one upstream request with the rewritten headers.
 * @param target - harness server target.
 * @param request - inbound request.
 * @param headers - rewritten headers.
 * @param onResponse - response callback, or null for upgrades.
 * @returns the upstream client request.
 */
function openUpstream(
  target: GatewayTarget,
  request: IncomingMessage,
  headers: IncomingHttpHeaders,
  onResponse: ((response: IncomingMessage) => void) | null,
): ReturnType<typeof httpRequest> {
  const options = {
    hostname: target.hostname,
    port: target.port,
    method: request.method,
    path: request.url,
    headers,
  }
  return onResponse === null ? httpRequest(options) : httpRequest(options, onResponse)
}

/**
 * Fixed-port reverse proxy bound to one or more addresses.
 */
export class FixedPortGateway {
  /** One listener per bind address. */
  private readonly listeners: Array<{ address: string; server: Server }> = []

  /** Held browser-session cookie (`name=value`). */
  private cookie: string | null = null

  /** Epoch ms when the held cookie was minted. */
  private cookieAt = 0

  /** Single-flight handshake. */
  private handshake: Promise<string | null> | null = null

  /** Whether at least one listener is up. */
  private listening = false

  /** Upgraded (WebSocket) sockets: `server.close()` waits for these. */
  private readonly upgraded = new Set<import('node:stream').Duplex>()

  /**
   * @param addresses - addresses to bind.
   * @param port - fixed port.
   * @param target - live harness server and handshake source.
   */
  constructor(
    private readonly addresses: readonly string[],
    private readonly port: number,
    private readonly target: GatewayTarget,
  ) {}

  /**
   * Start one listener per address. Resolves once every listener reported
   * either `listening` or `error`, so callers can rely on {@link url}.
   */
  async open(): Promise<void> {
    const pending: Array<Promise<void>> = []
    for (const address of this.addresses) {
      const server = createServer((request, response) => {
        // Never let a rejected handler escape: an unhandled rejection takes the
        // whole harness down (Node's default) and is reachable pre-auth.
        void this.accept(request, response).catch((error: unknown) => {
          console.error(`[dsh-share-webui] request failed: ${error instanceof Error ? error.message : String(error)}`)
          if (!response.headersSent) response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
          if (!response.writableEnded) response.end('fixed entry: request failed')
        })
      })
      server.on('upgrade', (request, socket, head) => {
        void this.acceptUpgrade(request, socket, head).catch((error: unknown) => {
          console.error(`[dsh-share-webui] upgrade failed: ${error instanceof Error ? error.message : String(error)}`)
          if (!socket.destroyed) socket.destroy()
        })
      })
      pending.push(new Promise<void>((resolve) => {
        server.once('listening', () => {
          this.listening = true
          console.info(`[dsh-share-webui] listening on ${address}:${this.port} -> ${this.target.authority}`)
          resolve()
        })
        server.once('error', (error) => {
          console.error(`[dsh-share-webui] ${address}:${this.port} failed: ${error instanceof Error ? error.message : String(error)}`)
          resolve()
        })
      }))
      server.on('clientError', (_error, socket) => {
        if (!socket.destroyed) socket.destroy()
      })
      server.listen(this.port, address)
      this.listeners.push({ address, server })
    }
    await Promise.all(pending)
  }

  /** Stable public URL once at least one listener is up. */
  get url(): string | null {
    return this.listening ? `http://${this.target.displayHost}:${this.port}` : null
  }

  /** Stop every listener and forget the held cookie. */
  async close(): Promise<void> {
    this.listening = false
    this.cookie = null
    // Upgraded sockets are detached from the HTTP server's connection tracking,
    // so `closeAllConnections()` misses them and `server.close()` would wait
    // forever — which used to deadlock rebinds.
    for (const socket of this.upgraded) {
      try { socket.destroy() } catch {}
    }
    this.upgraded.clear()
    const listeners = this.listeners.splice(0, this.listeners.length)
    await Promise.all(listeners.map(async ({ address, server }) => {
      server.closeAllConnections?.()
      await new Promise<void>((resolve) => {
        // Bounded wait: releasing the port matters more than a lingering peer.
        const timer = setTimeout(() => { resolve() }, 2_000)
        timer.unref?.()
        server.close(() => {
          clearTimeout(timer)
          resolve()
        })
      })
      console.info(`[dsh-share-webui] ${address}:${this.port} closed`)
    }))
  }

  /** Facts the control plane needs. */
  private control(): ControlContext {
    return {
      access: this.target.access,
      trustLoopback: this.target.trustLoopback,
      devices: this.target.devices,
      allowedHosts: this.target.allowedHosts,
    }
  }

  /**
   * Whether the inbound Host header may be forwarded, and the Origin (when the
   * browser sends one) agrees. The Host check is unconditional now: an open
   * port no longer means "any Host wins", which is what makes DNS rebinding
   * against a LAN address useless.
   * @param request - inbound request.
   */
  private permitted(request: IncomingMessage): boolean {
    const raw = request.headers.host
    if (typeof raw !== 'string') return false
    let hostname: string
    try {
      hostname = new URL(`http://${raw}`).hostname.replace(/^\[|\]$/gu, '')
    } catch {
      return false
    }
    if (!this.target.allowedHosts.includes(hostname)) return false
    return this.sameOrigin(request)
  }

  /**
   * Reject a cross-site `Origin`. Requests without one (curl, native clients)
   * pass: they cannot be driven by a hostile page in the first place.
   * @param request - inbound request.
   */
  private sameOrigin(request: IncomingMessage): boolean {
    const origin = request.headers.origin
    if (typeof origin !== 'string' || origin === '') return true
    try {
      const parsed = new URL(origin)
      const originHost = parsed.hostname.replace(/^\[|\]$/gu, '').toLowerCase()
      if (!this.target.allowedHosts.includes(originHost)) return false
      // The port has to match as well: a different local service must not be
      // able to drive this gateway just because the hostname is the same.
      const host = request.headers.host
      if (typeof host !== 'string') return false
      return parsed.port === new URL(`http://${host}`).port
    } catch {
      return false
    }
  }

  /**
   * Serve one HTTP request.
   * @param request - inbound request.
   * @param response - inbound response.
   */
  private async accept(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!this.permitted(request)) {
      response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('fixed entry: host not allowed\n')
      return
    }
    const path = (request.url ?? '/').split('?')[0] ?? '/'
    // Only the gateway's own routes are intercepted; any other `/__...` path
    // belongs to the harness and is proxied as usual.
    if (path === '/__pair' || path === '/__logo.png') {
      await handleControl(request, response, path, this.control())
      return
    }
    if (!authorized(request, this.control())) {
      serveDoor(request, response)
      return
    }
    let cookie = this.liveCookie()
    if (cookie === null) cookie = await this.exchange()
    await this.relay(request, response, cookie, 0)
  }

  /**
   * One proxied attempt; a 401 triggers a single re-handshake and replay.
   * @param request - inbound request.
   * @param response - inbound response.
   * @param cookie - cookie to attach.
   * @param attempt - completed attempts.
   */
  private async relay(request: IncomingMessage, response: ServerResponse, cookie: string | null, attempt: number): Promise<void> {
    const upstream = openUpstream(this.target, request, this.headersFor(request.headers, cookie), (upstreamResponse) => {
      if (upstreamResponse.statusCode === 401 && attempt === 0) {
        upstreamResponse.resume()
        void this.exchange().then((fresh) => {
          if (fresh === null) {
            if (!response.headersSent) response.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
            if (!response.writableEnded) response.end('fixed entry: session refresh failed')
            return
          }
          void this.relay(request, response, fresh, attempt + 1)
        }).catch((error: unknown) => {
          console.error(`[dsh-share-webui] session refresh failed: ${error instanceof Error ? error.message : String(error)}`)
          if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
          if (!response.writableEnded) response.end('fixed entry: session refresh failed')
        })
        return
      }
      const headers: Record<string, string | string[]> = {}
      for (const [name, value] of Object.entries(upstreamResponse.headers)) {
        if (value === undefined || HIDDEN_RESPONSE.has(name.toLowerCase())) continue
        headers[name] = value
      }
      response.writeHead(upstreamResponse.statusCode ?? 502, headers)
      upstreamResponse.on('error', () => {
        if (!response.destroyed) response.destroy()
      })
      upstreamResponse.pipe(response)
    })
    upstream.on('error', (error) => {
      console.error(`[dsh-share-webui] relay failed: ${error.message}`)
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
      if (!response.writableEnded) response.end('fixed entry: harness unreachable')
    })
    request.on('error', () => { upstream.destroy() })
    request.on('aborted', () => { upstream.destroy() })
    response.on('error', () => { upstream.destroy() })
    request.pipe(upstream)
  }

  /**
   * Serve one WebSocket upgrade by relaying the 101 handshake.
   * @param request - inbound upgrade request.
   * @param socket - inbound socket.
   * @param head - already-buffered bytes.
   */
  private async acceptUpgrade(request: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer): Promise<void> {
    if (!this.permitted(request)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      return
    }
    if (!authorized(request, this.control())) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      return
    }
    let cookie = this.liveCookie()
    if (cookie === null) cookie = await this.exchange()
    socket.on('error', () => {})
    const upstream = openUpstream(this.target, request, this.headersFor(request.headers, cookie, true), null)
    upstream.on('upgrade', (upstreamResponse, upstreamSocket: import('node:stream').Duplex, upstreamHead: Buffer) => {
      const lines = [`HTTP/1.1 ${upstreamResponse.statusCode ?? 101} ${upstreamResponse.statusMessage ?? 'Switching Protocols'}`]
      for (let index = 0; index < upstreamResponse.rawHeaders.length; index += 2) {
        const name = upstreamResponse.rawHeaders[index]
        if (name.toLowerCase() === 'set-cookie') continue
        lines.push(`${name}: ${upstreamResponse.rawHeaders[index + 1]}`)
      }
      socket.write(`${lines.join('\r\n')}\r\n\r\n`)
      if (upstreamHead.length > 0) socket.write(upstreamHead)
      else if (head.length > 0) upstreamSocket.write(head)
      this.upgraded.add(socket)
      socket.on('close', () => { this.upgraded.delete(socket) })
      upstreamSocket.on('error', () => { if (!socket.destroyed) socket.destroy() })
      socket.on('error', () => { if (!upstreamSocket.destroyed) upstreamSocket.destroy() })
      upstreamSocket.pipe(socket)
      socket.pipe(upstreamSocket)
    })
    upstream.on('response', (upstreamResponse) => {
      upstreamResponse.resume()
      socket.destroy()
    })
    upstream.on('error', () => {
      if (!socket.destroyed) socket.destroy()
    })
    upstream.end()
  }

  /** Held cookie while still fresh enough to reuse. */
  private liveCookie(): string | null {
    return this.cookie !== null && Date.now() - this.cookieAt < COOKIE_TTL_MS ? this.cookie : null
  }

  /**
   * Perform the launch-token exchange, single-flight.
   * @returns the new cookie pair, or null on failure.
   */
  private exchange(): Promise<string | null> {
    if (this.handshake !== null) return this.handshake
    const pending = (async (): Promise<string | null> => {
      let target: string
      try {
        target = this.target.mintUrl()
      } catch (error) {
        console.error(`[dsh-share-webui] handshake could not mint a URL: ${error instanceof Error ? error.message : String(error)}`)
        return null
      }
      let response: Response
      try {
        response = await fetch(target, { redirect: 'manual', headers: { accept: 'text/html' } })
      } catch (error) {
        console.error(`[dsh-share-webui] handshake request failed: ${error instanceof Error ? error.message : String(error)}`)
        return null
      }
      try {
        await response.body?.cancel()
      } catch {}
      const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
      const pair = cookies.find((entry) => entry.startsWith('dsh-auth-'))
      if (pair === undefined) {
        console.error(`[dsh-share-webui] handshake returned HTTP ${response.status} without a dsh-auth cookie`)
        return null
      }
      this.cookie = pair.split(';')[0]?.trim() ?? null
      this.cookieAt = Date.now()
      console.info('[dsh-share-webui] session cookie refreshed')
      return this.cookie
    })().finally(() => { this.handshake = null })
    this.handshake = pending
    return pending
  }

  /**
   * Rewrite inbound headers for the harness.
   * @param inbound - inbound headers.
   * @param cookie - cookie pair to attach, or null.
   * @param upgrade - keep the WebSocket handshake headers on this hop.
   */
  private headersFor(inbound: IncomingHttpHeaders, cookie: string | null, upgrade = false): IncomingHttpHeaders {
    const headers: IncomingHttpHeaders = {}
    for (const [name, value] of Object.entries(inbound)) {
      const lower = name.toLowerCase()
      if (value === undefined) continue
      // On an upgrade hop `connection`/`upgrade` must survive: without them the
      // harness sees a plain GET, never answers 101, and the client reconnects forever.
      if (OWNED.has(lower) && !(upgrade && (lower === 'connection' || lower === 'upgrade'))) continue
      if (lower === 'origin') {
        try {
          const origin = new URL(String(value))
          if (origin.port === String(this.port)) {
            headers.origin = `http://${this.target.authority}`
            continue
          }
        } catch {}
      }
      headers[name] = value
    }
    headers.host = this.target.authority
    if (upgrade) {
      headers.connection = 'Upgrade'
      if (headers.upgrade === undefined) headers.upgrade = 'websocket'
    }
    if (cookie !== null) headers.cookie = cookie
    return headers
  }
}
