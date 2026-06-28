# SilverVPN for macOS

[English](README.md) | [中文](README.zh-CN.md)

This branch ports SilverVPN to macOS. It provides a proxy-only VPN/proxy workflow built around the mihomo core, with both a lightweight macOS desktop controller and the `svpn` command-line interface.

The macOS branch is intended for:

- personal macOS laptops and desktops;
- terminal-based development workflows;
- VS Code Remote / local developer tools that honor HTTP/SOCKS proxy settings;
- users who need subscription import, node switching and system proxy control without changing low-level routing.

## Current scope

Implemented in this branch:

- macOS Electron runtime detection;
- Darwin mihomo core download for Apple Silicon and Intel Macs;
- `svpn` CLI on macOS;
- subscription import through `svpn import`;
- profile list/use/rename/delete;
- node list, delay test and node switching;
- smart/global/direct mode selection;
- terminal proxy integration;
- VS Code Remote proxy integration;
- macOS system proxy setup and cleanup through `networksetup`;
- a lightweight macOS desktop controller.

Not enabled in this branch:

- TUN mode on macOS;
- privileged route/DNS takeover;
- packet-filter or network-extension based full-tunnel routing.

Use proxy-only mode unless a future branch explicitly implements and audits macOS TUN or Network Extension support.

## Quick install

Install prerequisites. Homebrew is recommended:

```bash
brew install node git curl
```

Clone the macOS branch:

```bash
git clone -b macos https://github.com/Silver-Zhang/SilverVPN.git
cd SilverVPN
chmod +x scripts/*.sh bin/svpn
./scripts/install.sh
./scripts/install-svpn.sh
```

The installer creates:

```text
~/.local/bin/silvervpn
~/.local/bin/svpn
~/Applications/SilverVPN.app
~/.config/SilverVPN/
```

Open a new shell after installation, or run:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## Desktop usage

Launch the macOS desktop controller:

```bash
open "$HOME/Applications/SilverVPN.app"
```

Or start it directly:

```bash
~/.local/bin/silvervpn
```

The desktop controller calls the same `svpn` commands used by the terminal, so desktop and CLI state remain consistent.

## CLI usage

Import a subscription:

```bash
svpn import '<subscription-url-or-file>' 'My Profile'
```

Start SilverVPN:

```bash
svpn on
svpn status
```

`svpn on` starts the per-user mihomo backend, writes terminal proxy state, configures VS Code proxy files when present, and enables macOS system proxy for all network services through `networksetup`.

Stop SilverVPN:

```bash
svpn off
```

`svpn off` disables macOS system proxy and stops the current user's backend.

## macOS system proxy

You can manage the macOS system proxy explicitly:

```bash
svpn system-proxy status
svpn system-proxy on
svpn system-proxy off
```

The helper configures HTTP, HTTPS and SOCKS proxies for macOS network services using `networksetup`. It does not install a network extension, does not create a TUN device and does not change system routes.

## Documentation

| Topic | English | 中文 |
|---|---|---|
| macOS guide | [macOS Guide](docs/macos-guide.md) | [macOS 使用指南](docs/macos-guide.zh-CN.md) |
| Profile management | [Profile Management](docs/profile-management.md) | [订阅方案管理](docs/profile-management.zh-CN.md) |

## Validation

```bash
npm run check
svpn status
svpn test
```

## Safety model

The macOS branch is proxy-only. It does not use TUN, does not install kernel extensions, does not write system routes, and does not modify DNS settings directly. System-wide application proxy behavior is provided through Apple's `networksetup` system proxy settings.
