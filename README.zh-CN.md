# SophiaVPN

[English](README.md) | [中文](README.zh-CN.md)

SophiaVPN 是一个面向 macOS 的 VPN 与代理客户端，来源于原 SilverVPN 的 macOS 分支。它现在作为独立项目开发，因为 macOS 桌面客户端的产品定位、系统代理策略和冲突处理逻辑，与 Linux/服务器方向的 SilverVPN 已经不同。

SophiaVPN 当前采用安全优先的 proxy-only 工作流：

- 本地 mihomo HTTP/SOCKS 代理；
- macOS 桌面控制器；
- `sophia` 命令行工具；
- 订阅导入与 profile 管理；
- 节点切换与延迟测试；
- 终端代理集成；
- VS Code 代理集成；
- 显式 macOS 系统代理集成；
- 在接管系统代理前检测其他 VPN/代理/网络接入客户端。

## 快速安装

```bash
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
```

## CLI

```bash
sophia import '<订阅链接或文件>' '我的方案'
sophia conflicts
sophia on
sophia status
sophia test
sophia off
```

## 冲突检测策略

SophiaVPN 可以在其他网络客户端存在时运行本地 HTTP/SOCKS 代理，但如果检测到其他 VPN/代理/网络接入软件，它不会自动接管 macOS 系统代理。

会检测的典型对象包括 Shadowrocket、ClashX/Clash Verge、Surge、sing-box、V2RayU 等代理管理器，以及 ExpressVPN、OpenVPN、WireGuard、Tailscale、GlobalProtect、AnyConnect、FortiClient、EasyConnect、iNode 类校园/企业网络接入客户端和类似工具。

这里不对某一个软件做特殊化处理。通用原则是：网络接入客户端可以和 SophiaVPN 的本地代理模式共存，但 SophiaVPN 会跳过自动系统代理接管，以避免破坏已有 VPN、DNS、路由、kill-switch 或准入策略。

手动检查：

```bash
sophia conflicts
sophia doctor
```

只有在你确认要覆盖系统代理，并且已经关闭或接受冲突风险时，才强制开启系统代理：

```bash
SOPHIA_FORCE_SYSTEM_PROXY=1 sophia system-proxy on
# 或
sophia system-proxy on --force
```

## 安全范围

SophiaVPN 当前不启用 TUN，不主动创建隧道网卡、pf 规则、路由表规则或 DNS 接管。默认工作流是本地代理，并在安全条件满足时才进行可选系统代理设置。
