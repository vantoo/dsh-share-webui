// ⚠️ 本文件与 tsconfig.json 只在 deepseek-harness 单仓内有效:
// 它 import 的是 <harness>/packages/client/tsdown.client.ts(共享 UI 插件预设),
// 因此本文件必须位于 <harness>/packages/client/dsh-share-webui/ 下才可用。
// 单独 clone 本仓库无法直接构建 —— 重建步骤见 README「从源码重建」。
import { clientBundle } from '../tsdown.client.ts'

/**
 * Single dynamic UI-plugin bundle: host entry (lib/types/index.js) plus the
 * browser half (src/client/index.ts → lib/client.js, module-loader format).
 * NOTE: this build manifest declares no peerDependencies on purpose — the
 * host artifact must stay fully self-contained (zero bare imports) because
 * desktop profile plugins live outside the app's node_modules tree; every
 * runtime value (cordis, typert-protocol, zod) is bundled. The SHIPPED
 * package.json keeps peers for documentation only.
 */
export default clientBundle('dsh-share-webui', ['lib/types/index.js'])
