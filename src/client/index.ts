/**
 * `dsh-share-webui`, browser half: mounts the `shareWebui` Remote
 * contribution, then registers the sharing page into the settings
 * section list (`settings.section`, id `share-webui`). All data arrives
 * through the `remote.shareWebui` namespace — the section issues no other
 * RPC and holds no state beyond the last fetched URL.
 *
 * @module dsh-share-webui/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the api-remotes client declares the 'remote' service on the
// client Context (the shell graph owns the runtime value; this package reads
// the merged contract).
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls ctx.locale into this program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ShareWebuiPairing, ShareWebuiPortCheck, ShareWebuiResult } from '../wire.ts'
import { WebUrlSection, type WebUrlSectionInjected } from './WebUrlSection.tsx'
import { en, zh, type ShareWebuiKey } from './locales.ts'
import { SHARE_WEBUI_REMOTE } from './remote.ts'

export type { WebUrlSectionInjected, WebUrlSectionProps } from './WebUrlSection.tsx'
export type { ShareWebuiKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Sharing settings page copy. */
    'settings.shareWebui': ShareWebuiKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.shareWebui'

// NOTE: the shipped workspace directory dialog is vendored verbatim into
// `lib/client.js` (`BROWSE_DICTIONARIES`, `DirectoryBrowser`). It is MIT code
// copied out of @deepseek-ai/dsh-client-ui-directory-picker-browse and lives in
// the runtime bundle only, because it is machine-generated and cannot be
// mirrored by hand. Its licence stays with the original package.

/** Plugin name: matches the package name, the graph row id, and the bundle id. */
export const name = 'dsh-share-webui'

/** Services the section reads; `remote.shareWebui` appears once this plugin mounts its contribution. */
export const inject = ['slots', 'locale', 'remote']

/**
 * Minimal structural contract of the client slots registry this section
 * registers into, named locally so the browser half compiles against the
 * settings slot surface without importing its owner package at runtime.
 */
interface SettingsSectionSlots {
  inject(slot: string, callback: () => unknown): void
  register(options: {
    name: 'settings.section'
    id: 'share-webui'
    order: number
    label: () => string
    locale: string
    inject: () => WebUrlSectionInjected
  }, component: unknown): () => void
}

/**
 * Browser plugin body: dictionaries, the Remote contribution mount, and the
 * settings section registration.
 * @param ctx - client root context.
 */
export async function apply(ctx: ClientContext): Promise<void> {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-share-webui: dictionaries')

  // $mount registers the 'remote.shareWebui' namespace service and owns its
  // removal for this fiber's lifetime.
  await ctx.remote.$mount(SHARE_WEBUI_REMOTE)

  ctx.inject(['remote.shareWebui'], (scope) => {
    // The slots service owner moved across harness lines; read it through the
    // local structural contract so both lines compile against the same shape.
    const slots = scope.get('slots') as unknown as SettingsSectionSlots
    const t = scope.locale.bind(NS)
    const unwrap = <T,>(result: RemoteResult<T>, method: string): T => {
      if (!result.ok) {
        throw new Error(`shareWebui.${method} failed: ${result.error.code}: ${result.error.message}`)
      }
      return result.value
    }
    const readUrl = async (): Promise<ShareWebuiResult> =>
      unwrap(await scope.remote.shareWebui.current(window.location.origin), 'current')
    const updateHosts = async (selection: readonly string[]): Promise<ShareWebuiResult> =>
      unwrap(await scope.remote.shareWebui.updateHosts(window.location.origin, selection), 'updateHosts')
    const issuePairing = async (): Promise<ShareWebuiPairing> =>
      unwrap(await scope.remote.shareWebui.issuePairing(window.location.origin), 'issuePairing')
    const revokeDevice = async (id: string): Promise<ShareWebuiResult> =>
      unwrap(await scope.remote.shareWebui.revokeDevice(window.location.origin, id), 'revokeDevice')
    const probePort = async (port: string): Promise<ShareWebuiPortCheck> =>
      unwrap(await scope.remote.shareWebui.checkPort(window.location.origin, port), 'checkPort')
    const setPort = async (port: string): Promise<ShareWebuiResult> =>
      unwrap(await scope.remote.shareWebui.applyPort(window.location.origin, port), 'applyPort')
    const clearPairing = async (): Promise<ShareWebuiResult> =>
      unwrap(await scope.remote.shareWebui.cancelPairing(window.location.origin), 'cancelPairing')
    const saveCloudflare = async (teamDomain: string, audience: string, host: string, enabled: boolean): Promise<ShareWebuiResult> =>
      unwrap(
        await scope.remote.shareWebui.applyCloudflare(window.location.origin, teamDomain, audience, host, enabled ? 'on' : 'off'),
        'applyCloudflare',
      )
    slots.inject('settings.section', () => slots.register({
      name: 'settings.section',
      id: 'share-webui',
      // After the built-in sections; the shell sorts ascending.
      order: 200,
      label: () => t('nav'),
      locale: NS,
      inject: (): WebUrlSectionInjected => ({ readUrl, updateHosts, issuePairing, revokeDevice, probePort, setPort, clearPairing, saveCloudflare }),
    }, WebUrlSection))
  })
}
