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

/** All invocations, in manifest order. */
export const INVOCATIONS = Object.freeze([
  readInvocation,
  selectInvocation,
  issueInvocation,
  revokeInvocation,
  checkPortInvocation,
  applyPortInvocation,
  cancelPairingInvocation,
])
