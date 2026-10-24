# 部署模型转发服务（Mac mini，D-131）

模型转发服务（`apps/api`，D-193）跑在创始人的 Mac mini 上，经 Cloudflare 隧道对外提供 `https://morph-api.stonetech.dev`。转发时不保存数据；它不认识 App 的版本，App 升级不用重新部署；唯一保存的是用户主动发来的需求（见下面「需求回收」），换机器时把那个文件一起拷走。

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

Android 直接装到手机上（release 包用调试密钥签名，能覆盖开发版，数据保留）：

```bash
cd apps/mobile && npx expo prebuild --platform android --no-install
cd android && EXPO_PUBLIC_MORPH_API_URL=https://morph-api.stonetech.dev \
  EXPO_PUBLIC_MORPH_CLIENT_TOKEN="$(grep '^MORPH_CLIENT_TOKEN=' ~/projects/morph-prod/.env | cut -d= -f2-)" \
  ./gradlew app:assembleRelease -PreactNativeArchitectures=arm64-v8a
adb -s <序列号> install -r app/build/outputs/apk/release/app-release.apk
```

下载的工具（D-177–D-179）：打包时再设 `EXPO_PUBLIC_MORPH_TOOLS_URL=<R2 上目录的地址>`。服务器不用知道下载的工具（提示词由 App 写，D-193）；发布步骤见 [TOOL_DOWNLOAD_DESIGN.md](TOOL_DOWNLOAD_DESIGN.md) §13。

客户端令牌会打包进 App，不是秘密（D-132）。换令牌会让旧版本 App 全部 401，所以只在被滥用时才换。

## 需求回收（D-189）

用户在 AI 做不到时点「把这个需求告诉我们」，那一句话追加到 `~/projects/morph-prod/apps/api/data/needs.jsonl`（一行一条 JSON：时间、这句话、语言、拒绝原因、用的哪种 AI、平台、版本；没有设备 id 和 IP）。目录在 `.gitignore` 里，发布新版本不会动它。换位置用 `.env` 的 `MORPH_NEEDS_FILE`。每台设备每天最多 20 条，全部合计每天 2000 条。

```bash
# 最近 20 条
tail -20 ~/projects/morph-prod/apps/api/data/needs.jsonl
# 按拒绝原因数一数（ai 是 mock 的多半是内置规则听不懂，不一定是缺功能）
jq -r '.reason + " " + (.ai // "?")' ~/projects/morph-prod/apps/api/data/needs.jsonl | sort | uniq -c
```

隐私政策上线时要写明：只有用户点了按钮才发送，发送的只有这一句话。

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
