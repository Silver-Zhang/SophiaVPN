# SilverVPN 服务器终端版安装与使用指南

本文档适用于 server29 上的普通用户。每个用户使用自己的 Linux 账户、自己的订阅、自己的端口、自己的后台进程，互不影响。

SilverVPN 当前采用 **proxy-only** 模式：不使用 TUN，不修改系统路由，不修改系统 DNS，不写 `/etc/environment`，不写 `/etc/profile.d`，不影响 Slurm，只修改当前用户自己的 `$HOME` 目录。

---

## 1. 登录自己的账户

以 `wangjiacheng` 为例：

```bash
ssh wangjiacheng@192.168.9.29
whoami
```

输出应为自己的用户名。不要在别人的账户下安装、配置或运行 `svpn`。

---

## 2. 准备 SilverVPN 程序目录

如果管理员已经在服务器上准备了 SilverVPN 源码，可以复制到自己的目录：

```bash
mkdir -p ~/app
cp -a /home/silver/app/SilverVPN ~/app/SilverVPN
cd ~/app/SilverVPN
```

如果复制后安装时报权限错误，请联系管理员修正目录所有权。普通用户不要用 `sudo` 修复权限。

---

## 3. 安装依赖和核心程序

```bash
cd ~/app/SilverVPN
./scripts/install.sh
```

这个命令会安装 Node.js 依赖、Electron 运行时、mihomo 代理核心和 SilverVPN 所需的基础文件。

如果出现 `EACCES: permission denied`，说明 `~/app/SilverVPN` 目录权限不属于当前用户，请联系管理员修复。

---

## 4. 安装 svpn 命令

```bash
cd ~/app/SilverVPN
./scripts/install-svpn.sh
```

检查是否安装成功：

```bash
command -v svpn
svpn --help
```

正常情况下应看到：

```text
/home/<你的用户名>/.local/bin/svpn
```

如果提示找不到 `svpn`，请重新打开一个终端，或临时执行：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

---

## 5. 设置个人端口

所有用户的 SilverVPN 端口由管理员统一分配。请先查看公共端口表：

```bash
cat /data/public/SilverVPN/PORTS.md
```

如果你的账户下有 `public` 软链接，也可以执行：

```bash
cat ~/public/SilverVPN/PORTS.md
```

找到自己用户名对应的 `HTTP 端口`，然后执行：

```bash
svpn config ports <自己的HTTP端口>
```

例如 `wangjiacheng` 的 HTTP 端口是 `5080`，则执行：

```bash
svpn config ports 5080
```

检查端口设置：

```bash
svpn config ports
```

端口规则如下：

| 类型 | 规则 | 示例：base=5080 |
|---|---:|---:|
| HTTP 代理 | base | 5080 |
| SOCKS 代理 | base + 1 | 5081 |
| SilverVPN API | base + 8 | 5088 |
| mihomo Controller | base + 10 | 5090 |

---

## 6. 导入订阅

```bash
svpn import '<你的订阅链接>' '订阅方案名'
```

例如：

```bash
svpn import 'sub://xxxxxxxx' '熊猫云'
```

`'熊猫云'` 或 `'我的订阅'` 是自己起的本地显示名称，用于区分多个订阅方案。订阅链接是敏感信息，不要发到聊天、GitHub、公共文档、共享日志或截图中。

查看订阅方案：

```bash
svpn profile list
```

切换订阅方案：

```bash
svpn profile use 1
svpn profile use 熊猫云
```

---

## 7. 一键开启 SilverVPN

```bash
svpn on
```

`svpn on` 会自动完成：

1. 启动当前用户自己的 SilverVPN 后台 core；
2. 开启当前用户自己的终端代理；
3. 配置当前用户自己的 VS Code Stable Remote 代理；
4. 配置当前用户自己的 VS Code Insiders Remote 代理；
5. 不修改其他用户；
6. 不修改 `/etc`；
7. 不启用 TUN。

查看状态：

```bash
svpn status
```

正常输出类似：

```text
SilverVPN：运行中
用户：wangjiacheng
模式：智能代理 (rule)
节点：2 美国洛杉矶（支持chatgpt gemini claude）  180 ms
代理：HTTP 5080 / SOCKS 5081
终端代理：已开启
VS Code Stable：已配置 override
VS Code Insiders：已配置 override
后台：PID 12345
```

---

## 8. 终端代理生效说明

安装 `svpn` 后，会在当前用户自己的 shell 配置中加入 hook。通常情况下，新开的终端会自动读取代理状态。

检查当前终端代理环境：

```bash
env | grep -i proxy
```

测试出口 IP：

```bash
curl -s https://api.ipify.org
echo
```

如果刚执行完 `svpn on` 后当前终端暂时没有更新，重新打开一个终端即可。

---

## 9. 节点管理

查看节点：

```bash
svpn nodes
```

查看节点延迟：

```bash
svpn nodes --delay
svpn delay
```

切换节点：

```bash
svpn use 17
svpn use '2 美国洛杉矶'
```

切换后建议执行：

```bash
svpn status
svpn test
```

如果 GitHub 能通但 OpenAI、ChatGPT、Claude 或 Copilot 不通，通常是当前节点不适合这些服务，需要换节点。

---

## 10. 切换代理模式

```bash
svpn mode smart
svpn mode global
svpn mode direct
```

| 模式 | 含义 |
|---|---|
| smart | 智能代理，规则分流，推荐默认使用 |
| global | 全局代理，但仍然是 proxy-only，不是 TUN |
| direct | 直连模式 |

这里的 `global` 不会接管系统路由，也不会影响 Slurm。

---

## 11. 网络测试

```bash
svpn test
```

它会测试常用服务：出口 IP、GitHub、GitHub Copilot、OpenAI、ChatGPT、Claude、Anthropic API。

判断标准：

| 结果 | 含义 |
|---|---|
| HTTP 200 / 30x | 基本可达 |
| HTTP 401 | 服务可达，但需要认证 |
| HTTP 403 | 代理链路可达，但当前节点或服务拒绝访问 |
| timeout / SSL error | 当前节点不适合，需要换节点 |

---

## 12. VS Code / Copilot / Codex 使用说明

`svpn on` 会同时配置：

```text
~/.vscode-server/data/Machine/settings.json
~/.vscode-server-insiders/data/Machine/settings.json
~/.vscode-server/server-env-setup
~/.vscode-server-insiders/server-env-setup
```

VS Code 代理设置应为：

```json
{
  "http.proxy": "http://127.0.0.1:<你的HTTP端口>",
  "http.proxySupport": "override",
  "http.proxyStrictSSL": true
}
```

如果 VS Code 已经连接过服务器，建议在执行 `svpn on` 后重启当前用户自己的 VS Code Server：

```bash
pkill -f .vscode-server 2>/dev/null || true
pkill -f .vscode-server-insiders 2>/dev/null || true
```

然后重新连接 VS Code。

如果 CLI 能用，但 VS Code 扩展不能用，请先执行：

```bash
svpn status
svpn test
```

并确认 VS Code 扩展运行位置是 `SSH: server29`，不是本地 `LOCAL`。

---

## 13. 一键关闭 SilverVPN

```bash
svpn off
```

`svpn off` 会停止当前用户自己的后台 core，关闭当前用户自己的终端代理，移除当前用户自己的 VS Code Stable / Insiders 代理配置，不影响其他用户，不修改系统网络，不影响 Slurm。

关闭后查看状态：

```bash
svpn status
```

确认端口释放，例如 `wangjiacheng`：

```bash
ss -ltnp | grep -E '5080|5081|5088|5090' || echo "当前用户端口已释放"
```

---

## 14. 常用命令速查

```bash
svpn on
svpn off
svpn status

svpn config ports <自己的HTTP端口>
svpn config ports

svpn import '<订阅链接>' '方案名'
svpn profile list
svpn profile use 1
svpn profile use 方案名

svpn nodes
svpn nodes --delay
svpn delay
svpn use 17
svpn use '节点名称'

svpn mode smart
svpn mode global
svpn mode direct

svpn test
```

---

## 15. 常见问题

### `svpn on` 提示端口被占用

查看自己的端口是否被占用：

```bash
ss -ltnp | grep -E '<自己的端口>'
```

如果被其他用户占用，请联系管理员。不要改用别人的端口。

### `svpn test` 里 GitHub 正常，但 OpenAI / ChatGPT / Claude 不正常

这通常是节点问题。请切换节点：

```bash
svpn nodes --delay
svpn use <节点编号>
svpn test
```

### VS Code 扩展不能联网，但 CLI 可以

```bash
svpn status
svpn test
pkill -f .vscode-server 2>/dev/null || true
pkill -f .vscode-server-insiders 2>/dev/null || true
```

然后重新连接 VS Code，并确认：

```json
"http.proxySupport": "override"
```

### 安装时报 `EACCES: permission denied`

说明 `~/app/SilverVPN` 目录权限不属于当前用户。请联系管理员修复：

```bash
sudo chown -R 用户名:用户组 /home/用户名/app/SilverVPN
```

---

## 16. 禁止事项

普通用户不要执行：

```bash
sudo
./scripts/install-tun.sh
修改 /etc/environment
修改 /etc/profile.d
修改 /etc/bash.bashrc
修改系统 DNS
修改系统路由
```

也不要把订阅链接写入 GitHub、公共文档、群消息、聊天记录、共享日志或截图。
