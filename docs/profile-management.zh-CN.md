# 订阅方案管理

[English](profile-management.md) | [中文](profile-management.zh-CN.md)

SilverVPN 会把导入的订阅保存为 profile。一个 profile 对应一个本地保存的配置来源，包含本地 YAML 文件、显示名称和节点元数据。

所有 profile 操作都是用户级操作，只修改当前用户自己的 `~/.config/SilverVPN` 目录。

## 查看方案

```bash
svpn profile list
```

当前正在使用的方案前会显示 `*`。

## 切换方案

```bash
svpn profile use 1
svpn profile use '我的方案'
```

选择器可以是编号、完整名称、profile id 或唯一名称片段。

## 重命名方案

```bash
svpn profile rename 1 '工作节点'
svpn profile rename 'Custom Subscription' '个人节点'
```

重命名只修改本地显示元数据，不会修改订阅服务商、订阅链接或其他用户的 profile。

## 删除方案

```bash
svpn profile delete 2
svpn profile delete 1 --yes
```

删除当前正在使用的方案需要 `--yes`。如果删除的是当前方案，SilverVPN 会保留 active Clash 配置文件，避免立刻破坏正在运行的后台。

## 安全边界

Profile 命令：

- 只操作当前用户自己的 HOME 目录；
- 不写 `/etc`；
- 不修改系统路由或 DNS；
- 不启用 TUN；
- 不修改其他用户文件。
