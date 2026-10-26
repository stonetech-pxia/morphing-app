# Morph (working name)

A phone app you install once and then keep changing by describing what you want: its pages, its layout and its shortcuts. It ships with file tools (PDF, video, scanning, text recognition, QR codes, translation) that run on the device.

[中文](README.zh-CN.md) · [FAQ](#faq)

> Status: early. The app works in the simulator and on Android; there is no App Store release and no user data yet. Detailed docs are in Chinese for now.

## What it does

- **File tools that stay on your phone**: merge and compress PDFs, compress a video to a target size ("too big to send"), trim video, scan documents, recognize text, read QR codes, translate photos. Files are not uploaded anywhere.
- **Share sheet shortcuts**: share photos, videos or PDFs to Morph and run a shortcut in one tap, for example "merge PDFs" or "make this video small enough to send".
- **Change the app by describing it**: "turn the home screen into a file workspace and keep only Home, Tools and Settings in the tab bar", "add a page for tracking expenses", "make the font bigger". You compare before and after, then confirm. Every change can be undone from the change history.

## Two ways to use it

|                    | TestFlight beta                                    | Build it yourself                                                                                                                                                                                             |
| ------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install            | Join the TestFlight beta (link coming), iOS only   | Follow the build steps below, iOS or Android                                                                                                                                                                  |
| AI changes         | Claude through our relay server, with a free quota | Offline built-in rules by default; or paste your own Claude API key in Settings → AI to call Anthropic directly; or run your own relay (`npm run api`, then build with `EXPO_PUBLIC_MORPH_API_URL` set to it) |
| Your requests      | **Stored during the beta to improve the project**  | Never reach our server                                                                                                                                                                                        |
| Your files/records | Stay on the device                                 | Stay on the device                                                                                                                                                                                            |

**What the beta stores**: for each AI change, what the app sends to the relay: the planning prompt, the current app layout, what you typed (including earlier sentences in the same change) and the model's reply, plus a hash of the device id, platform, app version and time. It is used only to find requests the AI misunderstands and to improve the prompt and the test set.
**Never sent**: file contents and names, the data you record in pages, photos. The layout contains titles and text you wrote yourself, so don't put sensitive information in what you tell the AI. If you don't want your requests stored, build the app yourself and use your own key.

## Build it yourself

You need Node.js 22 or 24. For iOS: Xcode with the iOS simulator (`sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` once). For Android: JDK 17 and the Android SDK with `ANDROID_HOME` set.

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

The first build generates the native projects and takes a few minutes. No Apple account or API key is needed; AI changes use the offline built-in rules until you add a key. More detail (in Chinese) is in [README.zh-CN.md](README.zh-CN.md) and [docs/API_KEY_SETUP.md](docs/API_KEY_SETUP.md).

## FAQ

**ChatGPT and Claude can already handle files. Why this?**
They are better at understanding content (summarizing a contract, pulling a table out of a PDF), and Morph doesn't try to do that. Morph is for handling files: merging, compressing, scanning and converting with fixed tools on the phone, without uploading, with the same result every time. Things you do often become a shortcut you run from the share sheet in one tap, instead of uploading and explaining again. The AI is used once to build the shortcut; running it doesn't call the AI.

**Can the AI see my files?**
No. The model receives the app layout and your sentence; file contents, file names and recorded data are not part of it (see [docs/SECURITY_NOTES.md](docs/SECURITY_NOTES.md)). With our relay, requests pass through our server and are stored during the beta. With your own key, the app talks to Anthropic directly.

**Can the AI change anything?**
No. It edits pages, layout and shortcuts within what a fixed core allows ([docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)); it does not generate arbitrary code. Requests outside that are declined, and you can send them to us with "tell us about this need".

**Why only Claude? What about local models?**
Only the Anthropic API is supported today. The prompt and the checks live in the app (`packages/planner`), and switching models means re-running the evaluation set. Local models and OpenAI-compatible endpoints are not done yet; open an issue if you need them.

**Was this written by AI?**
Yes, mostly by Claude Code, partly by Codex. Product decisions, review and testing are done by the author, and every decision is recorded in [docs/DECISIONS.md](docs/DECISIONS.md). `npm run check` runs lint, type checks and tests; `npm run eval` runs the evaluation set against a real model.

**Will it become paid or closed?**
The code is AGPL-3.0 and what is published stays published. The on-device file tools don't depend on our server. The official app may later charge for AI quota on our server (pricing not decided); building it yourself with your own key is unaffected.

**Why are pull requests not accepted?**
The official app is distributed through app stores, so a Contributor License Agreement has to be settled before outside code can be merged ([CONTRIBUTING.md](CONTRIBUTING.md)). Issues are welcome.

**Why "Morph"?**
It's a working name. Other projects use it; the final name isn't decided.

## License

[AGPL-3.0](LICENSE)
