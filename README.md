# dsh-share-webui

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![dsh](https://img.shields.io/badge/dsh-%3E%3D0.2.1--rc.2-4c6ef5.svg)](https://github.com/deepseek-ai/deepseek-harness)
[![topic](https://img.shields.io/badge/topic-dsh--plugin-8a2be2.svg)](https://github.com/topics/dsh-plugin)

**English** | [中文](README.zh.md)

Share this harness instance's Web GUI over a stable address. The plugin runs a
fixed-port forwarder inside the Host process, so a bookmark or phone keeps
working even though the harness port and launch token change on every restart.

- **Loopback is always served** (`http://127.0.0.1:30800` by default; the port is editable in settings), one listener per
  selected host — LAN and Tailscale addresses are opt-in.
- **Fully open is possible but guarded**: disabling the `Host` check requires an
  explicit confirmation in the settings page and logs a warning on every start.
- **Switch hosts live** from Settings → Web sharing; the choice is persisted and
  applied without restarting the harness.
- Works in both the Desktop and `dsh web` profiles.

## Why

`dsh web` and the Desktop shell mint a random port and a one-shot launch token
on every start. The printed URL therefore changes constantly, which makes it
useless for bookmarks, home-screen shortcuts, or a phone. This plugin keeps the
*address* stable and performs the token handshake internally.

## Install

```sh
# from GitHub
dsh plugin --profile desktop add github:vantoo/dsh-share-webui

# or from a local checkout (development)
dsh plugin --profile desktop add link:/absolute/path/to/dsh-share-webui
```

Restart the app after installing. For the web profile use
`--profile web` instead.

## Usage

Open **Settings → Web sharing**:

| Row | What it does |
| --- | --- |
| Fixed port | Port behind the fixed entry (default 30800). "Apply" probes first, then rebinds: success shows a green "Port is available", a taken port is reported in red and nothing switches. Use 0 to disable the fixed entry. |
| Allowed hosts | Appearance-style cubes showing the address and name: this machine (127.0.0.1, always on), LAN (192.168.x.x), Tailscale (100.x.x.x, also allows the MagicDNS name), Any host (0.0.0.0, dangerous). Multi-select; changing them rebinds the forwarder immediately. |
| Host | Which hostname the fixed entry uses; the dropdown lists only selected hosts. |
| Fixed entry | Stable URL, copy button. |
| Session link | Tokenized URL for this session, copy button. |
| Access control | **Host machine only** (desktop shell, or a settings page opened at 127.0.0.1): mint a six-digit code, see paired devices and revoke them one by one. The host decides, so a remote page never sees this block. |

The selection is persisted to `$DSH_HOME/share-webui.json`, so it survives
restarts; the `hosts` config below only seeds the first run.

The LAN address is discovered without shelling out: one UDP `connect` (no
packet sent, no name resolved) asks the OS to pick the route, and the socket's
local address is the default egress — the same code on macOS, Linux and
Windows. Only when that probe fails does it fall back to `route`/`ip` parsing,
then to an interface-name heuristic (`en*`/`eth*`/`wlan*`/`Wi-Fi`/`Ethernet`).

Selecting **Tailscale** also reads this machine's MagicDNS name from
`tailscale status --json` and adds `<machine>.<tailnet>.ts.net` to the allow
list: the host dropdown offers it, so the fixed entry can be
`http://<machine>.<tailnet>.ts.net:<port>` without tripping the Host check. It
opens no extra listener — the name resolves to the same 100.x address.

## Access control

The fixed entry does **not** welcome strangers by default: everything except
loopback has to pair once.

1. In **Settings → Web sharing → Access control** press "Generate pairing code"
   to get the six-digit code.
2. On the phone/tablet, open the fixed entry (e.g. `http://192.168.1.10:30800/`)
   and enter the code on the pairing page.
3. The browser then holds a `dsh-share-device` cookie (HttpOnly, SameSite=Lax,
   one year) and goes straight into the Web GUI.

Codes live 10 minutes and work once; "Cancel code" discards one immediately instead
of waiting for it to expire. One address gets at most 5 attempts per 5 minutes. A code is **not** burned by other people's wrong guesses (an earlier
build retired it after 5 misses, which turned into a pairing DoS).

The same settings block lists **paired devices** (label, last address, pairing
time) with a per-device "Revoke" button — revocation is immediate, no restart.

> The gateway serves **no management page**: unpaired peers only ever get the
> pairing form. Minting codes, listing devices and revoking them happen in the
> DSH settings page over host-validated RPC, never over that HTTP surface.

Devices are stored in `$DSH_HOME/share-webui-devices.json` (mode 600, only the
SHA-256 of each secret).

## Configuration

Optional — the settings page covers normal use. In the profile's
`cordis.patch.yml`:

```yaml
- id: share-webui
  name: dsh-share-webui
  config:
    fixedPort: 30800        # first-run port; 0 disables the fixed entry entirely
    fixedHost: 127.0.0.1    # force one bind interface instead of per-host
    access: pair            # pair (default) or open: anyone reaching the port gets in
    trustLoopback: true     # set false behind a tunnel/reverse proxy
    hosts:                  # initial defaults when no persisted selection exists
      - loopback
      - tailscale
```

`hosts` accepts the keywords `loopback`, `lan`, `tailscale`, `any` (and `*`),
plus literal host names. The bind interface is derived per selection: loopback
only → `127.0.0.1`, otherwise one listener per concrete IPv4, and `0.0.0.0`
only for `any`.

## Security

- The fixed entry carries an **already authenticated session**: whoever gets in
  controls this harness (tools, files, everything), which is why pairing is the
  default.
- The `Host` allow-list is **always enforced** now (`Any host` no longer skips
  it) and cross-site `Origin`s are rejected, so DNS rebinding cannot reach it.
- Plain HTTP is still cleartext: a sniffer on the same LAN can replay a device
  cookie. For real assurance keep the listener on loopback and let Tailscale /
  Cloudflare Tunnel authenticate the peer.
- A tunnel or reverse proxy (cloudflared, `tailscale serve`, nginx) makes every
  request look like loopback, and the default `trustLoopback: true` trusts them
  — **pairing does not hold behind a proxy**. Set `trustLoopback: false` there:
  the data plane and the console both close, so pair the devices over a direct
  connection first, or leave authentication to the tunnel itself.
- Management lives in the settings page and the host validates the caller
  (desktop shell `dsh-app:` or a loopback page); the gateway's public HTTP
  surface only has the pairing form and the logo, so a tunnel domain can neither
  list devices nor self-issue codes.

## How it works

The forwarder calls `connection.authenticatedUrl(loopback)` in-process — the
same API `dsh web` uses to build the URL it prints — performs the normal
`?token=` exchange, and keeps the resulting `dsh-auth-*` cookie in memory.
Browsers only ever talk to the fixed port: the proxy first decides who is
calling (loopback / device cookie / unpaired → pairing page), then rewrites
`Host`/`Origin` to the harness authority, swaps in the held cookie, strips
`Set-Cookie`, and forwards WebSocket upgrades (`/api/remote.mux`). A `401`
triggers one re-handshake and a replay.

## Development

`lib/` is the built artifact that DSH loads; `src/` is the TypeScript source.
The bundle was produced with the harness monorepo's `tsdown` preset, so
rebuilding requires checking this package into
[deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) under
`packages/client/` and running:

```sh
pnpm --filter dsh-share-webui typecheck
pnpm --filter dsh-share-webui bundle
```

Editing `lib/index.js` or `lib/client.js` directly also works for quick
iteration (restart the app afterwards).

> **`lib/` must be committed**: `dsh plugin add github:vantoo/dsh-share-webui`
> clones the repo and loads `lib/index.js` directly — there is no build step.
> That is why this repository ships both `src/` (readable sources) and `lib/`
> (runtime artifacts), the same split dshmarket uses.
>
> The cost is dual maintenance: **any change in `src/` must be mirrored in
> `lib/`** (and vice versa). Without the monorepo toolchain there is no
> generator, so diff the same logic in both trees before committing.

## License

MIT © 2026 [vantoo](https://github.com/vantoo).
