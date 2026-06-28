# SophiaVPN macOS 使用指南

[English](macos-guide.md) | [中文](macos-guide.zh-CN.md)

本文档说明 SophiaVPN 的 macOS 版本。SophiaVPN 是一个面向 macOS 的 VPN/代理客户端，默认采用安全优先的 proxy-only 工作流。

## 1. 功能范围

SophiaVPN 提供：

- 当前用户自己的本地 mihomo HTTP/SOCKS 代理；
- `sophia` 命令行工作流；
- 轻量 macOS 桌面控制器；
- 订阅导入与 profile 管理；
- 节点列表、延迟测试和节点切换；
- mihomo 内部的 smart/global/direct 模式；
- 通过 shell hook 同步终端代理变量；
- VS Code 代理集成；
- 通过 `networksetup` 显式设置 macOS 系统代理；
- 在接管系统代理前检测其他 VPN/代理/网络接入客户端。

SophiaVPN 当前不启用 TUN，不主动创建隧道网卡、pf 规则、路由表规则或 DNS 接管。

## 2. 安装依赖

推荐使用 Homebrew：

```bash
brew install node git curl
```

建议使用 Node.js 18 或更高版本。

## 3. 安装 SophiaVPN

```bash
git clone https://github.com/Silver-Zhang/SophiaVPN.git
cd SophiaVPN
chmod +x scripts/*.sh bin/sophia
./scripts/install.sh
./scripts/install-sophia.sh
```

安装脚本会下载当前架构对应的 mihomo Darwin 核心：

```text
resources/clash-binaries/mihomo-darwin-arm64
resources/clash-binaries/mihomo-darwin-amd64
```

同时创建：

```text
~/.local/bin/sophiavpn
~/.local/bin/sophia
~/.local/bin/svpn          # 兼容旧命令
~/Applications/SophiaVPN.app
~/.config/SophiaVPN/
~/Library/Logs/SophiaVPN/launcher.log
```

## 4. 启动桌面控制器

```bash
open "$HOME/Applications/SophiaVPN.app"
```

或：

```bash
~/.local/bin/sophiavpn
```

macOS 桌面控制器是 `sophia` CLI 的轻量图形界面，可以导入订阅、开启/关闭 SophiaVPN、运行测试、切换节点、切换模式、管理 profile，并显示 VPN/代理冲突检测状态。

## 5. CLI 工作流

导入订阅：

```bash
sophia import '<订阅链接或文件>' '我的方案'
```

启动前检查冲突：

```bash
sophia conflicts
```

启动 SophiaVPN：

```bash
sophia on
```

查看状态并测试：

```bash
sophia status
sophia test
```

关闭 SophiaVPN：

```bash
sophia off
```

## 6. 冲突感知的系统代理行为

SophiaVPN 可以在其他 VPN/代理/网络接入客户端存在时运行本地 HTTP/SOCKS 代理。但是，如果 `sophia on` 检测到潜在冲突软件，它不会自动接管 macOS 系统代理。

典型检测对象包括：

- 代理管理器：Shadowrocket、ClashX、Clash Verge、Surge、Stash、Quantumult X、V2RayU、Loon、sing-box、其他 mihomo/clash 客户端；
- VPN 客户端：ExpressVPN、OpenVPN、WireGuard、Tailscale、ZeroTier、AnyConnect、GlobalProtect、FortiClient、Pulse Secure / Ivanti；
- 网络接入客户端：iNode 类校园/企业网络接入客户端、EasyConnect、Sangfor、ArraySSLVPN、MotionPro 和类似工具。

这是一条通用策略，不对某一个软件单独特殊化。网络接入客户端可以作为本地代理共存场景，但 SophiaVPN 仍会跳过自动系统代理接管，以避免破坏已有 VPN、DNS、路由、kill-switch 或准入策略。

手动命令：

```bash
sophia system-proxy status
sophia system-proxy on
sophia system-proxy off
```

只有在关闭冲突软件或明确接受覆盖风险时，才强制开启系统代理：

```bash
SOPHIA_FORCE_SYSTEM_PROXY=1 sophia system-proxy on
# 或
sophia system-proxy on --force
```

如果某些应用不读取 macOS 系统代理，可以在应用内手动配置：

```text
HTTP  代理：127.0.0.1:<http-port>
SOCKS 代理：127.0.0.1:<socks-port>
```

## 7. 端口

默认端口组会自动选择，也可以手动指定：

```bash
sophia config ports <base-port>
```

端口规则：

```text
base       HTTP 代理
base + 1   SOCKS 代理
base + 8   sophia service/API
base + 10  mihomo controller
```

## 8. Profile 管理

```bash
sophia profile list
sophia profile use 1
sophia profile rename 1 '新名称'
sophia profile delete 2
sophia profile delete 1 --yes
```

详见 [订阅方案管理](profile-management.zh-CN.md)。

## 9. 节点和模式

```bash
sophia nodes
sophia nodes --delay
sophia use 3

sophia mode smart
sophia mode global
sophia mode direct
```

这些模式只影响 mihomo 的代理路由，不会启用 TUN。

## 10. 日志与数据

常用路径：

```text
~/.config/SophiaVPN/
~/Library/Logs/SophiaVPN/launcher.log
```

桌面控制器中提供打开数据目录和日志目录的按钮。

## 11. 更新

```bash
cd SophiaVPN
git pull --ff-only
./scripts/install.sh
./scripts/install-sophia.sh
```

## 12. 常见问题

### Electron 缺失

```bash
./scripts/install-electron.sh
./scripts/install.sh
```

### mihomo 下载失败

可以通过已有代理重试：

```bash
HTTPS_PROXY=http://127.0.0.1:7890 ./scripts/install-core.sh
```

也可以指定直连下载地址：

```bash
MIHOMO_DOWNLOAD_URL='https://...' ./scripts/install-core.sh
```

### macOS 系统代理没有关闭

```bash
sophia system-proxy off
```

必要时也可以在 macOS 系统设置中检查当前网络服务的代理配置。

### TUN 不可用

这是预期行为。请使用 proxy-only 模式。
