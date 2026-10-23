# 部署计划服务（Mac mini，D-131）

计划服务（`apps/api`）跑在创始人的 Mac mini 上，经 Cloudflare 隧道对外提供 `https://morph-api.stonetech.dev`。服务不保存数据，重启、换机器都不丢东西。

```
App ──https──► Cloudflare ──隧道 morph-prod──► Mac mini 127.0.0.1:8788（launchd：dev.stonetech.morph-api）──► Claude
```

| 东西       | 位置                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------ |
| 生产代码   | `~/projects/morph-prod`（从本机仓库单独 clone，不从开发 worktree 运行）                    |
| 密钥和限额 | `~/projects/morph-prod/.env`（`ANTHROPIC_API_KEY`、`MORPH_CLIENT_TOKEN` 等）               |
| 服务       | `~/Library/LaunchAgents/dev.stonetech.morph-api.plist`                                     |
| 隧道       | `~/.cloudflared/morph-prod.yml`，`~/Library/LaunchAgents/dev.stonetech.morph-tunnel.plist` |
| 日志       | `~/Library/Logs/morph-api.log`、`~/Library/Logs/morph-tunnel.log`                          |

隧道和 simo 的分开：重启、修改 Morph 不影响 simo。

## 发布新版本

```bash
cd ~/projects/morph-prod
git fetch origin && git checkout --detach origin/main
npm ci
launchctl kickstart -k gui/$(id -u)/dev.stonetech.morph-api
curl -s https://morph-api.stonetech.dev/health
```

## 打包 App 时

构建时设置两个环境变量（会打包进 App）：

- `EXPO_PUBLIC_MORPH_API_URL=https://morph-api.stonetech.dev`
- `EXPO_PUBLIC_MORPH_CLIENT_TOKEN=` 与服务端 `.env` 中的 `MORPH_CLIENT_TOKEN` 相同

客户端令牌会打包进 App，不是秘密（D-132）。换令牌会让旧版本 App 全部 401，所以只在被滥用时才换。

## Mac 需要保持的状态

- 不睡眠（`pmset -g` 里 `sleep 0`），断电后自动开机（`autorestart 1`）。
- 开机后**自动登录**：LaunchAgent 在用户登录后才启动，系统更新重启后没有登录，服务就不会起来。
- 在 Anthropic 控制台设置每月花费上限：令牌能被取出，这是费用的最后一道保险。

## 排查

```bash
launchctl print gui/$(id -u)/dev.stonetech.morph-api | grep -E 'state|last exit'
tail -50 ~/Library/Logs/morph-api.log
~/.cloudflared/bin/cloudflared tunnel info morph-prod
```
