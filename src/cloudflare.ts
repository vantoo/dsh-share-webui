/**
 * Cloudflare Access verification: a tunnel makes every request look like it
 * came from 127.0.0.1, so the gateway cannot rely on the peer address once the
 * fixed entry is published through cloudflared. Access attaches a JWT signed by
 * Cloudflare to each request; verifying it gives us the real identity.
 *
 * Zero dependencies: RS256 is verified with node:crypto and the public keys go
 * through the team's own JWKS endpoint.
 *
 * ⚠️ `lib/cloudflare.js` is the hand-maintained runtime twin of this module
 * (a standalone clone cannot run the monorepo build). Keep both in sync.
 *
 * @module dsh-share-webui/cloudflare
 */

import { createPublicKey, createVerify } from 'node:crypto'

/** Cloudflare Access settings that decide who may pass. */
export interface CloudflareConfig {
  /** Whether tunnel traffic must present a valid Access assertion. */
  readonly enabled: boolean
  /** Team domain, e.g. `myteam.cloudflareaccess.com`. */
  readonly teamDomain: string
  /** Access application audience (AUD) tag. */
  readonly audience: string
}

/** Identity carried by a verified assertion. */
export interface AccessIdentity {
  /** Account email from the `email` claim. */
  readonly email: string
  /** Epoch seconds when the assertion expires. */
  readonly expiresAt: number
}

/** One verification attempt, as reported to the settings page. */
export interface AccessResult {
  /** Verified identity, or null when the assertion was rejected. */
  readonly identity: AccessIdentity | null
  /** Reason shown when the assertion was rejected. */
  readonly reason: string
}

/** How long a fetched JWKS is reused. */
const JWKS_TTL_MS = 10 * 60 * 1_000

/** Tolerated clock skew for `exp` / `nbf` (seconds). */
const CLOCK_SKEW_S = 60

/** Cached key set per team domain. */
const jwksCache = new Map<string, { at: number; keys: JsonWebKey[] }>()

/** Shape of the JWKS document Cloudflare serves. */
interface JwksDocument {
  /** Signing keys. */
  keys?: JsonWebKey[]
}

/**
 * Normalize a team domain into a bare host.
 * @param raw - user input, with or without scheme.
 * @returns the host, or an empty string.
 */
export function normalizeTeamDomain(raw: string): string {
  const text = String(raw).trim().replace(/^https?:\/\//iu, '').replace(/\/+$/u, '')
  return /^[a-z0-9.-]+\.[a-z]{2,}$/iu.test(text) ? text.toLowerCase() : ''
}

/**
 * Fetch (and cache) the signing keys of one team.
 * @param teamDomain - normalized team domain.
 * @param now - current epoch ms.
 * @returns the key set, or null when it could not be fetched.
 */
export async function fetchJwks(teamDomain: string, now = Date.now()): Promise<JsonWebKey[] | null> {
  const cached = jwksCache.get(teamDomain)
  if (cached !== undefined && now - cached.at < JWKS_TTL_MS) return cached.keys
  try {
    const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, { headers: { accept: 'application/json' } })
    if (!response.ok) return null
    const document = await response.json() as JwksDocument
    const keys = Array.isArray(document.keys) ? document.keys : []
    if (keys.length === 0) return null
    jwksCache.set(teamDomain, { at: now, keys })
    return keys
  } catch {
    return null
  }
}

/** Decode one base64url JSON segment. */
function decodeSegment(segment: string): Record<string, unknown> | null {
  try {
    const text = Buffer.from(segment, 'base64url').toString('utf8')
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

/** Read one string claim. */
function claimString(payload: Record<string, unknown>, name: string): string {
  const value = payload[name]
  return typeof value === 'string' ? value : ''
}

/** Read `exp` as epoch seconds. */
function claimNumber(payload: Record<string, unknown>, name: string): number {
  const value = payload[name]
  return typeof value === 'number' ? value : Number.NaN
}

/**
 * Verify one Access assertion against the team's keys.
 *
 * Deliberately strict: RS256 only (`none` and HMAC are rejected), the key id must
 * exist in the JWKS, the signature must cover header+payload, and `iss`/`aud`/`exp`
 * must all agree with the configured application.
 * @param token - the `Cf-Access-Jwt-Assertion` value.
 * @param config - team domain and audience.
 * @param keys - JWKS keys for the team.
 * @param nowMs - current epoch ms.
 * @returns the identity, or a reason string.
 */
export function verifyAccessToken(
  token: string,
  config: CloudflareConfig,
  keys: readonly JsonWebKey[],
  nowMs = Date.now(),
): AccessResult {
  const parts = token.split('.')
  if (parts.length !== 3 || parts.some((part) => part === '')) return { identity: null, reason: 'malformed token' }
  const [headerSegment, payloadSegment, signatureSegment] = parts as [string, string, string]
  const header = decodeSegment(headerSegment)
  const payload = decodeSegment(payloadSegment)
  if (header === null || payload === null) return { identity: null, reason: 'undecodable token' }
  if (header['alg'] !== 'RS256') return { identity: null, reason: `unsupported algorithm ${String(header['alg'])}` }
  const kid = typeof header['kid'] === 'string' ? header['kid'] : ''
  const key = keys.find((candidate) => (candidate as { kid?: string }).kid === kid)
  if (key === undefined) return { identity: null, reason: `unknown key id ${kid}` }
  let signature: Buffer
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
  const audience = payload['aud']
  const audiences = Array.isArray(audience) ? audience.filter((item): item is string => typeof item === 'string') : [String(audience)]
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
 * @param token - the assertion header value.
 * @param config - team domain and audience.
 * @param nowMs - current epoch ms.
 * @returns the identity, or a reason string.
 */
export async function verifyAccessRequest(
  token: string,
  config: CloudflareConfig,
  nowMs = Date.now(),
): Promise<AccessResult> {
  const keys = await fetchJwks(config.teamDomain, nowMs)
  if (keys === null) return { identity: null, reason: 'could not fetch team keys' }
  return verifyAccessToken(token, config, keys, nowMs)
}

/** Drop cached keys (used when the configuration changes). */
export function forgetJwks(): void {
  jwksCache.clear()
}
