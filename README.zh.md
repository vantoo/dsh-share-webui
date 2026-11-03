# dsh-share-webui

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![dsh](https://img.shields.io/badge/dsh-%3E%3D0.2.1--rc.2-4c6ef5.svg)](https://github.com/deepseek-ai/deepseek-harness)
[![topic](https://img.shields.io/badge/topic-dsh--plugin-8a2be2.svg)](https://github.com/topics/dsh-plugin)

[English](README.md) | **中文**

把当前 harness 实例的 Web 界面共享到一个**固定入口**。插件在 Host 进程内起一个固定端口转发器，
所以即使 harness 每次重启都会换端口和启动 token，书签或手机上的地址依然有效。

- **本机始终可用**（默认 `http://127.0.0.1:30800`，端口可在设置页改），局域网和 Tailscale 按需勾选，**每个选中地址单独监听**；
- **全开放是危险选项**：需要二次确认，启动日志每轮都会告警；
- 设置页里**即时切换**，选择持久化，重启后沿用；
- Desktop 与 `dsh web` 两种 profile 都能用。

## 为什么需要它

`dsh web` 和桌面端每次启动都会随机分配端口、生成一次性启动 token，官方打印的 URL 因此一直在变，
没法收藏、没法做手机快捷方式。插件固定的是**入口**：地址不变，token 握手由代理在进程内完成。

## 安装

```sh
# 从 GitHub 安装
dsh plugin --profile desktop add github:vantoo/dsh-share-webui

# 或从本地目录（开发用）
dsh plugin --profile desktop add link:/绝对路径/dsh-share-webui
```

装完重启应用。web profile 把 `--profile desktop` 换成 `--profile web`。

## 使用

打开 **设置 → Web 共享**：

| 行 | 作用 |
| --- | --- |
| 固定端口 | 固定入口监听的端口（默认 30800）。「应用」会先探测再重绑：成功显示绿色「端口可用」，被占用则红字提示且不切换。填 `0` 关闭固定入口。 |
| 允许访问的主机 | 外观同款方块（地址 + 名称）：本机 (127.0.0.1，始终勾选)、局域网 (192.168.x.x)、Tailscale (100.x.x.x，同时放行 MagicDNS 域名)、全开放 (0.0.0.0,危险)。可多选，改动立即重绑代理。 |
| 主机 | 固定入口使用哪个主机名，下拉里只出现已勾选的地址。 |
| 固定入口 | 长期可用的地址，带复制按钮。 |
| 临时链接 | 本次会话的带 token 地址，带复制按钮。 |
| 访问控制 | **只在宿主机上出现**（桌面端，或 127.0.0.1 打开的设置页）：生成 6 位配对码、查看已配对设备、逐台撤销。由宿主判定来源，远端页面看不到这一块。 |

选择会写入 `$DSH_HOME/share-webui.json` 持久化；下面的 `hosts` 配置只作为首次运行的默认值。

「局域网」地址的判定不依赖任何平台命令：插件用一次 UDP `connect`（不发包、不解析域名）让操作系统自己选路，
直接拿到默认出口的本地地址，macOS / Linux / Windows 同一套逻辑；只有探测失败时才回退到 `route`/`ip`
解析，再不行按网卡名（`en*`/`eth*`/`wlan*`/`Wi-Fi`/`Ethernet`）挑。

勾选 **Tailscale** 时，插件会通过 `tailscale status --json` 读取本机的 MagicDNS 名
（`<machine>.<tailnet>.ts.net`），把它一并加入允许列表：主机下拉里会出现这个域名，选中后固定入口就是
`http://<machine>.<tailnet>.ts.net:<端口>`，用域名访问不会再被 Host 校验挡下。域名不额外开监听——它解析到
同一个 100.x 地址。

## 访问控制

固定入口默认**不欢迎陌生设备**：除本机（loopback）外，每台设备都要配对一次。

1. 桌面端 **设置 → Web 共享 → 访问控制** → 点「生成配对码」，拿到 6 位码；
2. 手机/平板打开固定入口（如 `http://192.168.1.10:30800/`），会看到配对页，输入这 6 位码；
3. 通过后浏览器拿到 `dsh-share-device` cookie（HttpOnly、SameSite=Lax、一年有效），之后直接进 Web 界面。

配对码 10 分钟内有效、单次使用；生成后若不想配对了，点「取消配对码」立即作废（不用等过期）。同一地址 5 分钟内最多 5 次尝试。**配对码不会因为别人乱试而作废**
（早期版本有“连错 5 次即作废”，那会被人拿来做配对 DoS，已去掉）。
同一个设置区块里能看到**已配对设备**（标识、最近地址、配对时间），每台可单独「撤销」——撤销立即生效，
不用重启。

> 网关本身**不提供管理网页**：对未配对的设备它只回一个配对表单。生成码、看设备、撤销全部只在 DSH
> 客户端的设置里，经宿主校验来源的 RPC 完成，远端页面拿不到这些能力。

设备记录写在 `$DSH_HOME/share-webui-devices.json`（权限 600，只存 secret 的 SHA-256）。

## Cloudflare Access（隧道）

用 `cloudflared` 把固定入口发布到公网时，所有请求的对端地址都会变成 `127.0.0.1`，配对会被绕过。开启这一项后，网关改为校验 Cloudflare 为每个请求签发的 `Cf-Access-Jwt-Assertion`：

- 只要请求带着 Cloudflare 边缘头（`cf-ray` / `cf-connecting-ip` / 断言本身），就**必须**有有效断言，否则拒绝——即使 `trustLoopback: true` 或 `access: open`
- 本机直连与局域网请求没有这些头，仍走原来的配对逻辑，两条路径互不影响
- 验签是严格的：只接受 RS256，校验 `iss` / `aud` / `exp` / `nbf`；密钥从 `<team>/cdn-cgi/access/certs` 获取并缓存 10 分钟，取不到密钥时**失败关闭**

### 记住设备（一年有效）

首次通过 Access 验证后，插件会给这台设备下发一个**一年期**的设备凭证（`dsh-share-device` cookie，与配对同款）。之后访问不再要求 Cloudflare 会话，相当于「登录一次管一年」。

- 设备列表里这台设备的名字就是 Access 的 email，可以单独撤销，撤销即时生效
- 所以 Cloudflare 那边的 `Session Duration` 只需覆盖「首次登录」那一次，不用设得很长
- 安全模型与配对一致：cookie 被偷 = 该设备被冒用，直到你撤销为止

### 配置步骤

1. 在 Cloudflare Zero Trust 建一个 Access 应用，指向隧道域名
2. 记下 **Application Audience (AUD) Tag** 与 team domain（形如 `myteam.cloudflareaccess.com`）
3. 设置 → Web 共享 → Cloudflare Access：填 **team domain、AUD tag、公网域名** 三项、勾「启用」、点「应用」
   （公网域名会并入 Host 白名单；不填的话隧道请求会被 403 挡掉）
4. 面板会显示最近一次隧道请求的结果：验证通过的 email，或拒绝原因

> 插件直接连 `https://<team>/cdn-cgi/access/certs`，不走系统代理。若宿主机必须经代理出网，验签会失败（失败关闭，不会误放行）。

## 配置

日常用设置页即可。需要固定端口/初始值时，在 profile 的 `cordis.patch.yml` 里：

```yaml
- id: share-webui
  name: dsh-share-webui
  config:
    fixedPort: 30800        # 首次运行的端口；0 表示完全关闭固定入口
    fixedHost: 127.0.0.1    # 强制指定绑定网卡，覆盖按主机推导
    access: pair            # pair(默认) 非本机需配对；open 谁能连上谁就能用
    trustLoopback: true     # 本机免配对；放在隧道/反代后面要设 false
    hosts:                  # 没有持久化选择时的初始值
      - loopback
      - tailscale
```

`hosts` 支持关键字 `loopback`、`lan`、`tailscale`、`any`（或 `*`），也可以写具体主机名。
绑定地址按选择推导：只有回环就绑 `127.0.0.1`；否则每个具体 IPv4 各起一个监听；只有 `any` 才绑 `0.0.0.0`。

## 安全

- 固定入口背后是**已登录会话**：能进来的人就能操作这个 harness（执行工具、读写文件），所以默认要求配对。
- `Host` 白名单**始终生效**（`全开放` 也不再跳过），跨站 `Origin` 会被拒绝，DNS rebinding 打不进来。
- 但普通 HTTP 仍是明文：同网段抓包能拿到设备 cookie 并重放。要真正安全，只留回环 + 走
  Tailscale / Cloudflare Tunnel 让隧道层做身份认证。
- 隧道或反代（cloudflared、`tailscale serve`、nginx）会让所有请求看起来都来自 `127.0.0.1`，
  默认的 `trustLoopback: true` 会把它们当作本机放行——**配对在代理链路后面不成立**。
  这种情况要设 `trustLoopback: false`：数据面和管理页会一起关闭，只能先在直连状态下配对好设备，
  或者干脆只依赖隧道自己的身份认证。
- 管理能力只在客户端设置里，由宿主校验调用来源（桌面壳 `dsh-app:` 或回环页面）；网关对外的 HTTP 面
  只剩配对表单和 logo，隧道域名既看不到设备列表也无法自助发码。

## 原理

转发器在进程内调用 `connection.authenticatedUrl(loopback)`——和 `dsh web` 打印链接用的是同一个 API——
完成一次正常的 `?token=` 握手，把拿到的 `dsh-auth-*` cookie 存在内存里。浏览器只和固定端口打交道：
代理先判断来客（本机放行 / 设备 cookie 校验 / 未配对则给配对页），再把 `Host`/`Origin` 改写成
harness authority、换上内部 cookie、剥掉 `Set-Cookie`，并转发 WebSocket 升级（`/api/remote.mux`）。
遇到 `401` 会重新握手并重放一次。

## 开发

`lib/` 是 DSH 实际加载的构建产物，`src/` 是 TypeScript 源码。产物由 harness 单仓的 `tsdown` 预设生成，
重新构建需要把本包放进 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的
`packages/client/` 下，然后：

```sh
pnpm --filter dsh-share-webui typecheck
pnpm --filter dsh-share-webui bundle
```

只做小改动时也可以直接编辑 `lib/index.js`、`lib/client.js`，之后重启应用。

> **`lib/` 是必须入库的**：插件用 `dsh plugin add github:vantoo/dsh-share-webui` 安装时是「clone 后直接
> 加载 `lib/index.js`」，没有构建步骤。因此本仓库同时提交 `src/`（可读源码）与 `lib/`（运行产物），
> 社区插件 dshmarket 也是这个做法。
>
> 代价是两侧要手工保持一致：**改 `src/` 时必须同步改 `lib/`**（反之亦然）。没有工具链时无法自动生成，
> 提交前请对照检查同一处逻辑。

## 许可

MIT © 2026 [vantoo](https://github.com/vantoo)。
