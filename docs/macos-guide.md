# SilverVPN macOS Guide

[English](macos-guide.md) | [中文](macos-guide.zh-CN.md)

This document describes the macOS branch of SilverVPN.

## 1. Scope

The macOS branch provides a proxy-only VPN/proxy workflow:

- mihomo runs as a normal user process;
- HTTP and SOCKS proxies listen on localhost;
- macOS system proxy is configured through `networksetup`;
- terminal proxy variables are synchronized through a shell hook;
- VS Code Remote proxy settings are written under the current user's home directory.

TUN mode is not enabled in this branch.

## 2. Install prerequisites

Homebrew is recommended:

```bash
brew install node git curl
```

Check versions:

```bash
node --version
npm --version
```

Node.js 18 or newer is recommended.

## 3. Install SilverVPN

```bash
git clone -b macos https://github.com/Silver-Zhang/SilverVPN.git
cd SilverVPN
chmod +x scripts/*.sh bin/svpn
./scripts/install.sh
./scripts/install-svpn.sh
```

The installer downloads the matching mihomo Darwin core:

```text
resources/clash-binaries/mihomo-darwin-arm64
resources/clash-binaries/mihomo-darwin-amd64
```

It also creates:

```text
~/.local/bin/silvervpn
~/.local/bin/svpn
~/Applications/SilverVPN.app
~/.config/SilverVPN/
```

## 4. Start the desktop controller

```bash
open "$HOME/Applications/SilverVPN.app"
```

Or:

```bash
~/.local/bin/silvervpn
```

The macOS desktop controller is a lightweight UI over the `svpn` CLI. It can import subscriptions, start/stop SilverVPN, run tests, switch nodes, change modes, and manage profiles.

## 5. CLI workflow

Import a subscription:

```bash
svpn import '<subscription-url-or-file>' 'My Profile'
```

Start SilverVPN:

```bash
svpn on
```

Check status:

```bash
svpn status
```

Run connectivity tests:

```bash
svpn test
```

Stop SilverVPN:

```bash
svpn off
```

## 6. System proxy behavior

On macOS, `svpn on` runs:

```bash
svpn system-proxy on
```

This configures HTTP, HTTPS and SOCKS proxies for macOS network services using `networksetup`.

You can inspect or control it manually:

```bash
svpn system-proxy status
svpn system-proxy on
svpn system-proxy off
```

If an application does not follow macOS system proxy settings, configure that application to use:

```text
HTTP  proxy: 127.0.0.1:<http-port>
SOCKS proxy: 127.0.0.1:<socks-port>
```

The default port group is selected automatically unless you run:

```bash
svpn config ports <base-port>
```

Port rule:

```text
base       HTTP proxy
base + 1   SOCKS proxy
base + 8   svpn service/API
base + 10  mihomo controller
```

## 7. Profiles

```bash
svpn profile list
svpn profile use 1
svpn profile rename 1 'New Name'
svpn profile delete 2
svpn profile delete 1 --yes
```

See [Profile Management](profile-management.md).

## 8. Nodes and modes

```bash
svpn nodes
svpn nodes --delay
svpn use 3

svpn mode smart
svpn mode global
svpn mode direct
```

These modes affect mihomo proxy routing only. They do not enable TUN in this branch.

## 9. Logs and data

Common paths:

```text
~/.config/SilverVPN/
~/Library/Logs/SilverVPN/launcher.log
```

The desktop controller has buttons to open the data and log directories.

## 10. Update

```bash
cd SilverVPN
git pull --ff-only
./scripts/install.sh
./scripts/install-svpn.sh
```

## 11. Troubleshooting

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
svpn system-proxy off
```

If needed, open macOS System Settings and inspect the active network service proxy settings.

### TUN is unavailable

This is expected in the current macOS branch. Use proxy-only mode.
