# SophiaVPN

[English](README.md) | [中文](README.zh-CN.md)

SophiaVPN is a macOS-focused VPN and proxy client derived from the former SilverVPN macOS branch. It is now developed as an independent project because its product direction, system integration strategy, and compatibility requirements are different from the Linux/server-oriented SilverVPN project.

SophiaVPN focuses on a safe proxy-only workflow for macOS:

- local mihomo HTTP/SOCKS proxy;
- desktop controller for macOS;
- `sophia` command-line workflow;
- subscription import and profile management;
- node switching and delay tests;
- terminal proxy integration;
- VS Code proxy integration;
- optional, explicit macOS system proxy integration;
- VPN/proxy/network-access conflict detection before system-proxy takeover.

## Quick install

```bash
git clone https://github.com/Silver-Zhang/SophiaVPN.git
cd SophiaVPN
chmod +x scripts/*.sh bin/sophia
./scripts/install.sh
./scripts/install-sophia.sh
```

The installer creates:

```text
~/.local/bin/sophiavpn
~/.local/bin/sophia
~/.local/bin/svpn          # compatibility alias
~/Applications/SophiaVPN.app
~/.config/SophiaVPN/
```

## CLI

```bash
sophia import '<subscription-url-or-file>' 'My Profile'
sophia conflicts
sophia on
sophia status
sophia test
sophia off
```

## Conflict policy

SophiaVPN can run its local HTTP/SOCKS proxy while other network clients are present, but it will not automatically take over macOS system proxy if it detects other VPN/proxy/network-access software.

Detected examples include proxy managers such as Shadowrocket, ClashX/Clash Verge, Surge, sing-box and V2RayU, and VPN/network-access clients such as ExpressVPN, OpenVPN, WireGuard, Tailscale, GlobalProtect, AnyConnect, FortiClient, EasyConnect, iNode-like campus/company access clients, and similar tools.

This is a generic policy, not a product-specific exception. Network-access clients can be local-proxy coexistence cases, but SophiaVPN skips automatic system-proxy takeover to avoid breaking existing VPN, DNS, routing, kill-switch, or access-control policy.

Check manually:

```bash
sophia conflicts
sophia doctor
```

Force system proxy only after closing or intentionally overriding conflicting tools:

```bash
SOPHIA_FORCE_SYSTEM_PROXY=1 sophia system-proxy on
# or
sophia system-proxy on --force
```

## Software updates

The desktop app checks GitHub Releases after launch and every 12 hours thereafter. When a published release is newer than the local `package.json` version, SophiaVPN shows the update in Settings, the status menu, and a macOS notification. It never downloads, installs, or restarts the proxy automatically.

To publish an update, bump the version in `package.json` and create the matching GitHub Release, for example `v0.1.1`. Ordinary commits without a Release do not trigger update notifications.

## Safety scope

TUN mode is not enabled in SophiaVPN. It does not intentionally create tunnel interfaces, pf rules, route-table rules, or DNS takeover. The default workflow is local proxy plus optional system proxy.
