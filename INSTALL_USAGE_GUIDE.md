# SilverVPN macOS 安装与使用手册

[English](docs/macos-guide.md) | [中文](docs/macos-guide.zh-CN.md)

本文档是 macOS 分支的兼容入口。完整文档请阅读：

- [macOS 使用指南](docs/macos-guide.zh-CN.md)
- [macOS Guide](docs/macos-guide.md)
- [订阅方案管理](docs/profile-management.zh-CN.md)
- [Profile Management](docs/profile-management.md)

## 快速安装

```bash
brew install node git curl

git clone -b macos https://github.com/Silver-Zhang/SilverVPN.git
cd SilverVPN
chmod +x scripts/*.sh bin/svpn
./scripts/install.sh
./scripts/install-svpn.sh
```

## 启动

桌面端：

```bash
open "$HOME/Applications/SilverVPN.app"
```

CLI：

```bash
svpn import '<订阅链接或文件>' '我的方案'
svpn on
svpn status
svpn test
svpn off
```

## macOS 系统代理

```bash
svpn system-proxy status
svpn system-proxy on
svpn system-proxy off
```

当前 macOS 分支采用 proxy-only 模式，不启用 TUN，不写系统路由，不直接修改 DNS。
