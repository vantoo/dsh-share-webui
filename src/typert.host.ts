/**
 * The hand-written Typert HOST manifest for `dsh-share-webui`, exported as
 * `./typert` so the harness typert-loader registers the `shareWebui`
 * invocation automatically when this plugin mounts. Same shape as generator
 * output (validated by the loader): package face, no model/schemas, and the
 * canonical invocation list shared with the client Remote contribution
 * (`src/client/remote.ts`).
 *
 * The manifest rides the same bundle as the host entry (`./typert` maps to
 * `./lib/index.js`), so mounting this package activates both the plugin and
 * its wire vocabulary in one artifact.
 *
 * @module dsh-share-webui/typert
 */

import { INVOCATIONS } from './wire.ts'

/** Host Typert manifest (validated by `@deepseek-ai/dsh-typert-loader`). */
export const TYPERT = Object.freeze({
  package: 'dsh-share-webui',
  face: 'host',
  schemas: Object.freeze([]),
  invocations: INVOCATIONS,
  model: Object.freeze({
    services: Object.freeze([]),
    events: Object.freeze([]),
    objects: Object.freeze([]),
  }),
})
