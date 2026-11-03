/**
 * Localized copy for the sharing settings section. The harness locale
 * registry accepts only the `en` | `zh` UI language codes today, so this
 * plugin ships those two dictionaries and follows the app's UI language.
 *
 * @module dsh-share-webui/client/locales
 */

/** Chinese (simplified) copy — source of truth for every key. */
export const zh = {
  /** Left-side settings navigation label. */
  nav: 'Web 共享',
  /** Page heading. */
  title: 'Web 共享',
  /** Host picker group label. */
  hostsLabel: '允许访问的主机',
  /** Host picker group guidance. */
  hostsDesc: '决定哪些来源可以打开固定入口;本机始终可用,其余选项需要对应网络已连通。',
  /** Loopback cube label. */
  hostLoopback: '本机',
  /** LAN cube label. */
  hostLan: '局域网',
  /** Tailscale cube label. */
  hostTailscale: 'Tailscale',
  /** Fully-open cube label. */
  hostAny: '全开放(危险)',
  /** Warning shown while fully open. */
  openWarning: '已开启全开放:任何能连到本机端口的人都能控制这个 harness。',
  /** Confirmation copy for enabling fully open. */
  openConfirm: '全开放会取消 Host 校验,局域网或公网设备都能直接操作你的 harness(执行命令、读写文件)。确认开启?',
  /** Confirm button for fully open. */
  openConfirmYes: '确认开启',
  /** Cancel button. */
  cancel: '取消',
  /** Host selector row label. */
  hostLabel: '主机',
  /** Host selector row guidance. */
  hostHint: '选择生成固定入口时使用的主机名。',
  /** Fixed entry row label. */
  fixedUrlLabel: '固定入口',
  /** Fixed entry guidance. */
  fixedUrlHint: '地址不随进程重启变化;切换上方主机后,这里会同步成新的入口地址。',
  /** Fixed entry unavailable feedback. */
  fixedUnavailable: '入口未启动（可能被关闭为 0，或端口被占用），可在 harness.log 中搜索 [dsh-share-webui] 查看原因。',
  /** Session link row label. */
  currentUrlLabel: '临时链接',
  /** Session link guidance. */
  currentUrlHint: '带本次会话令牌,仅在当前进程存活期间有效;重启后需要重新复制。',
  /** Copy button. */
  copy: '复制链接',
  /** Copy button after a successful copy. */
  copied: '已复制链接',
  /** Copy button for a short value (pairing code). */
  copyCode: '复制',
  /** Copy feedback for a short value. */
  copiedCode: '已复制',
  /** Loading feedback. */
  loading: '正在读取…',
  /** Load failure feedback. */
  loadFailed: '读取访问信息失败:{{message}}',
  /** Retry button shown after a load failure. */
  retry: '再试一次',
  /** Fixed port row label (host machine only). */
  portLabel: '固定端口',
  /** Fixed port row guidance. */
  portHint: '固定入口监听的端口；改动后立即重绑，地址会跟着变。填 0 表示关闭固定入口。',
  /** Apply button. */
  portApply: '应用',
  /** Probe says the port is taken. */
  portBusy: '端口已被占用',
  /** Probe says the value is not a valid port. */
  portInvalid: '端口号无效（0 或 1–65535）',
  /** Port switch succeeded and the port is reachable. */
  portFree: '端口可用',
  /** Port switch failed. */
  portFailed: '切换失败：{{message}}',
  /** Access-control block title (host machine only). */
  accessTitle: '访问控制',
  /** Access-control guidance. */
  accessHint: '除本机以外的设备需要配对码。在这里生成 6 位码，输入到那台设备的配对页上。',
  /** Button that reveals the pairing console. */
  accessOpen: '生成配对码',
  /** Button that mints another code. */
  accessRegenerate: '换一个配对码',
  /** Button that discards the pending code. */
  accessCancel: '取消配对码',
  /** Pairing-code group label. */
  accessCodeLabel: '配对码',
  /** Cloudflare Access group title. */
  cfTitle: 'Cloudflare Access',
  /** Cloudflare Access guidance. */
  cfHint: '通过 cloudflared 隧道进来的请求必须携带有效的 Access 断言；本机与局域网仍走配对，互不影响。首次启用后请重启 DSH：目录选择器会从宿主系统对话框切换为网页版。',
  /** Enable checkbox label. */
  cfEnable: '启用',
  /** Team domain field label. */
  cfTeam: 'Team domain',
  /** Audience field label. */
  cfAudience: 'AUD tag',
  /** Public hostname field label. */
  cfHost: '公网域名',
  /** Last verification succeeded. */
  cfLastOk: '最近通过：{{email}}（{{time}}）',
  /** Last verification failed. */
  cfLastFail: '最近一次隧道请求被拒：{{reason}}',
  /** No verification recorded yet. */
  cfNone: '还没有隧道请求经过验证。',
  /** Save failed. */
  cfFailed: '保存失败：{{message}}',
  /** Save succeeded. */
  cfSaved: '已保存',
  /** Expiry line under the code. */
  accessExpires: '有效期至 {{time}}，单次使用。',
  /** Minting failure line. */
  accessFailed: '生成失败：{{message}}',
  /** Paired-device list heading. */
  accessDevices: '已配对设备',
  /** Empty list placeholder. */
  accessNone: '还没有配对任何设备',
  /** Paired-device group guidance. */
  accessDevicesHint: '撤销后这台设备需要重新配对才能再次访问。',
  /** Per-device revoke button. */
  accessRevoke: '撤销',
  /** Device row secondary line. */
  accessMeta: '{{address}} · 配对于 {{time}}',
} as const

/** English copy mirroring {@link zh} key by key. */
export const en: Record<keyof typeof zh, string> = {
  nav: 'Web sharing',
  title: 'Web sharing',
  hostsLabel: 'Allowed hosts',
  hostsDesc: 'Which sources may open the fixed entry; this machine is always allowed, the rest need the matching network.',
  hostLoopback: 'This machine',
  hostLan: 'LAN',
  hostTailscale: 'Tailscale',
  hostAny: 'Any host (dangerous)',
  openWarning: 'Fully open: anyone who can reach this port controls this harness.',
  openConfirm: 'Fully open disables the Host check — any device on your LAN or the internet can control this harness (run commands, read and write files). Continue?',
  openConfirmYes: 'Open anyway',
  cancel: 'Cancel',
  hostLabel: 'Host',
  hostHint: 'Pick the host name used in the fixed entry.',
  fixedUrlLabel: 'Fixed entry',
  fixedUrlHint: 'The address survives restarts; switching the host above updates it in place.',
  fixedUnavailable: 'The entry is not running (disabled, or the port is taken); search harness.log for [dsh-share-webui] to see why.',
  currentUrlLabel: 'Session link',
  currentUrlHint: 'Carries this session token and stays valid only while the process lives; copy it again after a restart.',
  copy: 'Copy link',
  copied: 'Link copied',
  copyCode: 'Copy',
  copiedCode: 'Copied',
  loading: 'Reading…',
  loadFailed: 'Could not read the access info: {{message}}',
  retry: 'Try again',
  portLabel: 'Fixed port',
  portHint: 'Port behind the fixed entry; changing it rebinds immediately and the address follows. Use 0 to disable the fixed entry.',
  portApply: 'Apply',
  portBusy: 'Port is already in use',
  portInvalid: 'Invalid port (0 or 1-65535)',
  portFree: 'Port is available',
  portFailed: 'Could not switch: {{message}}',
  accessTitle: 'Access control',
  accessHint: "Devices other than this machine need a pairing code. Generate one here and type it on that device's pairing page.",
  accessOpen: 'Generate pairing code',
  accessRegenerate: 'Generate another',
  accessCancel: 'Cancel code',
  accessCodeLabel: 'Pairing code',
  cfTitle: 'Cloudflare Access',
  cfHint: 'Requests arriving through a cloudflared tunnel must carry a valid Access assertion; loopback and LAN keep using pairing. Restart dsh after enabling: the workspace folder picker then runs in the page.',
  cfEnable: 'Enabled',
  cfTeam: 'Team domain',
  cfAudience: 'AUD tag',
  cfHost: 'Public hostname',
  cfLastOk: 'Last verified: {{email}} ({{time}})',
  cfLastFail: 'Last tunnel request was rejected: {{reason}}',
  cfNone: 'No tunnel request has been verified yet.',
  cfFailed: 'Could not save: {{message}}',
  cfSaved: 'Saved',
  accessExpires: 'Valid until {{time}}, single use.',
  accessFailed: 'Could not mint a code: {{message}}',
  accessDevices: 'Paired devices',
  accessNone: 'No paired devices yet',
  accessDevicesHint: 'A revoked device has to pair again to get back in.',
  accessRevoke: 'Revoke',
  accessMeta: '{{address}} · paired {{time}}',
}

/** Typed key union of every dictionary entry. */
export type ShareWebuiKey = keyof typeof zh
