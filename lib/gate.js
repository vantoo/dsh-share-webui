/**
 * Gateway control plane: device authorization and the pairing form. Device
 * management (codes, listing, revocation) lives in the DSH settings page and
 * is reached over RPC, never over this HTTP surface.
 *
 * ⚠️ This file is the hand-maintained runtime twin of `src/gate.ts` (a
 * standalone clone cannot run the monorepo build, so the shipped artifacts are
 * patched in parallel with the source). Keep both files in sync — same order,
 * same names. A proper monorepo build inlines `src/gate.ts` into `lib/index.js`
 * and this file then becomes redundant.
 *
 * @module dsh-share-webui/gate
 */

import { readFileSync } from 'node:fs'
import { DEVICE_COOKIE } from './pairing.js'

/** Device cookie lifetime handed to a paired browser (one year). */
const DEVICE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60

/**
 * Build the `Set-Cookie` value for one device credential.
 * @param {{ id: string, secret: string }} issued - device id and secret.
 * @returns {string} the header value.
 */
export function buildDeviceCookie(issued) {
  return `${DEVICE_COOKIE}=${issued.id}.${issued.secret}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${String(DEVICE_COOKIE_MAX_AGE)}`
}

/** Largest form body the pairing endpoints accept. */
const FORM_LIMIT_BYTES = 4 * 1_024

/** Bundled logo shipped in the package's `assets/` directory. */
const LOGO_URL = new URL('../assets/logo.png', import.meta.url)

/** Logo bytes, loaded once (empty when the asset is missing). */
let logoCache = null

/** Logo bytes, or null when the asset is unavailable. */
function logoBytes() {
  if (logoCache === null) {
    try {
      logoCache = readFileSync(LOGO_URL)
    } catch {
      logoCache = Buffer.alloc(0)
    }
  }
  return logoCache.length > 0 ? logoCache : null
}

/** Copy shown on the pairing form for each failure. */
const PAIR_MESSAGES = {
  mismatch: '配对码不正确，请再试一次。',
  expired: '配对码已失效，请到 DSH 客户端的设置里重新生成。',
  'no-code': '当前没有有效的配对码，请到 DSH 客户端「设置 → Web 共享 → 访问控制」生成。',
  'rate-limited': '尝试过于频繁，请稍后再试。',
}

/** Peer address behind one inbound request, IPv4-mapped IPv6 unwrapped. */
export function peerOf(request) {
  const address = request.socket.remoteAddress ?? ''
  return address.startsWith('::ffff:') ? address.slice(7) : address
}

/** Whether an address belongs to this machine's loopback. */
export function isLoopbackAddress(address) {
  return address === '::1' || address.startsWith('127.')
}

/** One named cookie value out of the request header. */
export function deviceCookie(header) {
  if (typeof header !== 'string') return null
  for (const part of header.split(';')) {
    const cut = part.indexOf('=')
    if (cut < 0) continue
    if (part.slice(0, cut).trim() !== DEVICE_COOKIE) continue
    const raw = part.slice(cut + 1).trim()
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  }
  return null
}

/** Human label for a device, captured from the request at pairing time. */
function labelOf(request) {
  const agent = request.headers['user-agent']
  return typeof agent === 'string' && agent !== '' ? agent : 'device'
}

/**
 * Whether a request arrived through a Cloudflare tunnel. Cloudflare adds these
 * headers at the edge, so a local client cannot shed them — and spoofing them
 * only makes its own path stricter.
 * @param {import('node:http').IncomingMessage} request - inbound request.
 */
export function fromCloudflare(request) {
  return request.headers['cf-ray'] !== undefined
    || request.headers['cf-connecting-ip'] !== undefined
    || request.headers['cf-access-jwt-assertion'] !== undefined
}

/**
 * Whether this peer may reach the harness.
 *
 * Tunnel traffic is decided first: when Cloudflare Access is enabled, a request
 * that came through the edge must carry a valid assertion, whatever the peer
 * address looks like. Everything else keeps the old rules.
 * @param {import('node:http').IncomingMessage} request - inbound request.
 * @param {object} context - gateway facts.
 * @returns {Promise<boolean>}
 */
export async function authorized(request, context) {
  const policy = context.cloudflare
  if (policy !== undefined && policy.enabled() && fromCloudflare(request)) {
    const peer = peerOf(request)
    // A device remembered by an earlier Access login skips the session entirely.
    if (context.devices.verify(deviceCookie(request.headers.cookie), peer)) return { allowed: true }
    const token = request.headers['cf-access-jwt-assertion']
    if (typeof token !== 'string' || token === '') {
      policy.report({ identity: null, reason: 'no Cloudflare Access assertion' }, peer)
      return { allowed: false }
    }
    const result = await policy.verify(token)
    policy.report(result, peer)
    if (result.identity === null) return { allowed: false }
    // First visit after a successful Access login: remember this device for a
    // year so the session does not have to be renewed on every request.
    const issued = policy.remember(result.identity.email, peer)
    return issued === null ? { allowed: true } : { allowed: true, issue: issued }
  }
  if (context.access === 'open') return { allowed: true }
  const peer = peerOf(request)
  if (context.trustLoopback && isLoopbackAddress(peer)) return { allowed: true }
  return { allowed: context.devices.verify(deviceCookie(request.headers.cookie), peer) }
}

/**
 * Answer a peer that has not paired yet: a form for browsers, JSON for
 * everything else (the WebSocket carrier lands here as a 401).
 * @param {import('node:http').IncomingMessage} request - inbound request.
 * @param {import('node:http').ServerResponse} response - inbound response.
 */
export function serveDoor(request, response) {
  const accept = request.headers.accept ?? ''
  if (request.method === 'GET' && accept.includes('text/html')) {
    respondHtml(response, 200, renderPairPage(null, ''))
    return
  }
  response.writeHead(401, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(`${JSON.stringify({ error: 'pairing required', pair: '/__pair' })}\n`)
}

/**
 * Serve the gateway's own control routes; nothing here is proxied.
 * @param {import('node:http').IncomingMessage} request - inbound request.
 * @param {import('node:http').ServerResponse} response - inbound response.
 * @param {string} path - pathname only.
 * @param {object} context - gateway facts.
 */
export async function handleControl(request, response, path, context) {
  if (path === '/__logo.png' && request.method === 'GET') {
    const bytes = logoBytes()
    if (bytes === null) {
      respondText(response, 404, 'logo missing')
      return
    }
    response.writeHead(200, {
      'content-type': 'image/png',
      'content-length': String(bytes.length),
      'cache-control': 'public, max-age=86400'
    })
    response.end(bytes)
    return
  }
  if (path === '/__pair') {
    if (request.method === 'POST') {
      await claim(request, response, context)
      return
    }
    respondHtml(response, 200, renderPairPage(null, ''))
    return
  }
  respondText(response, 404, 'fixed entry: unknown control route')
}

/**
 * Redeem a submitted pairing code and hand out the device cookie.
 * @param {import('node:http').IncomingMessage} request - inbound request.
 * @param {import('node:http').ServerResponse} response - inbound response.
 * @param {object} context - gateway facts.
 */
async function claim(request, response, context) {
  const form = await readForm(request)
  const submitted = form.get('code') ?? ''
  const result = context.devices.claim(submitted, peerOf(request), labelOf(request))
  if (!result.ok) {
    respondHtml(response, 400, renderPairPage(result.reason, submitted))
    return
  }
  console.info(`[dsh-share-webui] device paired: ${result.device.label} (${result.device.address})`)
  response.writeHead(303, {
    location: '/',
    'cache-control': 'no-store',
    'set-cookie': buildDeviceCookie({ id: result.device.id, secret: result.secret }),
  })
  response.end()
}

/**
 * Peer-facing pairing form.
 * @param {string | null} reason - failure code rendered above the field, or null.
 * @param {string} value - value to keep in the field after a failure.
 */
export function renderPairPage(reason, value) {
  const message = reason === null ? '' : `<p class="error">${escapeHtml(PAIR_MESSAGES[reason] ?? '配对失败，请重试。')}</p>`
  return page('配对这台设备', `
    <div class="card narrow">
      <img class="logo" src="/__logo.png" alt="DeepSeek Harness" width="72" height="72" onerror="this.remove()">
      <h1>配对这台设备</h1>
      <p class="muted">输入桌面端「访问控制」页面上显示的 6 位配对码。</p>
      ${message}
      <form method="post" action="/__pair">
        <input name="code" value="${escapeHtml(value)}" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="000000" required autofocus>
        <button class="primary">配对</button>
      </form>
      <p class="hint muted">没有配对码？在运行 DSH 的这台电脑上打开<br>DSH 客户端 → 设置 → Web 共享 → 访问控制，点「生成配对码」。</p>
    </div>`)
}

/** Escape text for HTML output. */
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/gu, (character) => {
    switch (character) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      default: return '&#39;'
    }
  })
}

/** Plain-text response. */
function respondText(response, status, body) {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
  response.end(`${body}\n`)
}

/** HTML response. */
function respondHtml(response, status, body) {
  response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  response.end(body)
}

/** Read one small urlencoded form body. */
async function readForm(request) {
  const chunks = []
  let size = 0
  try {
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      size += buffer.length
      if (size > FORM_LIMIT_BYTES) break
      chunks.push(buffer)
    }
  } catch {
    // Client vanished mid-upload (ECONNRESET / aborted): treat as empty.
    return new Map()
  }
  return new Map(new URLSearchParams(Buffer.concat(chunks).toString('utf8')))
}

/**
 * Shared page shell.
 * @param {string} title - document title.
 * @param {string} body - inner markup.
 */
function page(title, body, embed = false) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;padding:24px 18px;
  font:15px/1.65 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
.card{margin:auto;width:100%;max-width:720px}
.card.narrow{max-width:380px;text-align:center}
body.embed{display:block;min-height:0;padding:14px}
body.embed .card{margin:0;max-width:none}
body.embed h1{font-size:17px}
.logo{display:block;width:72px;height:72px;border-radius:18px;margin:0 auto 16px;
  box-shadow:0 6px 20px rgba(0,0,0,.16)}
.logo.small{width:40px;height:40px;border-radius:10px;margin:0;box-shadow:none;flex:none}
.brand{display:flex;align-items:center;gap:12px;margin:0 0 8px}
.brand h1{margin:0}
h1{font-size:19px;margin:0 0 6px}
h2{font-size:13px;margin:0 0 10px;color:#6b7280;font-weight:600;letter-spacing:.04em}
p{margin:0 0 12px}
.muted{color:#6b7280;font-size:13px}
.error{color:#b91c1c}
.hint{margin:22px 0 0;padding-top:16px;border-top:1px solid color-mix(in srgb,currentColor 12%,transparent);line-height:1.8}
section{border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:12px;padding:16px;margin:18px 0}
code{font:600 13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
.card.narrow code{font-size:12px}
.code{font:700 30px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.22em;margin:8px 0}
.links{margin:0 0 12px;padding-left:18px}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:7px 8px;border-bottom:1px solid color-mix(in srgb,currentColor 12%,transparent);vertical-align:middle}
th{color:#6b7280;font-weight:600}
input{display:block;margin:0 auto 12px;font:600 22px/1.2 ui-monospace,Menlo,monospace;letter-spacing:.18em;width:100%;max-width:220px;padding:8px 10px;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:10px;background:transparent;color:inherit;text-align:center}
form{margin:0}
button,a.button{font:inherit;display:inline-block;padding:8px 14px;border-radius:10px;border:1px solid color-mix(in srgb,currentColor 20%,transparent);background:transparent;color:inherit;cursor:pointer;text-decoration:none}
button.primary{background:#111;color:#fff;border-color:#111}
</style></head><body${embed ? ' class="embed"' : ''}>
${body}
</body></html>`
}
