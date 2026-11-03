/**
 * Cloudflare Access verification: a tunnel makes every request look like it
 * came from 127.0.0.1, so the gateway cannot rely on the peer address once the
 * fixed entry is published through cloudflared. Access attaches a JWT signed by
 * Cloudflare to each request; verifying it gives us the real identity.
 *
 * ⚠️ This file is the hand-maintained runtime twin of `src/cloudflare.ts` (a
 * standalone clone cannot run the monorepo build). Keep both files in sync.
 *
 * @module dsh-share-webui/cloudflare
 */

import { createPublicKey, createVerify } from 'node:crypto'

/** How long a fetched JWKS is reused. */
const JWKS_TTL_MS = 10 * 60 * 1_000

/** Tolerated clock skew for `exp` / `nbf` (seconds). */
const CLOCK_SKEW_S = 60

/** Cached key set per team domain. */
const jwksCache = new Map()

/**
 * Normalize a team domain into a bare host.
 * @param {string} raw - user input, with or without scheme.
 * @returns {string} the host, or an empty string.
 */
export function normalizeTeamDomain(raw) {
  const text = String(raw).trim().replace(/^https?:\/\//iu, '').replace(/\/+$/u, '')
  return /^[a-z0-9.-]+\.[a-z]{2,}$/iu.test(text) ? text.toLowerCase() : ''
}

/**
 * Fetch (and cache) the signing keys of one team.
 * @param {string} teamDomain - normalized team domain.
 * @param {number} [now] - current epoch ms.
 * @returns {Promise<Array<object>|null>} the key set, or null.
 */
export async function fetchJwks(teamDomain, now = Date.now()) {
  const cached = jwksCache.get(teamDomain)
  if (cached !== undefined && now - cached.at < JWKS_TTL_MS) return cached.keys
  try {
    const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, { headers: { accept: 'application/json' } })
    if (!response.ok) return null
    const document = await response.json()
    const keys = Array.isArray(document.keys) ? document.keys : []
    if (keys.length === 0) return null
    jwksCache.set(teamDomain, { at: now, keys })
    return keys
  } catch {
    return null
  }
}

/** Decode one base64url JSON segment. */
function decodeSegment(segment) {
  try {
    const text = Buffer.from(segment, 'base64url').toString('utf8')
    const parsed = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null ? parsed : null
  } catch {
    return null
  }
}

/** Read one string claim. */
function claimString(payload, name) {
  const value = payload[name]
  return typeof value === 'string' ? value : ''
}

/** Read one numeric claim as epoch seconds. */
function claimNumber(payload, name) {
  const value = payload[name]
  return typeof value === 'number' ? value : Number.NaN
}

/**
 * Verify one Access assertion against the team's keys.
 *
 * Deliberately strict: RS256 only, the key id must exist in the JWKS, the
 * signature must cover header+payload, and `iss`/`aud`/`exp` must all agree.
 * @param {string} token - the `Cf-Access-Jwt-Assertion` value.
 * @param {object} config - team domain and audience.
 * @param {Array<object>} keys - JWKS keys for the team.
 * @param {number} [nowMs] - current epoch ms.
 * @returns {{ identity: { email: string, expiresAt: number } | null, reason: string }}
 */
export function verifyAccessToken(token, config, keys, nowMs = Date.now()) {
  const parts = String(token).split('.')
  if (parts.length !== 3 || parts.some((part) => part === '')) return { identity: null, reason: 'malformed token' }
  const headerSegment = parts[0]
  const payloadSegment = parts[1]
  const signatureSegment = parts[2]
  const header = decodeSegment(headerSegment)
  const payload = decodeSegment(payloadSegment)
  if (header === null || payload === null) return { identity: null, reason: 'undecodable token' }
  if (header.alg !== 'RS256') return { identity: null, reason: `unsupported algorithm ${String(header.alg)}` }
  const kid = typeof header.kid === 'string' ? header.kid : ''
  const key = keys.find((candidate) => candidate.kid === kid)
  if (key === undefined) return { identity: null, reason: `unknown key id ${kid}` }
  let signature
  try {
    signature = Buffer.from(signatureSegment, 'base64url')
  } catch {
    return { identity: null, reason: 'undecodable signature' }
  }
  let verified = false
  try {
    const publicKey = createPublicKey({ key, format: 'jwk' })
    verified = createVerify('RSA-SHA256').update(`${headerSegment}.${payloadSegment}`).verify(publicKey, signature)
  } catch {
    return { identity: null, reason: 'key unusable' }
  }
  if (!verified) return { identity: null, reason: 'signature mismatch' }

  const now = Math.floor(nowMs / 1_000)
  const issuer = claimString(payload, 'iss')
  if (issuer !== `https://${config.teamDomain}`) return { identity: null, reason: `unexpected issuer ${issuer}` }
  const audience = payload.aud
  const audiences = Array.isArray(audience) ? audience.filter((item) => typeof item === 'string') : [String(audience)]
  if (!audiences.includes(config.audience)) return { identity: null, reason: 'audience mismatch' }
  const expiresAt = claimNumber(payload, 'exp')
  if (!Number.isFinite(expiresAt) || expiresAt + CLOCK_SKEW_S < now) return { identity: null, reason: 'token expired' }
  const notBefore = claimNumber(payload, 'nbf')
  if (Number.isFinite(notBefore) && notBefore - CLOCK_SKEW_S > now) return { identity: null, reason: 'token not yet valid' }
  const email = claimString(payload, 'email') || claimString(payload, 'sub')
  if (email === '') return { identity: null, reason: 'no identity claim' }
  return { identity: { email, expiresAt }, reason: '' }
}

/**
 * Verify one request's assertion, fetching keys when needed.
 * @param {string} token - the assertion header value.
 * @param {object} config - team domain and audience.
 * @param {number} [nowMs] - current epoch ms.
 * @returns {Promise<{ identity: { email: string, expiresAt: number } | null, reason: string }>}
 */
export async function verifyAccessRequest(token, config, nowMs = Date.now()) {
  const keys = await fetchJwks(config.teamDomain, nowMs)
  if (keys === null) return { identity: null, reason: 'could not fetch team keys' }
  return verifyAccessToken(token, config, keys, nowMs)
}

/** Drop cached keys (used when the configuration changes). */
export function forgetJwks() {
  jwksCache.clear()
}
