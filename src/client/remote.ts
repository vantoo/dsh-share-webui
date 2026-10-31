/**
 * The client-side Remote face of the `shareWebui` namespace: the hand-written
 * `TypertRemoteContribution` mounted through `ctx.remote.$mount`, plus the
 * declaration merging that types `ctx.remote.shareWebui`. The descriptor
 * list is shared with the host `./typert` manifest (`../wire.ts`), so the
 * two faces can never drift.
 *
 * @module dsh-share-webui/client/remote
 */

import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { INVOCATIONS } from '../wire.ts'
import type { ShareWebuiPairing, ShareWebuiPortCheck, ShareWebuiResult } from '../wire.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$shareWebui {
    /** Mint the current launch-token URL for this page's origin. */
    current: (origin: string) => Promise<RemoteResult<ShareWebuiResult>>
    /** Change the host selection live and return the refreshed result. */
    updateHosts: (origin: string, selection: readonly string[]) => Promise<RemoteResult<ShareWebuiResult>>
    /** Mint a pairing code; only the host machine is allowed. */
    issuePairing: (origin: string) => Promise<RemoteResult<ShareWebuiPairing>>
    /** Forget one paired device (host machine only). */
    revokeDevice: (origin: string, id: string) => Promise<RemoteResult<ShareWebuiResult>>
    /** Probe whether a port can be bound (host machine only). */
    checkPort: (origin: string, port: string) => Promise<RemoteResult<ShareWebuiPortCheck>>
    /** Switch the fixed port and rebind (host machine only). */
    applyPort: (origin: string, port: string) => Promise<RemoteResult<ShareWebuiResult>>
    /** Drop the pending pairing code (host machine only). */
    cancelPairing: (origin: string) => Promise<RemoteResult<ShareWebuiResult>>
    /** Update Cloudflare Access settings (host machine only). */
    applyCloudflare: (origin: string, teamDomain: string, audience: string, enabled: string) => Promise<RemoteResult<ShareWebuiResult>>
  }
  interface TypertRemoteMap {
    'shareWebui/current': (origin: string) => Promise<RemoteResult<ShareWebuiResult>>
    'shareWebui/updateHosts': (origin: string, selection: readonly string[]) => Promise<RemoteResult<ShareWebuiResult>>
    'shareWebui/issuePairing': (origin: string) => Promise<RemoteResult<ShareWebuiPairing>>
    'shareWebui/revokeDevice': (origin: string, id: string) => Promise<RemoteResult<ShareWebuiResult>>
    'shareWebui/checkPort': (origin: string, port: string) => Promise<RemoteResult<ShareWebuiPortCheck>>
    'shareWebui/applyPort': (origin: string, port: string) => Promise<RemoteResult<ShareWebuiResult>>
    'shareWebui/cancelPairing': (origin: string) => Promise<RemoteResult<ShareWebuiResult>>
    'shareWebui/applyCloudflare': (origin: string, teamDomain: string, audience: string, enabled: string) => Promise<RemoteResult<ShareWebuiResult>>
  }
  interface TypertRemoteNamespaceMap {
    shareWebui: TypertRemoteNamespace$shareWebui
  }
}

/** The client Remote contribution for the `shareWebui` namespace. */
export const SHARE_WEBUI_REMOTE = Object.freeze({
  package: 'dsh-share-webui',
  descriptors: INVOCATIONS,
} satisfies TypertRemoteContribution)
