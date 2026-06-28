# SilverVPN for macOS

[English](README.md) | [中文](README.zh-CN.md)

本分支用于将 SilverVPN 移植到 macOS。当前版本采用 proxy-only 工作方式，基于 mihomo 核心提供代理能力，并同时提供轻量桌面控制器和 `svpn` 命令行工具。

macOS 分支面向以下场景：

- 个人 Mac 笔记本和桌面电脑；
- 终端开发工作流；
- 支持 HTTP/SOCKS 代理的开发工具、CLI 工具和 IDE；
- 需要订阅导入、节点切换和系统代理控制，但不希望改动底层路由的用户。

## 当前功能范围

本分支已经实现：

- macOS Electron 运行时路径识别；
- Apple Silicon 和 Intel Mac 的 mihomo Darwin 核心下载；
- macOS 下的 `svpn` CLI；
- `svpn import` 订阅导入；
- profile 查看、切换、重命名、删除；
- 节点列表、延迟测试和节点切换；
- smart/global/direct 模式切换；
- 终端代理集成；
- VS Code Remote 代理集成；
- 通过 `networksetup` 设置和清理 macOS 系统代理；
- 轻量 macOS 桌面控制器。

本分支暂不启用：

- macOS TUN 模式；
- 特权路由或 DNS 接管；
- 基于 Packet Filter 或 Network Extension 的全局流量接管。

除非后续分支明确实现并审查 macOS TUN 或 Network Extension，否则建议使用 proxy-only 模式。

## 快速安装

建议通过 Homebrew 安装依赖：

```bash
brew install node git curl
```

克隆 macOS 分支：

```bash
git clone -b macos https://github.com/Silver-Zhang/SilverVPN.git
cd SilverVPN
chmod +x scripts/*.sh bin/svpn
./scripts/install.sh
./scripts/install-svpn.sh
```

安装后会创建：

```text
~/.local/bin/silvervpn
~/.local/bin/svpn
~/Applications/SilverVPN.app
~/.config/SilverVPN/
```

安装完成后建议重新打开终端，或执行：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## 桌面使用

启动 macOS 桌面控制器：

```bash
open "$HOME/Applications/SilverVPN.app"
```

也可以直接运行：

```bash
~/.local/bin/silvervpn
```

桌面控制器会调用同一套 `svpn` 命令，因此桌面端和命令行状态保持一致。

## CLI 使用

导入订阅：

```bash
svpn import '<订阅链接或文件>' '我的方案'
```

启动 SilverVPN：

```bash
svpn on
svpn status
```

`svpn on` 会启动当前用户自己的 mihomo 后台，写入终端代理状态，配置 VS Code 代理文件，并通过 `networksetup` 启用 macOS 系统代理。

关闭 SilverVPN：

```bash
svpn off
```

`svpn off` 会关闭 macOS 系统代理，并停止当前用户自己的后台。

## macOS 系统代理

可以显式管理 macOS 系统代理：

```bash
svpn system-proxy status
svpn system-proxy on
svpn system-proxy off
```

该 helper 通过 `networksetup` 为 macOS 网络服务配置 HTTP、HTTPS 和 SOCKS 代理。它不会安装 Network Extension，不创建 TUN 网卡，也不会修改系统路由。

## 文档

| 主题 | English | 中文 |
|---|---|---|
| macOS 使用指南 | [macOS Guide](docs/macos-guide.md) | [macOS 使用指南](docs/macos-guide.zh-CN.md) |
| 订阅方案管理 | [Profile Management](docs/profile-management.md) | [订阅方案管理](docs/profile-management.zh-CN.md) |

## 验证

```bash
npm run check
svpn status
svpn test
```

## 安全边界

macOS 分支当前是 proxy-only。它不使用 TUN，不安装内核扩展，不写系统路由，也不直接修改 DNS。面向普通应用的系统级代理能力由 macOS 自带的 `networksetup` 系统代理设置提供。
