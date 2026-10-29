# Morph (working name)

A phone app you install once and then keep changing by describing what you want: its pages, its layout, its buttons and its shortcuts. It ships with file tools (PDF, images, video, audio, scanning, text recognition, QR codes, translation) that run on the device.

[中文](README.zh-CN.md) · [Try it](#try-it) · [Build it yourself](#build-it-yourself) · [FAQ](#faq)

> **Status: early.** The app, the file tools and the real AI (through a relay server or your own key) work on the iOS simulator and on an Android phone. Some features are covered only by automated tests and haven't been tried on a real device. There is no TestFlight or App Store release yet, and no users. Accounts and cloud sync exist only as designs. Progress and known limits are in [docs/MVP_SCOPE.md](docs/MVP_SCOPE.md) (in Chinese).
>
> Most docs are in Chinese; this README is the most complete English description.

## What it does

- **File tools that stay on your phone.** Files are processed on the device and never uploaded:
  - **PDF**: merge, split, compress, add page numbers, add or remove a password (iOS), fill and sign forms, convert Word / Excel / PowerPoint to PDF (Word only on Android). Scanned PDFs get searchable text.
  - **Images**: ID photos and print sheets, remove background, adjust, annotate, blur, watermark, stitch into a long image.
  - **Video**: compress to a target size ("too big to send"), trim, join, grab a frame, remove sound, replace music, rotate, crop to a ratio, speed up or slow down, export SRT subtitles, convert to GIF.
  - **Audio**: record, speech to text, text to speech (system voices, saved as a file), compress, convert formats (MP3 included), trim, join, extract audio from video, reduce background noise, adjust volume.
  - **Scanning, text recognition (OCR), QR codes, translation, ZIP, text and reports.**
- **Share sheet and inbox.** Share photos, videos or PDFs to Morph (or open them from the home screen buttons). The inbox shows the files and suggests up to five quick actions that fit them, for example "Combine documents" for several PDFs or "Video too big to send" for one video. One tap runs it. Results can be shared, saved to a folder, processed further, or combined into a new quick action.
- **Change the app by describing it.** "Add Open photo library and Open files buttons", "make the font bigger and remove shadows", "add a page for tracking expenses", "remove the AI entry". Look changes go into a draft first; you can keep refining, step back, apply or leave. Changes to features (quick actions, tools, data tables) are saved right away with an undo bar. Every version is in the change history.
- **Long-press to edit.** Long-press a component on a page to select it, drag to reorder, or open its edit panel.
- **Your own data stays out of the AI.** Pages can record things (expenses, logs) in local data tables. The AI changes the layout but never sees what you record.
- **Chinese, English and French**, following the system language.

## Two ways to use it

|                    | TestFlight beta                                    | Build it yourself                                                                                                                                                                                                                                                             |
| ------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install            | Join the TestFlight beta (link coming), iOS only   | [Build it](#build-it-yourself) for the iOS simulator or an Android phone                                                                                                                                                                                                      |
| AI changes         | Claude through our relay server, with a free quota | Offline built-in rules by default; or your own key from any provider in Settings → AI (Anthropic, or any OpenAI-compatible API: OpenAI, OpenRouter, DeepSeek, Gemini, Groq, Ollama, LM Studio…), called directly from the phone; or [run your own relay](#run-your-own-relay) |
| Your requests      | **Stored during the beta to improve the project**  | Never reach our server                                                                                                                                                                                                                                                        |
| Your files/records | Stay on the device                                 | Stay on the device                                                                                                                                                                                                                                                            |

**What the beta stores**: for each AI change, what the app sends to the relay: the planning prompt, the current app layout, what you typed (including earlier sentences in the same change) and the model's reply, plus a hash of the device id, platform, app version and time. It is used only to find requests the AI misunderstands and to improve the prompt and the test set.
**Never sent**: file contents and names, the data you record in pages, photos. The layout contains titles and text you wrote yourself, so don't put sensitive information in what you tell the AI. If you don't want your requests stored, build the app yourself and use your own key.

## Try it

UI labels below are the English ones; the app follows your system language. The example sentences work with a real AI model; with the offline built-in rules, use the phrasings in [docs/MOCK_AI_PHRASES.md](docs/MOCK_AI_PHRASES.md) (the built-in rules are a parser, not a language model).

1. **First launch.** After the intro pages the home screen is empty on purpose, with a bottom bar of **Home · AI · Settings**. The guide's first step offers one sentence, "add Open photo library and Open files buttons"; send it and the two buttons appear on the home screen ("Skip the guide" adds them too). Step 2 asks you to open a file. You can replay the guide from Settings.
2. **Process a file.** Tap **Open files** and pick a few PDFs → the inbox suggests "Combine documents" and other quick actions → tap **Run**. Or share files to Morph from Photos or Files. The result page offers Share, Save to a folder, Continue processing and Run again.
3. **Open a tool.** Settings → **Tools** lists the installed tools (PDF, Images, Video, Scanner, Text recognition and QR code come installed; tap **Add** for Audio, Translate, ZIP, Text and Reports). PDF → **Open** → tap the **Merge PDFs** tile → pick 2–20 PDFs → confirm the file name.
4. **Change the look.** Tap **AI** ("Change this app") and type `make the font bigger and remove shadows`. The change goes into a draft: the bottom bar has **Change / Step back / Apply / Leave**. Tap Apply to keep it.
5. **Build a feature.** Type `add a page for tracking expenses`. Morph creates a data table and offers "Add an entry now"; the page itself follows as the next step. Records are under Settings → Data, and the AI never sees them.
6. **Make a shortcut.** On a tool page, tap ✨ at the top right and type `merge PDFs and name the result "Merged-date"`. Feature changes are saved right away with an undo bar and a "done" page.
7. **More layout changes.** `add a banner image at the top of the home page` (then tap the image slot to pick a photo; the AI never sees it), `change the home icon to 🏡`, `add a page called Budget`, `remove the AI entry` (afterwards, get back in through Settings → Change this app).
8. **Undo anything.** Settings → **Change history** → restore any earlier version (it asks first), or tap **Undo** on the bar after a change.
9. **Video too big to send.** Video → **Make videos smaller** → pick a video → choose a size (20 MB by default) and quality → an MP4 you can play, share or save to Photos. **Trim a video** has start and end handles. On iOS, stay in Morph while a video is processing; on Android it keeps going in the background with a notification.
10. **PDF too big to upload.** PDF → **Make PDF smaller**. Text stays selectable; if it can't get small enough, it asks before turning pages into images.
11. **Translate.** Add **Translate** in Settings → Tools, then use "Translate text in photos". Settings → **Quick actions** ("What Morph can do") also has "Translate screenshots" and "Translate a foreign PDF". Translation runs on the device (iOS 18 system translation; Google ML Kit on Android, about 30 MB per language on first use) and produces plain text for understanding, not certified translations. Asking the AI to "translate this contract into English" builds a translate shortcut; the AI itself never translates your file.
12. **When the AI can't do something**, it says so and offers "Tell us you need this", which sends only that one sentence.

What the AI may change is described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#2-固定内核与可变层5).

## Build it yourself

No paid account or API key is needed. AI changes use the offline built-in rules until you add a key.

### Requirements

- Node.js 22.12+ or 24 (with npm)
- A C compiler (`cc`), only for `npm run check` (it compiles and tests the shared audio DSP code)
- **iOS simulator**: Xcode with the iOS simulator and its command line tools. Point the command line at it once (asks for your password):

  ```bash
  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
  ```

  No Apple account is needed: the development build is compiled locally and installed in the simulator unsigned.

- **Android**: JDK 17 and the Android SDK with `ANDROID_HOME` set, plus an emulator or a phone with USB debugging. Document scanning needs Google Play services on the phone.

The app is a **development build** (expo-dev-client), not Expo Go. In Expo Go the app still opens, but the native features (scanning, video, audio, speech, translation, documents, multi-file sharing, background tasks) are unavailable, and text recognition falls back to downloadable packs.

### Install and run

```bash
npm install
```

```bash
npm run ios
```

or

```bash
npm run android
```

The first `npm run ios` runs `expo prebuild` to generate `apps/mobile/ios/` (not in git; delete and regenerate it any time; it has two targets, the app and the `MorphShare` share extension), installs CocoaPods, builds the development app, installs it in the simulator and starts the dev server. It takes a few minutes; after that, JS changes don't need a rebuild. Run `npm run ios` again after changing native code (`apps/mobile/modules/`, `apps/mobile/plugins/`), native dependencies or `app.json` (delete `apps/mobile/ios/` first if you changed `plugins/`). If CocoaPods reports `Unicode Normalization not appropriate for ASCII-8BIT`, your terminal locale isn't UTF-8: `export LANG=en_US.UTF-8`.

The first `npm run android` generates `apps/mobile/android/` (not in git) and builds with Gradle. Text recognition uses Google ML Kit with the models bundled in the app.

If the development app is already installed and you only need the dev server:

```bash
npm start
```

Then open Morph in the simulator. If the simulator can't reach your LAN IP ("The request timed out"), use localhost:

```bash
npm start -- --localhost
```

```bash
xcrun simctl openurl booted "exp+morph://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
```

A real iPhone needs code signing with an Apple developer account; that and TestFlight aren't set up yet. For an Android release APK that installs on a phone, see [docs/DEPLOY.md](docs/DEPLOY.md) (in Chinese).

### Use a real AI

**Your own key (simplest).** In the app, Settings → AI → "My own API key", choose Anthropic or "OpenAI-compatible API", and enter the key (plus the base URL and model name for OpenAI-compatible APIs). The phone calls the provider directly. See [docs/API_KEY_SETUP.md](docs/API_KEY_SETUP.md).

**Through a local relay.** Put `ANTHROPIC_API_KEY=...` in a `.env` file at the repository root (copy `.env.example`), then in two terminals:

```bash
npm run api
```

```bash
npm run ios:ai
```

The first starts the relay on `http://127.0.0.1:8787`; the second builds the app pointing at it (this address only works from the simulator). The prompt is written in the app; the relay only adds the key, the model and the limits.

### Run your own relay

`apps/api` is a small Hono server: `POST /v1/complete` forwards the app's request to Claude (Haiku 5.5 by default), `POST /v1/needs` collects "Tell us you need this" sentences, and request storage can be switched on with `MORPH_REQUESTS_FILE`. It listens on `127.0.0.1` only, so to use it from a phone, put it behind a tunnel or reverse proxy with HTTPS (we use a Cloudflare tunnel), then build the app with `EXPO_PUBLIC_MORPH_API_URL` set to that address. Deployment notes are in [docs/DEPLOY.md](docs/DEPLOY.md).

| Variable (root `.env`)                                                        | Purpose                                                                        |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `ANTHROPIC_API_KEY`                                                           | Required for AI; without it `/v1/complete` returns 503                         |
| `MORPH_AI_MODEL`, `MORPH_AI_EFFORT`                                           | Model (default `claude-haiku-5-5`) and reasoning effort                        |
| `MORPH_API_PORT`                                                              | Port (default 8787)                                                            |
| `MORPH_MAX_OUTPUT_TOKENS`                                                     | Output cap (default 16000)                                                     |
| `MORPH_DEVICE_DAILY_USD`, `MORPH_GLOBAL_DAILY_USD`, `MORPH_OFF_PLAN_LIMIT`, … | Spending and abuse limits (see `.env.example`)                                 |
| `MORPH_CLIENT_TOKEN`                                                          | Optional; if set, build the app with the same `EXPO_PUBLIC_MORPH_CLIENT_TOKEN` |
| `MORPH_NEEDS_FILE`                                                            | Where "Tell us you need this" sentences go (default `data/needs.jsonl`)        |
| `MORPH_REQUESTS_FILE`                                                         | Off by default; if set, every relayed request is stored there                  |

App build variables: `EXPO_PUBLIC_MORPH_API_URL` (relay address), `EXPO_PUBLIC_MORPH_CLIENT_TOKEN` (if the relay checks one) `EXPO_PUBLIC_MORPH_TOOLS_URL` (optional catalog of signed downloadable tools; without it the app uses only its built-in tools) and `EXPO_PUBLIC_MORPH_PACKS_URL` (where the page flattening model for scanning is downloaded from, `https://morph-tools.stonetech.dev/packs`; without it scans are not flattened).

### Commands

| Command                                                    | What it does                                                                       |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `npm run check`                                            | The next seven checks, in order                                                    |
| `npm run lint`                                             | ESLint                                                                             |
| `npm run format:check`                                     | Prettier check (`npm run format` fixes)                                            |
| `npm run typecheck`                                        | TypeScript in every workspace                                                      |
| `npm test`                                                 | Tests in every workspace (Vitest for the packages and the relay, Jest for the app) |
| `npm run test:native-dsp`                                  | Compiles and tests the shared C audio code (loudness, noise reduction)             |
| `npm run check:licenses`                                   | Checks that dependency licenses are compatible with AGPL-3.0                       |
| `npm run check:locales`                                    | Checks that every UI string has its translations                                   |
| `npm run eval -- --model claude-haiku-5-5 [--cases A1,C1]` | Runs the evaluation set against a real model (costs a little API money)            |
| `npm run tools`                                            | Builds, signs and verifies the downloadable tool catalog                           |

### Repository layout

```
apps/mobile/                 Expo app (Expo Router, routes in src/app/; locales/ has en, zh-Hans, fr)
apps/mobile/modules/         Native modules (Swift + Kotlin):
  morph-vision                 OCR and document scanning (Vision on iOS, ML Kit on Android)
  morph-media                  Video and audio (AVFoundation / Media3), LAME MP3, loudness and noise reduction
  morph-speech                 Speech to text (system on iOS, whisper.cpp on Android)
  morph-tts                    Text to speech files with the system voices
  morph-translate              Translation (Translation framework on iOS 18+, ML Kit on Android)
  morph-docs                   Office to PDF and PDF passwords (iOS)
  morph-share                  Multi-file sharing and saving to folders
  morph-background             Keeps long tasks running (Android foreground service)
apps/mobile/plugins/         Config plugin and controller for the iOS share extension
apps/api/                    Relay server; scripts/eval.ts (evaluation), scripts/tools.ts (tool catalog)
packages/core/               Pure TypeScript core: schema, operations, validation, migrations, built-in rules, tool registry
packages/planner/            Prompt, validation and repair; shared by the relay and the app (Anthropic or OpenAI-compatible)
packages/tool-pdf/           PDF operations (pdf-lib)
packages/tool-image/         Image operations
packages/tool-qr/            QR codes
packages/tool-archive/       ZIP
tools/                       Sample downloadable tool and the development signing key (trusted only in dev builds)
scripts/                     License, locale and native DSP checks
docs/                        Architecture, scope, decisions, security notes, deployment (in Chinese)
```

Useful docs: [ARCHITECTURE](docs/ARCHITECTURE.md), [DECISIONS](docs/DECISIONS.md) (every product decision, numbered), [SECURITY_NOTES](docs/SECURITY_NOTES.md), [TOOLS_DESIGN](docs/TOOLS_DESIGN.md), [TOOL_DOWNLOAD_DESIGN](docs/TOOL_DOWNLOAD_DESIGN.md), [DATA_DESIGN](docs/DATA_DESIGN.md), [CLOUD_DESIGN](docs/CLOUD_DESIGN.md), [DEPLOY](docs/DEPLOY.md), [AGENTS.md](AGENTS.md) (rules for coding agents), and the original product brief [PRODUCT_HANDOFF_CLAUDE_CODE.md](PRODUCT_HANDOFF_CLAUDE_CODE.md).

### Platform notes

- iOS 16.4+ and Android 7 (API 24)+.
- iOS only: PDF passwords; Excel, PowerPoint and RTF to PDF (Android converts Word only).
- Needs a newer iOS: translation (iOS 18), background removal (iOS 17).
- Android: translation downloads about 30 MB per language and speech to text downloads a whisper model on first use; document scanning needs Google Play services; long tasks keep running in the background.

## FAQ

**ChatGPT and Claude can already handle files. Why this?**
They are better at understanding content (summarizing a contract, pulling a table out of a PDF), and Morph doesn't try to do that. Morph is for handling files: merging, compressing, scanning and converting with fixed tools on the phone, without uploading, with the same result every time. Things you do often become a shortcut you run from the share sheet in one tap, instead of uploading and explaining again. The AI is used once to build the shortcut; running it doesn't call the AI.

**Can the AI see my files?**
No. The model receives the app layout and your sentence; file contents, file names and recorded data are not part of it (see [docs/SECURITY_NOTES.md](docs/SECURITY_NOTES.md)). With our relay, requests pass through our server and are stored during the beta. With your own key, the app talks directly to the provider you chose, and Settings → AI shows which address that is.

**Can the AI change anything?**
No. It edits pages, layout and shortcuts within what a fixed core allows ([docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)); it does not generate arbitrary code. Requests outside that are declined, and you can send them to us with "Tell us you need this".

**Which models can I use? What about local models?**
With your own key, any provider: choose Anthropic, or "OpenAI-compatible API" and enter the base URL, the model name and the key (local models such as Ollama or LM Studio don't need a key). There are buttons that fill in the address for OpenAI, OpenRouter, DeepSeek, Gemini and Groq.
What has been tested: the Claude models (Haiku 5.5 is the default; the evaluation set in `npm run eval` runs against Claude). What has not: every other model and provider. They get the same instructions, and every reply goes through the same checks before anything is applied, so a wrong answer is refused rather than applied; but expect more misunderstood or refused requests than with Claude. Plain `http://` is only accepted for `localhost`, so a model on another computer (for example Ollama on your Mac while the app runs on your phone) needs an `https://` address. The beta's relay server uses Claude only.

**Was this written by AI?**
Yes, mostly by Claude Code, partly by Codex. Product decisions, review and testing are done by the author, and every decision is recorded in [docs/DECISIONS.md](docs/DECISIONS.md). `npm run check` runs lint, type checks and tests; `npm run eval` runs the evaluation set against a real model.

**Will it become paid or closed?**
The code is AGPL-3.0 and what is published stays published. The on-device file tools don't depend on our server. The official app may later charge for AI quota on our server (pricing not decided); building it yourself with your own key is unaffected.

**Why are pull requests not accepted?**
The official app is distributed through app stores, so a Contributor License Agreement has to be settled before outside code can be merged ([CONTRIBUTING.md](CONTRIBUTING.md)). Issues are welcome.

**Why "Morph"?**
It's a working name. Other projects use it; the final name isn't decided.

## License

[AGPL-3.0](LICENSE). Bundled native code under other compatible licenses: LAME 3.100 (LGPL-2.0+, for MP3 encoding), RNNoise (BSD), libebur128 (MIT) and whisper.cpp (MIT, fetched at build time on Android). The Android build links Google ML Kit, which is closed source; how that fits with AGPL is still being settled. Pull requests aren't accepted yet; issues are welcome ([CONTRIBUTING.md](CONTRIBUTING.md)).
