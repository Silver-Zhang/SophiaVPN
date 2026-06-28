# SophiaVPN macOS 安装与使用手册

[English](docs/macos-guide.md) | [中文](docs/macos-guide.zh-CN.md)

本文档是 SophiaVPN 的中文安装入口。完整文档请阅读：

- [macOS 使用指南](docs/macos-guide.zh-CN.md)
- [macOS Guide](docs/macos-guide.md)
- [订阅方案管理](docs/profile-management.zh-CN.md)
- [Profile Management](docs/profile-management.md)

## 快速安装

```bash
brew install node git curl

git clone https://github.com/Silver-Zhang/SophiaVPN.git
cd SophiaVPN
chmod +x scripts/*.sh bin/sophia
./scripts/install.sh
./scripts/install-sophia.sh
```

安装后会创建：

```text
~/.local/bin/sophiavpn
~/.local/bin/sophia
~/.local/bin/svpn          # 兼容旧命令
~/Applications/SophiaVPN.app
~/.config/SophiaVPN/
~/Library/Logs/SophiaVPN/launcher.log
```

## 基本使用

```bash
sophia import '<订阅链接或文件>' '我的方案'
sophia conflicts
sophia on
sophia status
sophia test
sophia off
```

## 冲突检测策略

SophiaVPN 可以在其他网络客户端存在时运行本地 HTTP/SOCKS 代理。但是，如果检测到其他 VPN/代理/网络接入软件，它不会自动接管 macOS 系统代理。

这是一条通用策略，不对某一个软件做特殊化。iNode 类校园/企业网络接入客户端可以作为本地代理共存场景，但 SophiaVPN 仍会跳过自动系统代理接管，以避免破坏已有 VPN、DNS、路由、kill-switch 或准入策略。

手动检查：

```bash
sophia conflicts
sophia doctor
```

如确认要覆盖系统代理，请先关闭冲突软件，或显式强制：

```bash
SOPHIA_FORCE_SYSTEM_PROXY=1 sophia system-proxy on
# 或
sophia system-proxy on --force
```
