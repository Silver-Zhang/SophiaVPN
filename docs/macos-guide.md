# SophiaVPN macOS Guide

[English](macos-guide.md) | [中文](macos-guide.zh-CN.md)

This guide describes SophiaVPN, a macOS-focused VPN/proxy client with a safe proxy-only default workflow.

## 1. Scope

SophiaVPN provides:

- a local mihomo HTTP/SOCKS proxy running as the current user;
- the `sophia` command-line workflow;
- a lightweight macOS desktop controller;
- subscription import and profile management;
- node listing, delay tests and node switching;
- smart/global/direct routing modes inside mihomo;
- terminal proxy synchronization through a shell hook;
- VS Code proxy integration;
- optional macOS system proxy integration through `networksetup`;
- VPN/proxy/network-access conflict detection before system-proxy takeover.

TUN mode is not enabled. SophiaVPN does not intentionally create tunnel interfaces, pf rules, route-table rules, or DNS takeover.

## 2. Install prerequisites

Homebrew is recommended:

```bash
brew install node git curl
```

Node.js 18 or newer is recommended.

## 3. Install SophiaVPN

```bash
git clone https://github.com/Silver-Zhang/SophiaVPN.git
cd SophiaVPN
chmod +x scripts/*.sh bin/sophia
./scripts/install.sh
./scripts/install-sophia.sh
```

The installer downloads the matching mihomo Darwin core:

```text
resources/clash-binaries/mihomo-darwin-arm64
resources/clash-binaries/mihomo-darwin-amd64
```

It also creates:

```text
~/.local/bin/sophiavpn
~/.local/bin/sophia
~/.local/bin/svpn          # compatibility alias
~/Applications/SophiaVPN.app
~/.config/SophiaVPN/
~/Library/Logs/SophiaVPN/launcher.log
```

## 4. Start the desktop controller

```bash
open "$HOME/Applications/SophiaVPN.app"
```

Or:

```bash
~/.local/bin/sophiavpn
```

The macOS desktop controller is a lightweight UI over the `sophia` CLI. It can import subscriptions, start/stop SophiaVPN, run tests, switch nodes, change modes, manage profiles, and show VPN/proxy conflict status.

## 5. CLI workflow

Import a subscription:

```bash
sophia import '<subscription-url-or-file>' 'My Profile'
```

Check conflicts before starting:

```bash
sophia conflicts
```

Start SophiaVPN:

```bash
sophia on
```

Check status and run tests:

```bash
sophia status
sophia test
```

Stop SophiaVPN:

```bash
sophia off
```

## 6. Conflict-aware system proxy behavior

SophiaVPN local HTTP/SOCKS proxy can run while other VPN/proxy/network-access clients are present. However, `sophia on` will not automatically take over macOS system proxy if it detects potentially conflicting software.

Detected examples include:

- proxy managers: Shadowrocket, ClashX, Clash Verge, Surge, Stash, Quantumult X, V2RayU, Loon, sing-box, other mihomo/clash clients;
- VPN clients: ExpressVPN, OpenVPN, WireGuard, Tailscale, ZeroTier, AnyConnect, GlobalProtect, FortiClient, Pulse Secure / Ivanti;
- network-access clients: iNode-like campus/company access clients, EasyConnect, Sangfor, ArraySSLVPN, MotionPro, and similar tools.

This is a generic policy. Network-access clients can be local-proxy coexistence cases, but SophiaVPN still avoids automatic system-proxy takeover to prevent breaking existing VPN, DNS, routing, kill-switch, or access-control policy.

Manual commands:

```bash
sophia system-proxy status
sophia system-proxy on
sophia system-proxy off
```

Force system proxy only after closing or intentionally overriding conflicting tools:

```bash
SOPHIA_FORCE_SYSTEM_PROXY=1 sophia system-proxy on
# or
sophia system-proxy on --force
```

If an application does not follow macOS system proxy settings, configure that application to use:

```text
HTTP  proxy: 127.0.0.1:<http-port>
SOCKS proxy: 127.0.0.1:<socks-port>
```

## 7. Ports

The default port group is selected automatically unless you run:

```bash
sophia config ports <base-port>
```

Port rule:

```text
base       HTTP proxy
base + 1   SOCKS proxy
base + 8   sophia service/API
base + 10  mihomo controller
```

## 8. Profiles

```bash
sophia profile list
sophia profile use 1
sophia profile rename 1 'New Name'
sophia profile delete 2
sophia profile delete 1 --yes
```

See [Profile Management](profile-management.md).

## 9. Nodes and modes

```bash
sophia nodes
sophia nodes --delay
sophia use 3

sophia mode smart
sophia mode global
sophia mode direct
```

These modes affect mihomo proxy routing only. They do not enable TUN.

## 10. Logs and data

Common paths:

```text
~/.config/SophiaVPN/
~/Library/Logs/SophiaVPN/launcher.log
```

The desktop controller has buttons to open the data and log directories.

## 11. Update

```bash
cd SophiaVPN
git pull --ff-only
./scripts/install.sh
./scripts/install-sophia.sh
```

## 12. Troubleshooting

### Electron is missing

```bash
./scripts/install-electron.sh
./scripts/install.sh
```

### mihomo download fails

Retry with an existing proxy:

```bash
HTTPS_PROXY=http://127.0.0.1:7890 ./scripts/install-core.sh
```

Or provide a direct asset URL:

```bash
MIHOMO_DOWNLOAD_URL='https://...' ./scripts/install-core.sh
```

### macOS system proxy remains enabled

```bash
sophia system-proxy off
```

If needed, open macOS System Settings and inspect the active network service proxy settings.

### TUN is unavailable

This is expected. Use proxy-only mode.
