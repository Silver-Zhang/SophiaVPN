# SilverVPN multi-user proxy-only server guide

`svpn` is the headless per-user entry point for shared Linux servers.

Safety boundaries:

- No TUN, system routes, DNS changes, `sudo`, `/etc/environment` or `/etc/profile.d`.
- Every writable path is restricted to the invoking user's `$HOME`.
- Each user owns a separate config, subscription set, PID, logs, ports, shell state and VS Code Remote settings.

## Install

Run as each Linux user:

```bash
cd ~/app/SilverVPN
npm install
./scripts/install-svpn.sh
```

Open a new shell. `svpn` is installed at `~/.local/bin/svpn`.

## Personal ports

```bash
# silver
svpn config ports 4780

# zhangjunxiao
svpn config ports 4880
```

The base produces four loopback listeners:

```text
base       HTTP
base + 1   SOCKS
base + 8   service/API
base + 10  mihomo controller
```

Port settings are stored in `~/.config/SilverVPN/server.json`.

## One-click operation

```bash
svpn on
svpn status
svpn off
```

`svpn on` starts the current user's proxy-only daemon, enables terminal proxy state, and configures both VS Code Stable and Insiders Remote.

`svpn off` stops only the current user's daemon and removes only that user's terminal and VS Code proxy settings.

The installer adds a Bash/Zsh hook. New shells automatically inherit the current state. An already-running shell cannot be modified by a child process, but its next prompt synchronizes automatically when the hook is loaded.

## Subscriptions and nodes

```bash
svpn import '<private-subscription-url>' 'Lab subscription'
svpn profile list
svpn profile use 1

svpn nodes
svpn nodes --delay
svpn delay
svpn use 3
```

Do not paste private subscription URLs into shared logs or reports.

## Modes and tests

```bash
svpn mode smart
svpn mode global
svpn mode direct
svpn test
```

All three modes remain proxy-only. They do not enable TUN or modify system networking.

## Per-user files

```text
~/.config/SilverVPN/
~/.local/bin/svpn
~/.vscode-server/data/Machine/settings.json
~/.vscode-server/server-env-setup
~/.vscode-server-insiders/data/Machine/settings.json
~/.vscode-server-insiders/server-env-setup
```

VS Code settings use:

```json
{
  "http.proxy": "http://127.0.0.1:<personal-http-port>",
  "http.proxySupport": "override",
  "http.proxyStrictSSL": true
}
```
