/**
 * Public browser surface of `dsh-share-webui`: the plugin shape the shell
 * mounts and the settings-section ids it registers. Runtime lives in
 * `lib/client.js`; this file only describes it for TypeScript consumers.
 */

import type { Context } from '@deepseek-ai/cordis'

/** Locale namespace owned by this plugin. */
export declare const NS: 'settings.shareWebui'

/** Plugin name used by the loader. */
export declare const name: 'dsh-share-webui'

/** Client services the browser half reads. */
export declare const inject: readonly string[]

/** One-shot RPC face injected into the settings section. */
export interface WebUrlSectionInjected {
  /** Read the current fixed and tokenized addresses. */
  readUrl: () => Promise<unknown>
  /** Change the host selection live. */
  updateHosts: (selection: readonly string[]) => Promise<unknown>
}

/** Mount the dictionaries, the Remote contribution and the settings page. */
export declare function apply(ctx: Context): Promise<void>
