# Deploying the model relay service (Mac mini, D-131)

The model relay service (`apps/api`, D-193) runs on the founder's Mac mini and is exposed through a Cloudflare tunnel at `https://morph-api.stonetech.dev`. It does not know the app's version, so upgrading the app needs no redeploy. What it stores is only the requests users actively send (see "Collecting requests" below) and the requests during the test period (see "Saving requests during the test period" below); when changing machines, copy those two files along.

```
App ──https──► Cloudflare ──tunnel morph-prod──► Mac mini 127.0.0.1:8788 (launchd: dev.stonetech.morph-api) ──► Claude
```

| Item            | Location                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------- |
| Production code | `~/projects/morph-prod` (a separate clone of the local repository, not run from a dev worktree) |
| Keys and limits | `~/projects/morph-prod/.env` (`ANTHROPIC_API_KEY`, `MORPH_CLIENT_TOKEN`, etc.)                  |
| Service         | `~/Library/LaunchAgents/dev.stonetech.morph-api.plist`                                          |
| Tunnel          | `~/.cloudflared/morph-prod.yml`, `~/Library/LaunchAgents/dev.stonetech.morph-tunnel.plist`      |
| Logs            | `~/Library/Logs/morph-api.log`, `~/Library/Logs/morph-tunnel.log`                               |

This tunnel is separate from simo's: restarting or changing Morph does not affect simo.

## Releasing a new version

```bash
cd ~/projects/morph-prod
git fetch origin && git checkout --detach origin/main
npm ci
launchctl kickstart -k gui/$(id -u)/dev.stonetech.morph-api
curl -s https://morph-api.stonetech.dev/health
```

## When building the app

Set two environment variables at build time (they are bundled into the app):

- `EXPO_PUBLIC_MORPH_API_URL=https://morph-api.stonetech.dev`
- `EXPO_PUBLIC_MORPH_CLIENT_TOKEN=` the same as `MORPH_CLIENT_TOKEN` in the server's `.env`

To install on an Android phone directly (the release build is signed with the debug key, so it can overwrite the development build and the data is kept):

```bash
cd apps/mobile && npx expo prebuild --platform android --no-install
cd android && EXPO_PUBLIC_MORPH_API_URL=https://morph-api.stonetech.dev \
  EXPO_PUBLIC_MORPH_CLIENT_TOKEN="$(grep '^MORPH_CLIENT_TOKEN=' ~/projects/morph-prod/.env | cut -d= -f2-)" \
  ./gradlew app:assembleRelease -PreactNativeArchitectures=arm64-v8a
adb -s <serial> install -r app/build/outputs/apk/release/app-release.apk
```

Downloaded tools (D-177–D-179): at build time also set `EXPO_PUBLIC_MORPH_TOOLS_URL=<address of the catalog on R2>`. Scan flattening model (D-274): at build time set `EXPO_PUBLIC_MORPH_PACKS_URL=https://morph-tools.stonetech.dev/packs` (`packs/` in the R2 bucket `morph-tools`; paths carry the pack ID and version, and are only added to, never overwritten; when changing the model, update the version, size and hash in `packages/core/src/packs.ts`). The server does not need to know about downloaded tools (the prompt is written by the app, D-193); for the release steps see [TOOL_DOWNLOAD_DESIGN.md](TOOL_DOWNLOAD_DESIGN.md) §13.

The client token is bundled into the app and is not a secret (D-132). Changing the token makes every old app version return 401, so change it only when it is being abused.

## Collecting requests (D-189)

When the AI cannot do something, the user taps "Tell us you need this", and that one sentence is appended to `~/projects/morph-prod/apps/api/data/needs.jsonl` (one JSON per line: time, the sentence, language, rejection reason, which kind of AI was used, platform, version; no device id or IP). The directory is in `.gitignore`, so releasing a new version does not touch it. To change the location, use `MORPH_NEEDS_FILE` in `.env`. At most 20 per device per day, and 2000 per day in total.

```bash
# The last 20
tail -20 ~/projects/morph-prod/apps/api/data/needs.jsonl
# Count by rejection reason (where ai is mock, it is mostly that the built-in rules did not understand, not necessarily a missing feature)
jq -r '.reason + " " + (.ai // "?")' ~/projects/morph-prod/apps/api/data/needs.jsonl | sort | uniq -c
```

When the privacy policy goes live it must say: it is sent only when the user taps the button, and what is sent is only that one sentence.

## Saving requests during the test period (D-240)

During the TestFlight test, set `MORPH_REQUESTS_FILE=data/requests.jsonl` in the production `.env` (relative to `apps/api`, i.e. `~/projects/morph-prod/apps/api/data/requests.jsonl`). After restarting the service, the startup log shows "Saving requests to …". Each successful forward appends one JSON line: time, the first 8 characters of the device id hash, platform, app version, which round, `system` (the planning prompt), `messages` (the UI config and the user's words), the model reply, the stop reason, tokens. Nothing is saved if it is unset. How long to keep it and how to delete it are not decided yet (P-041); the file contains the user's own words, so do not copy it elsewhere or commit it.

```bash
# The last 5: the end of the first message (the user's words are last) and the start of the model reply
tail -5 ~/projects/morph-prod/apps/api/data/requests.jsonl | jq -r '.at, .messages[0].content[-200:], .reply[:200], ""'
# Replies without "kind" (mostly not change plans)
jq -c 'select(.reply | contains("\"kind\"") | not) | {at, reply: .reply[:200]}' ~/projects/morph-prod/apps/api/data/requests.jsonl
```

## State the Mac must keep

- No sleep (`sleep 0` in `pmset -g`), and power on automatically after a power loss (`autorestart 1`).
- **Automatic login** after boot: a LaunchAgent starts only after the user logs in, so after a system-update restart with no login the service will not come up.
- Set a monthly spend cap in the Anthropic console: the token can be extracted, so this is the last safeguard on cost.

## Troubleshooting

```bash
launchctl print gui/$(id -u)/dev.stonetech.morph-api | grep -E 'state|last exit'
tail -50 ~/Library/Logs/morph-api.log
~/.cloudflared/bin/cloudflared tunnel info morph-prod
```
