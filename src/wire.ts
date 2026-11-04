/**
 * Wire contract of the `shareWebui` namespace: result type, strict codecs and
 * the two invocation descriptors, shared by the host manifest and the client
 * Remote contribution.
 *
 * @module dsh-share-webui/wire
 */

import { z } from 'zod'
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'

/** Result of `current` and `updateHosts`. */
export interface ShareWebuiResult {
  /** Tokenized root URL of the live harness GUI. */
  readonly url: string
  /** Stable fixed-port URL, or null while the gateway is not listening. */
  readonly fixedUrl: string | null
  /** Concrete hosts the fixed address may be opened through. */
  readonly hosts?: readonly string[]
  /** Normalized selection keys behind the settings checkboxes. */
  readonly selection?: readonly string[]
  /**
   * `'host'` when the caller runs on this machine (desktop shell or loopback
   * page), `'remote'` otherwise. Device management is host-only.
   */
  readonly local?: string
  /** Paired devices, returned only to the host machine. */
  readonly devices?: readonly ShareWebuiDevice[]
  /** Fixed port in use, as a decimal string (0 = disabled). */
  readonly port?: string
  /** Cloudflare Access settings and last verification (host only). */
  readonly cloudflare?: ShareWebuiCloudflare
}

/** Cloudflare Access block shown in the settings page. */
export interface ShareWebuiCloudflare {
  /** `on` or `off`. */
  readonly enabled: string
  /** Team domain. */
  readonly teamDomain: string
  /** Access application AUD tag. */
  readonly audience: string
  /** Public hostname served through the tunnel, or empty. */
  readonly host: string
  /** Email of the last verified assertion, or empty. */
  readonly lastEmail: string
  /** Reason the last assertion was rejected, or empty. */
  readonly lastReason: string
  /** ISO time of the last verification, or empty. */
  readonly lastAt: string
}

/** One paired browser as the settings page sees it. */
export interface ShareWebuiDevice {
  /** Short public id. */
  readonly id: string
  /** Label captured at pairing time. */
  readonly label: string
  /** Address seen at the last authorized request. */
  readonly address: string
  /** ISO timestamp of pairing. */
  readonly pairedAt: string
  /** ISO timestamp of the last authorized request. */
  readonly seenAt: string
}

/** Strict result codec. */
export const RESULT_SCHEMA = z.object({
  url: z.string(),
  fixedUrl: z.string().nullable().optional(),
  hosts: z.array(z.string()).optional(),
  selection: z.array(z.string()).optional(),
  local: z.string().optional(),
  port: z.string().optional(),
  cloudflare: z.object({
    enabled: z.string(),
    teamDomain: z.string(),
    audience: z.string(),
    host: z.string(),
    lastEmail: z.string(),
    lastReason: z.string(),
    lastAt: z.string(),
  }).optional(),
  devices: z.array(z.object({
    id: z.string(),
    label: z.string(),
    address: z.string(),
    pairedAt: z.string(),
    seenAt: z.string(),
  })).optional(),
})

/** One freshly minted pairing code. */
export interface ShareWebuiPairing {
  /** Six digits. */
  readonly code: string
  /** ISO timestamp after which the code is dead. */
  readonly expiresAt: string
}

/** Strict pairing-code codec. */
export const PAIRING_SCHEMA = z.object({ code: z.string(), expiresAt: z.string() })

/** Strict codec for the page origin. */
export const ORIGIN_SCHEMA = z.string()

/** Strict codec for a selection. */
export const SELECTION_SCHEMA = z.array(z.string())

/** Reusable strict codec object for a string payload. */
const strict = (typeSymbol: string, schema: z.ZodType): object => Object.freeze({
  mode: 'strict',
  typeSymbol,
  schema,
  create: () => schema,
})

/** `shareWebui/current`: mint the tokenized URL for one page origin. */
export const readInvocation = Object.freeze({
  id: 'dsh-share-webui#shareWebui/current',
  service: 'shareWebui',
  namespace: 'shareWebui',
  method: 'current',
  invocation: Object.freeze({ kind: 'direct' }),
  parameters: Object.freeze([
    Object.freeze({ name: 'origin', wire: 'origin', source: 'json', codec: Object.freeze({
      mode: 'strict',
      typeSymbol: 'dsh-share-webui/types#origin',
      schema: ORIGIN_SCHEMA,
      create: () => ORIGIN_SCHEMA,
    }) }),
  ]),
  result: Object.freeze({
    mode: 'strict',
    typeSymbol: 'dsh-share-webui/types#ShareWebuiResult',
    schema: RESULT_SCHEMA,
    create: () => RESULT_SCHEMA,
  }),
  sourceLocation: Object.freeze({ file: 'src/wire.ts', line: 1, column: 1 }),
} as const) satisfies InvocationDescriptor

/** `shareWebui/updateHosts`: adopt a new selection and return the new state. */
export const selectInvocation = Object.freeze({
  id: 'dsh-share-webui#shareWebui/updateHosts',
  service: 'shareWebui',
  namespace: 'shareWebui',
  method: 'updateHosts',
  invocation: Object.freeze({ kind: 'direct' }),
  parameters: Object.freeze([
    Object.freeze({ name: 'origin', wire: 'origin', source: 'json', codec: strict('dsh-share-webui/types#origin', ORIGIN_SCHEMA) }),
    Object.freeze({ name: 'selection', wire: 'selection', source: 'json', codec: strict('dsh-share-webui/types#selection', SELECTION_SCHEMA) }),
  ]),
  result: strict('dsh-share-webui/types#ShareWebuiResult', RESULT_SCHEMA),
  sourceLocation: Object.freeze({ file: 'src/wire.ts', line: 1, column: 1 }),
} as const) satisfies InvocationDescriptor

/** `shareWebui/issuePairing`: mint a pairing code (host machine only). */
export const issueInvocation = Object.freeze({
  id: 'dsh-share-webui#shareWebui/issuePairing',
  service: 'shareWebui',
  namespace: 'shareWebui',
  method: 'issuePairing',
  invocation: Object.freeze({ kind: 'direct' }),
  parameters: Object.freeze([
    Object.freeze({ name: 'origin', wire: 'origin', source: 'json', codec: strict('dsh-share-webui/types#origin', ORIGIN_SCHEMA) }),
  ]),
  result: strict('dsh-share-webui/types#ShareWebuiPairing', PAIRING_SCHEMA),
  sourceLocation: Object.freeze({ file: 'src/wire.ts', line: 1, column: 1 }),
} as const) satisfies InvocationDescriptor

/** `shareWebui/revokeDevice`: forget one paired device (host machine only). */
export const revokeInvocation = Object.freeze({
  id: 'dsh-share-webui#shareWebui/revokeDevice',
  service: 'shareWebui',
  namespace: 'shareWebui',
  method: 'revokeDevice',
  invocation: Object.freeze({ kind: 'direct' }),
  parameters: Object.freeze([
    Object.freeze({ name: 'origin', wire: 'origin', source: 'json', codec: strict('dsh-share-webui/types#origin', ORIGIN_SCHEMA) }),
    Object.freeze({ name: 'id', wire: 'id', source: 'json', codec: strict('dsh-share-webui/types#id', z.string()) }),
  ]),
  result: strict('dsh-share-webui/types#ShareWebuiResult', RESULT_SCHEMA),
  sourceLocation: Object.freeze({ file: 'src/wire.ts', line: 1, column: 1 }),
} as const) satisfies InvocationDescriptor

/** Outcome of one port availability probe. */
export interface ShareWebuiPortCheck {
  /** `free` | `busy` | `invalid` | `current`. */
  readonly status: string
  /** Human-readable hint from the host. */
  readonly message: string
}

/** Strict port-check codec. */
export const PORT_CHECK_SCHEMA = z.object({ status: z.string(), message: z.string() })

/** Directory listing payload; JSON-encoded because the wire carries strings only. */
export const DIRECTORY_SCHEMA = z.object({ json: z.string() })

/** `shareWebui/browseDirectory`: list one host directory level. */
export const browseDirectoryInvocation = Object.freeze({
  id: 'dsh-share-webui#shareWebui/browseDirectory',
  service: 'shareWebui',
  namespace: 'shareWebui',
  method: 'browseDirectory',
  invocation: Object.freeze({ kind: 'direct' }),
  parameters: Object.freeze([
    Object.freeze({ name: 'origin', wire: 'origin', source: 'json', codec: strict('dsh-share-webui/types#origin', ORIGIN_SCHEMA) }),
    Object.freeze({ name: 'path', wire: 'path', source: 'json', codec: strict('dsh-share-webui/types#path', z.string()) }),
  ]),
  result: strict('dsh-share-webui/types#DirectoryListing', DIRECTORY_SCHEMA),
  sourceLocation: Object.freeze({ file: 'src/wire.ts', line: 1, column: 1 }),
} as const) satisfies InvocationDescriptor

/** `shareWebui/createFolder`: create one child directory on the host. */
export const createFolderInvocation = Object.freeze({
  id: 'dsh-share-webui#shareWebui/createFolder',
  service: 'shareWebui',
  namespace: 'shareWebui',
  method: 'createFolder',
  invocation: Object.freeze({ kind: 'direct' }),
  parameters: Object.freeze([
    Object.freeze({ name: 'origin', wire: 'origin', source: 'json', codec: strict('dsh-share-webui/types#origin', ORIGIN_SCHEMA) }),
    Object.freeze({ name: 'path', wire: 'path', source: 'json', codec: strict('dsh-share-webui/types#path', z.string()) }),
    Object.freeze({ name: 'name', wire: 'name', source: 'json', codec: strict('dsh-share-webui/types#name', z.string()) }),
  ]),
  result: strict('dsh-share-webui/types#DirectoryCreated', z.object({ path: z.string() })),
  sourceLocation: Object.freeze({ file: 'src/wire.ts', line: 1, column: 1 }),
} as const) satisfies InvocationDescriptor

/** `shareWebui/checkPort`: can this port be bound right now (host machine only). */
export const checkPortInvocation = Object.freeze({
  id: 'dsh-share-webui#shareWebui/checkPort',
  service: 'shareWebui',
  namespace: 'shareWebui',
  method: 'checkPort',
  invocation: Object.freeze({ kind: 'direct' }),
  parameters: Object.freeze([
    Object.freeze({ name: 'origin', wire: 'origin', source: 'json', codec: strict('dsh-share-webui/types#origin', ORIGIN_SCHEMA) }),
    Object.freeze({ name: 'port', wire: 'port', source: 'json', codec: strict('dsh-share-webui/types#port', z.string()) }),
  ]),
  result: strict('dsh-share-webui/types#ShareWebuiPortCheck', PORT_CHECK_SCHEMA),
  sourceLocation: Object.freeze({ file: 'src/wire.ts', line: 1, column: 1 }),
} as const) satisfies InvocationDescriptor

/** `shareWebui/applyPort`: switch the fixed port and rebind (host machine only). */
export const applyPortInvocation = Object.freeze({
  id: 'dsh-share-webui#shareWebui/applyPort',
  service: 'shareWebui',
  namespace: 'shareWebui',
  method: 'applyPort',
  invocation: Object.freeze({ kind: 'direct' }),
  parameters: Object.freeze([
    Object.freeze({ name: 'origin', wire: 'origin', source: 'json', codec: strict('dsh-share-webui/types#origin', ORIGIN_SCHEMA) }),
    Object.freeze({ name: 'port', wire: 'port', source: 'json', codec: strict('dsh-share-webui/types#port', z.string()) }),
  ]),
  result: strict('dsh-share-webui/types#ShareWebuiResult', RESULT_SCHEMA),
  sourceLocation: Object.freeze({ file: 'src/wire.ts', line: 1, column: 1 }),
} as const) satisfies InvocationDescriptor

/** `shareWebui/cancelPairing`: drop the pending pairing code (host machine only). */
export const cancelPairingInvocation = Object.freeze({
  id: 'dsh-share-webui#shareWebui/cancelPairing',
  service: 'shareWebui',
  namespace: 'shareWebui',
  method: 'cancelPairing',
  invocation: Object.freeze({ kind: 'direct' }),
  parameters: Object.freeze([
    Object.freeze({ name: 'origin', wire: 'origin', source: 'json', codec: strict('dsh-share-webui/types#origin', ORIGIN_SCHEMA) }),
  ]),
  result: strict('dsh-share-webui/types#ShareWebuiResult', RESULT_SCHEMA),
  sourceLocation: Object.freeze({ file: 'src/wire.ts', line: 1, column: 1 }),
} as const) satisfies InvocationDescriptor

/** `shareWebui/applyCloudflare`: update Access settings (host machine only). */
export const applyCloudflareInvocation = Object.freeze({
  id: 'dsh-share-webui#shareWebui/applyCloudflare',
  service: 'shareWebui',
  namespace: 'shareWebui',
  method: 'applyCloudflare',
  invocation: Object.freeze({ kind: 'direct' }),
  parameters: Object.freeze([
    Object.freeze({ name: 'origin', wire: 'origin', source: 'json', codec: strict('dsh-share-webui/types#origin', ORIGIN_SCHEMA) }),
    Object.freeze({ name: 'teamDomain', wire: 'teamDomain', source: 'json', codec: strict('dsh-share-webui/types#teamDomain', z.string()) }),
    Object.freeze({ name: 'audience', wire: 'audience', source: 'json', codec: strict('dsh-share-webui/types#audience', z.string()) }),
    Object.freeze({ name: 'host', wire: 'host', source: 'json', codec: strict('dsh-share-webui/types#host', z.string()) }),
    Object.freeze({ name: 'enabled', wire: 'enabled', source: 'json', codec: strict('dsh-share-webui/types#enabled', z.string()) }),
  ]),
  result: strict('dsh-share-webui/types#ShareWebuiResult', RESULT_SCHEMA),
  sourceLocation: Object.freeze({ file: 'src/wire.ts', line: 1, column: 1 }),
} as const) satisfies InvocationDescriptor

/** All invocations, in manifest order. */
export const INVOCATIONS = Object.freeze([
  readInvocation,
  selectInvocation,
  issueInvocation,
  revokeInvocation,
  checkPortInvocation,
  applyPortInvocation,
  cancelPairingInvocation,
  applyCloudflareInvocation,
  browseDirectoryInvocation,
  createFolderInvocation,
])
