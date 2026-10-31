/**
 * Public host surface of `dsh-share-webui`: the Cordis plugin shape plus the
 * helpers that derive a host allow-list from a selection. Runtime lives in
 * `lib/index.js`; this file only describes it for TypeScript consumers.
 */

import type { Context } from '@deepseek-ai/cordis'

/** Plugin name used by the loader. */
export declare const name: 'dsh-share-webui'

/** Traditional Cordis services; the service class declares its own inject list. */
export declare const inject: readonly string[]

/** Host Typert manifest registered when this package mounts. */
export declare const TYPERT: {
  readonly package: 'dsh-share-webui'
  readonly face: 'host'
  readonly schemas: readonly unknown[]
  readonly invocations: readonly unknown[]
  readonly model: {
    readonly services: readonly unknown[]
    readonly events: readonly unknown[]
    readonly objects: readonly unknown[]
  }
}

/** Plugin configuration. */
export interface Config {
  /** Fixed port; 0 disables the gateway. Default 47524. */
  fixedPort?: number
  /** Force one bind interface instead of deriving one per host. */
  fixedHost?: string
  /** Initial selection when nothing is persisted. */
  hosts?: readonly string[]
}

/** Normalize arbitrary keys into a selection; `loopback` is always present. */
export declare function selectionOf(raw?: readonly string[]): string[]

/** Translate the `hosts` config into an initial selection plus literal hosts. */
export declare function configHosts(configured?: readonly string[]): { keys: string[]; literals: string[] }

/** Concrete hosts a selection advertises, loopback first. */
export declare function hostsOf(keys: readonly string[], literals?: readonly string[]): string[]

/** Interfaces to listen on: one per concrete address, or wildcard when open. */
export declare function bindsOf(keys: readonly string[], hosts: readonly string[]): string[]

/** Mount the remote service and the fixed-port gateway. */
export declare function apply(ctx: Context, config?: Config): Promise<void>
