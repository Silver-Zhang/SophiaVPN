# SilverVPN macOS 使用指南

[English](macos-guide.md) | [中文](macos-guide.zh-CN.md)

本文档说明 SilverVPN 的 macOS 分支。

## 1. 功能范围

macOS 分支当前提供 proxy-only 工作流：

- mihomo 以普通用户进程运行；
- HTTP 和 SOCKS 代理监听在 localhost；
- 通过 `networksetup` 设置 macOS 系统代理；
- 通过 shell hook 同步终端代理变量；
- VS Code Remote 代理设置写入当前用户自己的 HOME 目录。

本分支暂不启用 TUN 模式。

## 2. 安装依赖

推荐使用 Homebrew：

```bash
brew install node git curl
```

检查版本：

```bash
node --version
npm --version
```

建议使用 Node.js 18 或更高版本。

## 3. 安装 SilverVPN

```bash
git clone -b macos https://github.com/Silver-Zhang/SilverVPN.git
cd SilverVPN
chmod +x scripts/*.sh bin/svpn
./scripts/install.sh
./scripts/install-svpn.sh
```

安装脚本会下载当前架构对应的 mihomo Darwin 核心：

```text
resources/clash-binaries/mihomo-darwin-arm64
resources/clash-binaries/mihomo-darwin-amd64
```

同时创建：

```text
~/.local/bin/silvervpn
~/.local/bin/svpn
~/Applications/SilverVPN.app
~/.config/SilverVPN/
```

## 4. 启动桌面控制器

```bash
open "$HOME/Applications/SilverVPN.app"
```

或：

```bash
~/.local/bin/silvervpn
```

macOS 桌面控制器是 `svpn` CLI 的轻量图形界面，可以导入订阅、开启/关闭 SilverVPN、运行测试、切换节点、切换模式和管理 profile。

## 5. CLI 工作流

导入订阅：

```bash
svpn import '<订阅链接或文件>' '我的方案'
```

启动 SilverVPN：

```bash
svpn on
```

查看状态：

```bash
svpn status
```

运行连通性测试：

```bash
svpn test
```

关闭 SilverVPN：

```bash
svpn off
```

## 6. 系统代理行为

在 macOS 上，`svpn on` 会执行：

```bash
svpn system-proxy on
```

该命令通过 `networksetup` 为 macOS 网络服务配置 HTTP、HTTPS 和 SOCKS 代理。

也可以手动查看或控制：

```bash
svpn system-proxy status
svpn system-proxy on
svpn system-proxy off
```

如果某些应用不读取 macOS 系统代理，可以在应用内手动配置：

```text
HTTP  代理：127.0.0.1:<http-port>
SOCKS 代理：127.0.0.1:<socks-port>
```

默认端口组会自动选择，也可以手动指定：

```bash
svpn config ports <base-port>
```

端口规则：

```text
base       HTTP 代理
base + 1   SOCKS 代理
base + 8   svpn service/API
base + 10  mihomo controller
```

## 7. Profile 管理

```bash
svpn profile list
svpn profile use 1
svpn profile rename 1 '新名称'
svpn profile delete 2
svpn profile delete 1 --yes
```

详见 [订阅方案管理](profile-management.zh-CN.md)。

## 8. 节点和模式

```bash
svpn nodes
svpn nodes --delay
svpn use 3

svpn mode smart
svpn mode global
svpn mode direct
```

这些模式只影响 mihomo 的代理路由，不会在本分支中启用 TUN。

## 9. 日志与数据

常用路径：

```text
~/.config/SilverVPN/
~/Library/Logs/SilverVPN/launcher.log
```

桌面控制器中提供打开数据目录和日志目录的按钮。

## 10. 更新

```bash
cd SilverVPN
git pull --ff-only
./scripts/install.sh
./scripts/install-svpn.sh
```

## 11. 常见问题

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
svpn system-proxy off
```

必要时也可以在 macOS 系统设置中检查当前网络服务的代理配置。

### TUN 不可用

这是当前 macOS 分支的预期行为。请使用 proxy-only 模式。
