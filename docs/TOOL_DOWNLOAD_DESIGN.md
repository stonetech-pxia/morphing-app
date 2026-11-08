# Downloading new tools from the server

> Status: **step one (data tools) is implemented** (D-177–D-179, §13); step two (plugin tools) has not started. The founder decided the direction on 2026-10-23 (only we write them, tools that need system capabilities still ship with app releases, two steps) and the details of section 12 on 2026-10-24.
> UI wording follows D-112: in text shown to users, "workflow" is called "quick action", "pack" is called "downloads", and "install / uninstall" is called "add / remove"; code identifiers (`installTool`, `packs`, etc.) do not change. This document uses both wordings when describing the design; the ones in quotes are UI text.
> Related: [TOOLS_DESIGN.md](TOOLS_DESIGN.md) (action contract, executor, packs), [SECURITY_NOTES.md](SECURITY_NOTES.md), [DECISIONS.md](DECISIONS.md) P-011.

## 0. Goals and boundaries

**Goal**: the app can get new tools from the server without an app update. Once a new tool arrives it behaves like a built-in tool: it appears in the tool catalog, can be installed, uninstalled and undone, and the AI can use it to build quick actions.

**Decided boundaries** (founder, 2026-10-23):

1. **Tools are written only by us**, tested by us and signed and released by us. They are not opened to third parties (no tool marketplace, MVP_SCOPE §3), and the AI does not generate code on the spot from the user's words.
2. **Actions that need system capabilities still ship with app releases**: Vision, AVFoundation, the camera, local native modules, third-party native libraries. This is fixed by App Review rule 4.7.2 (§2).
3. **Two steps**: step one ships only **data tools** (pages, quick actions, presets, which only combine existing actions); step two ships **plugin tools** (new actions implemented in JS / WASM, run in a sandboxed WebView).

**Principles that do not change**: files are processed only on the device; the AI cannot see file content, file names or records (D-036, D-046); workflows are linear, with no branches or loops; the AI only outputs operations.

**Principles to change** (when step two goes live; step one needs no change):

| Where                                                                       | Now                                                     | Change to                                                                                                                                                          |
| --------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SECURITY_NOTES rule 2                                                       | Dynamic code loading is not supported                   | Load only plugin code **signed and released by us**, run only in a sandboxed WebView, with no network access and no native API calls                               |
| Handoff document §8 "unknown executable code may not be loaded dynamically" | Same as above                                           | Same as above; change "unknown" to "not signed by us"                                                                                                              |
| SECURITY_NOTES rule 1                                                       | The phone executes no AI-generated code                 | **Unchanged**                                                                                                                                                      |
| D-064, D-151 (download addresses of packs and models are written in code)   | Addresses and SHA-256 hard-coded in `core/src/packs.ts` | Existing packs (code) merge into the plugin mechanism; data such as OCR languages and the whisper model move to the same signed catalog (§4); P-011 closes with it |

## 1. Three kinds of tools

| Kind               | What it contains                                                                                                                          | How it reaches the user          | Examples                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Built-in tools** | Actions that need system capabilities, new value types, new local operation UIs (§6), new UI components, changes to the executor and core | Ship with a new app version      | Text recognition (Vision / ML Kit), scanning, video compression later                                       |
| **Data tools**     | Tool page, quick actions, presets and scenarios, parameter specs, copy, icons; **refer only to existing actions**                         | Downloadable any time (step one) | Scenario tools such as "Rental documents" and "Expense claims"; a batch of new presets for an existing tool |
| **Plugin tools**   | Everything in a data tool + contracts (JSON) for new actions + implementation (JS / WASM) + the data files it needs (models, fonts, etc.) | Downloadable any time (step two) | PDF encryption, format conversion, new image filters, layout templates                                      |

To decide which kind a new tool is:

- If it can be built with existing actions only → data tool.
- If it needs a new action, but the new action is just "bytes of the input file → compute → bytes or text of the output file" and can be written in JS / WASM → plugin tool.
- If the new action needs system APIs, a new value type (such as `audio`, `video`) or a new local operation UI → built-in tool. Once the value type and local operation UI are in the app, later tools of the same kind can be plugin tools.

## 2. Platform rules and how we satisfy them

| Rule                                                                                                                      | Gist of the text                                                                                                                                                          | How we satisfy it                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [App Review 2.5.2](https://developer.apple.com/app-store/review/guidelines/)                                              | Apps may not download, install or execute code that introduces or changes features                                                                                        | Data tools contain no code. Plugin tools use the explicit exception in 4.7                                                                 |
| [App Review 4.7](https://developer.apple.com/app-store/review/guidelines/)                                                | Software not in the install package may be offered: HTML5 and JavaScript mini apps, mini games, chatbots, **plugins**; the developer is responsible for all of them       | Plugins are JS / WASM, run only in a WebView                                                                                               |
| 4.7.1                                                                                                                     | Follow the privacy rules (5.1); be able to filter objectionable content, report and respond promptly; charge per 3.1 if charging                                          | Plugins cannot use the network and process only on the device; every tool has "Report a problem" (§9); no charge                           |
| 4.7.2                                                                                                                     | Without Apple's prior permission, native APIs may not be exposed to plugins                                                                                               | A plugin gets input files and returns output only through fixed-format messages; it cannot call any local module                           |
| 4.7.3                                                                                                                     | Every time data or permissions are given to a plugin the user must clearly consent                                                                                        | At install, explain what the tool can do; the user picks the files on each run; plugins get no permissions such as photo library or camera |
| 4.7.4                                                                                                                     | Provide an index of all software with metadata, each with a universal link                                                                                                | A public tool catalog on the website, one universal link per tool, opening that tool in the app (§9)                                       |
| 4.7.5                                                                                                                     | Software beyond the app's age rating must be identifiable and access restricted by age                                                                                    | Publish only 4+ file tools; every tool in the catalog is marked with an age rating, and the release check rejects other ratings            |
| [Developer Agreement 3.3.1(B)](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/#b331) | Interpreted code may be downloaded: it must not change the primary purpose, bypass signing or the sandbox, or make a store for other apps                                 | Publish only file / document processing tools; run in the WebView sandbox; only our own tools, not a store                                 |
| [Google Play Device and Network Abuse](https://support.google.com/googleplay/android-developer/answer/16559646)           | Executable code such as dex / so may not be downloaded from outside Google Play; code in a virtual machine or interpreter is not restricted (for example JS in a WebView) | Download only JS / WASM; the WebView loads only the fixed page we ship with the app and no URLs                                            |

**Remaining uncertainty**: how reviewers read the relationship between 2.5.2 and 4.7 is decided at review time. To lower the risk:

- **The first time the plugin mechanism is submitted, include at least one downloadable plugin tool**, and write clearly in the review notes "file-processing plugin, offered under 4.7, all developed by us, processed only on the device", with the address of the public catalog attached.
- The app description says "new file tools can be downloaded".
- Fallback if rejected: turn plugin tools into built-in tools shipped with the app (neither the contract nor the implementation needs to change, only the way of releasing, §6). Data tools are unaffected.

## 3. Tool package format

A tool package is a directory (packed into one file when released) containing:

```
manifest.json      manifest (below)
code/…             plugin tools only: JS / WASM, entry in manifest.code.entry
data/…             optional: data files such as models and fonts, which can be downloaded on first use
```

`manifest.json` (the structure is defined with zod in `core`, and the app and the release script share the same validation):

```ts
ToolManifest = {
  id, version,                      // version is semver; id must not collide with a built-in tool
  hostApi: number,                  // the minimum host capability level required (§7)
  name, description: Localized,
  icon: IconName, aliases: string[],
  ageRating: '4+',
  permissions: Permission[],
  page: LocalizedPage,              // tool page: like Page, but text is Localized and expanded by language at install
  workflows: LocalizedWorkflow[],   // quick actions written into the config at install
  presets?: LocalizedPreset[],      // presets, with scenario (D-130)
  actions?: ActionManifest[],       // step two: contracts of new actions (id prefix must equal the tool id)
  code?: { entry: string },         // step two: plugin entry
  files: { path, size, sha256, lazy?: boolean }[],  // all files in the package; lazy = downloaded on first use
}
```

Three places in today's `ToolDefinition` are functions; for a downloaded tool they become data:

| Now (code)                                      | Downloaded tool (data)                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createPage(locale)`, `createWorkflows(locale)` | The manifest writes Localized text directly, and at install `materialize(manifest, locale)` expands it into `Page` and `Workflow`                                                                                                                                                                             |
| `params: ZodType`                               | **Derived from `fields`**: number → number and range, choice → the values in the options, toggle → boolean, text → string and length; nameTemplate and color use the existing validation. `fields` gets a `default`. There is already a test ensuring the keys of `fields` and `params` correspond one to one |
| `output: (params) => ValueType`, `packFor`      | Becomes a lookup table: `{ byParam: 'format', map: { pdf: 'pdf', png: 'images' } }`; data files use `files[].lazy` in place of packs                                                                                                                                                                          |

Built-in tools do not need rewriting and remain code; the two sources are merged into one registry in `createRegistry` (§5).

## 4. Signing and trust

- **Signing**: Ed25519. The private key is not written to any file: it is kept in the founder's password manager and pasted in at signing time (the development machine is the Mac mini that runs the planning service). The app has public keys built in, two at a time, to make key rotation easy.
- **The catalog** `catalog.json` is also signed: each tool's id, latest version, `hostApi`, package address, size and SHA-256, plus the revocation list.
- **Verification**: first verify the catalog's signature, then the package hash, then the SHA-256 of every file in `manifest.files` one by one. Only when all pass is `ready.json` written (following the packs approach, so an interrupted download is never treated as installed).
- **Hosting does not need to be trusted**: the content is all signed, so static hosting (Cloudflare R2 or GitHub Releases both work) is enough, without going through the planning service.
- **Revocation**: if a version is found to be bad, write it into the catalog's revocation list. The app checks the catalog when online (on open, at most once a day). A revoked tool cannot run, and quick actions that use it show "This tool is paused for now"; the user's config and files are **not deleted**. When offline, already installed tools work as usual.
- **No downgrade**: an installed version number higher than the catalog's is not overwritten. Bug fixes always ship under a higher version number.

## 5. Install, update, uninstall, historical versions

- **The registry becomes two parts**: `createRegistry([...BUILTIN_TOOLS, ...downloaded tools])`. At startup, first read the downloaded and verified tool packages on the device, then validate the workspace. The prompt is written in the app with this registry (D-193), and the server does not need to know about downloaded tools.
- **Tool catalog page**: built-in tools and downloadable tools sit together, with the size marked on downloaded ones. "Add" = (if not yet downloaded) show the size, download and verify after the user confirms → then use the existing `installTool` operation to produce a version as usual, which can be undone. Undo only changes the config; the downloaded package stays on the device and can be deleted under Settings → Downloads (the same as today's packs).
- **AI and downloads**: the AI can propose installing a downloadable tool but **cannot download on its own** (the rule in TOOLS_DESIGN §6 is unchanged). The preview shows "Downloads X MB", and the user confirms the download when they tap apply.
- **Update**: when the catalog has a newer version, the tool card shows "Update", for the user to tap (like today's `updateTool`: it fills in missing quick actions and entries and keeps the user's changes). No automatic updates; versions with security problems are handled by the revocation list.
- **Parameter compatibility**: a new version must accept all parameters of the old version (release check: take all quick actions of the previous version and validate them with the new version). For an incompatible change, use a new action id.
- **Uninstall**: the existing `uninstallTool`, files are kept.
- **Restoring a historical version**: when a historical version contains a tool that is not on the device (changed phone, deleted package), validation before restore fails with the prompt "Download “X” first" and a download button (the rule in handoff document §7E "tool code is not restored with historical versions" is unchanged).

## 6. How plugin actions run (step two)

```
Executor ──meets a plugin action──▶ PluginHost (one hidden WebView per plugin tool)
   Page: a fixed HTML we ship with the app (the same bridge as the pack pages), CSP default-src 'none'
   Plugin code: read from the locally verified package and loaded through a blob: address
   ◀── run(actionId, input, params) / progress / result ──▶   fixed-format messages only
```

The interface a plugin must implement:

```ts
// The function exported by the plugin entry
run(actionId: string, input: PluginValue | null, params: Record<string, unknown>, ctx: {
  progress(done: number, total: number): void;
  cancelled(): boolean;
  file(path: string): Promise<Uint8Array>;   // read files in its own package (lazy files are downloaded by the host first)
}): Promise<PluginValue>;

PluginValue =   // type is a value type the app already has (now also video and audio, D-140); hostApi decides which ones a plugin may use
  | { type: 'images' | 'pdf' | 'files' | 'zip' | 'video' | 'audio'; items: { name, ext, mimeType, bytes: Uint8Array }[] }
  | { type: 'text'; text: string };
```

- **What it can get**: the bytes of this run's input files, the parameters, and the files in its own package. **What it cannot get**: the network, other plugins (one WebView per plugin, not shared), the photo library and camera, native APIs, the config, records.
- **Only the WebView's own capabilities**: JS, WASM, canvas (can encode JPEG / PNG). A plugin **cannot call the app's native capabilities** (system image encoding, PDF rendering, video processing, text recognition), because 4.7.2 does not allow exposing native APIs to plugins. When these capabilities are needed, chain the plugin action and built-in actions before and after it in a quick action (for example the plugin outputs an image → the built-in `image.compress` compresses it), instead of calling them from inside the plugin.
- **UI**: a plugin draws no UI itself. Steps that need the user's hands use the existing local operations (`crop`, `reorder`, `pages`, `corners`, `redact`, `sign`, `fillForm`, and for video and audio `trimMedia`, since D-140), shown by the host. A new local operation UI is a change to a built-in tool (ships with an app release).
- **The host checks the output**: the type must match the contract, the number and size of files must be within limits (P-006), and image dimensions within 16.77 million pixels; otherwise it fails with a `RunError`. The host writes the output files into this run's temporary directory, after which they are like the result of a built-in action (save, share, print).
- **Timeout and memory**: each call has a timeout (the packs' 180 seconds, which the contract may raise), and the WebView is closed when leaving the run page.
- **Execution record**: `tool_runs` still records only status and error codes.
- **Fallback**: the contract and implementation of the same action can also ship with the app (the implementation goes into the install package, and the loading method is unchanged). Use this fallback if review does not accept plugins.

## 7. Host capability level `hostApi`

Each time the app adds a capability plugins can use, `hostApi` goes up by 1: a new value type, a new local operation, a new parameter control, a new field in the plugin interface. Each tool declares the minimum level it needs.

- When the app's level is too low, the tool shows "Needs a newer version of this app" in the catalog and cannot be added.
- Installed tools keep working in newer app versions (the plugin interface only adds, never removes).

## 8. AI (prompt and eval)

- The prompt is written in the app with the device's registry (D-193), so for now it contains only built-in and **downloaded** tools. To later let the AI propose installing downloadable tools, the app adds a one-line description from the catalog to the prompt, and the server still does not need to care. Original design: the app includes in the request the **ids and versions of installed tools** on the device and `hostApi`; in the prompt, installed tools list their full contract, and tools that are downloadable but not installed list only a one-line description (they can be proposed for installation). Once the catalog grows, prompt caching controls the cost.
- Every tool must ship with its eval cases before release: run only the affected cases, with Haiku (eval rules).
- The built-in mock rules do not recognize "add tool X" (the same for built-in tools); downloaded tools are added on the Tools page, and adding them with the AI or building quick actions needs a real model (D-178).

## 9. Release process and what 4.7 requires

**Where tools live in the repository**: `tools/<id>/` (manifest source, plugin source, tests run with Node and real files, like today's `tool-*` packages). The release script:

1. Run tests, evals, the license check (`check:licenses`) and the size check.
2. Release checks: the manifest passes validation; `hostApi` is not higher than the released app; parameters are compatible with the previous version (§5); the age rating is 4+.
3. Package, paste in the private key to sign `catalog.json`, upload.
4. Update the public tool catalog on the website.

**New work for 4.7**:

- **Public catalog (4.7.4)**: a page on the website lists all downloadable tools, one address per tool (for example `https://<domain>/tools/<id>`). Set up iOS apple-app-site-association and Android App Links so that opening the address goes to that tool in the app. The domain and website can be built together with the "app promotion website".
- **Report a problem (4.7.1)**: a "Report a problem" on the tool page and in the catalog, opening an email or form that carries only the tool id and version, no files.
- **Review notes template**: written into App Review Notes at submission.
- **Privacy statement**: state that plugins process files only on the device and cannot use the network.

## 10. Scope and acceptance of the two steps

**Step one: data tools** (no code at all, no change to SECURITY_NOTES)

- The `ToolManifest` structure and `materialize`; a registry that merges built-in and downloaded tools; signed catalog, download, verification, revocation, no downgrade; download and install, update and uninstall on the tool catalog page; the prompt when a tool is missing while restoring a historical version; the planning service carrying installed tools; the release script (without the plugin code parts).
- Presets and scenarios can also be shipped with data tools.
- Acceptance: on the simulator, install a data tool from a locally started catalog → run it once → undo → restore → revoke → update; the AI can use this tool to build quick actions; changing one byte makes it fail to install.

**Step two: plugin tools**

- The JSON form of the action contract (parameters derived from `fields`, lookup-table outputs); PluginHost and the plugin interface; the existing three packs merged into this signing mechanism; the 4.7 public catalog, report a problem and review notes; changes to SECURITY_NOTES rule 2 and handoff document §8.
- Acceptance: one real plugin tool (candidate: PDF encryption, which was already in the second batch) works end to end from download to run; a plugin's attempts to use the network, read other files or call native APIs all fail (with tests); submit for review with this plugin.

## 11. How existing and planned tools are classified

The material comes from the replies of two sessions of "Morphing usability optimization (fork)" (2026-10-23), checked against the local main (373e438, which includes audio phase two D-152–D-158).

| Tool / action                                                                                                    | Implementation                                                                                   | Class           | Notes                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing image, pdf, scan, ocr, qr, zip, text, print                                                             | JS libraries + system frameworks (Vision, Core Image, ML Kit)                                    | Built-in        | New users get 5 of them added by default (D-104). The scan pack and OCR pack are downloaded code; in step two they merge into the plugin signing mechanism |
| `video`: `in.videos`, `video.compress`, `video.convert`, `video.trim` (D-140–D-148)                              | Local module morph-media: AVFoundation on iOS, Media3 Transformer on Android                     | Built-in        | The new value types `video` and `audio` and the new local operation `trimMedia` are host capabilities; `hostApi` must be raised accordingly                |
| `pdf.compress` (D-145)                                                                                           | pdf-lib (pure JS) + the app's system image encoding + the existing PDF rendering                 | Built-in        | Calls native image encoding, so per §6 it cannot be a plugin. Already shipped with the PDF tool, no reason to move it                                      |
| `translate.text` (D-170–D-176)                                                                                   | Local module morph-translate: Translation framework on iOS, ML Kit translate on Android          | Built-in        | On Android each language model is about 30 MB, downloaded by ML Kit itself from Google (D-175), not through us and not in the signed catalog               |
| The 4 ready-made translation quick actions (D-173)                                                               | Only combine existing actions                                                                    | **Data tool**   | With step one, this kind can be shipped without an app release (provided the app already has `translate.text`)                                             |
| `audio.transcribe` (D-150, D-151, D-152)                                                                         | Local module morph-speech: Speech framework on iOS, whisper.cpp compiled into the app on Android | Built-in        | The whisper models (60–190 MB) and the VAD model are **data**, currently pinned to a commit on Hugging Face, and can move to the signed catalog            |
| `in.audio` (pick a file or record), `audio.compress`, `audio.convert`, `audio.trim`, `audio.merge` (D-152–D-158) | morph-media, expo-audio                                                                          | Built-in        | The recording UI and the `microphone` permission are host capabilities                                                                                     |
| Ready-made quick actions for video and audio                                                                     | Only combine existing actions                                                                    | **Data tool**   | Same as above                                                                                                                                              |
| Candidate: PDF encryption / decryption (TOOLS_DESIGN §9 second batch)                                            | Pure JS / WASM, bytes only                                                                       | **Plugin tool** | The candidate for step-two acceptance                                                                                                                      |

**Conclusion from this**: all the new **actions** being built now are built-in, because they all rely on system capabilities (video, translation, speech). So in the short term the download mechanism is mainly valuable in two places:

1. **Step-one data tools**: ready-made quick actions, scenarios, presets and tool pages can be shipped at any time. The batch of quick actions that follows each new capability (4 for translation, several for video and audio) no longer has to wait for an app release.
2. **Models and language data**: the whisper models and the OCR language data are data; putting them all in the signed catalog means addresses and hashes no longer need to be hard-coded.

Pure-computation plugin tools (step two) have few candidates for now; they are worth doing, but can come later.

## 12. Decided (D-177, D-178, 2026-10-24)

1. **Hosting**: Cloudflare R2.
2. **The revocation list when offline**: does not take effect; added tools keep working, and they are revoked once online.
3. **Tool updates**: by the user's tap, not automatic.
4. **Mock AI**: does not recognize "add tool X" (the same for built-in tools); adding downloaded tools with the AI and building quick actions with them needs a real model.
5. **Signing private key**: kept by the founder in a password manager and pasted in at signing time, never written to a file; the backup private key is kept somewhere else (once there is a USB drive or another computer it can be moved there; the public key does not change).
6. **Plugins calling native capabilities**: not allowed; chain them with built-in actions before and after in a quick action (§6).

**To do before touching code**: this branch has been fast-forwarded to the local main (373e438, 2026-10-24), and part of the local main has not been pushed to GitHub. New decision numbers continue from D-177, and pending items from P-024.

## 13. Implementation of step one (D-179, 2026-10-24)

| Part                  | Location                                                                                                                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format and validation | `packages/core/src/tool-download.ts`: manifest, catalog, signature, `toolFromManifest`, `checkToolManifest`, `decodeUtf8`; public keys in `tool-keys.ts`                                                 |
| Registry              | `packages/core/src/registry.ts`: `registerTool` (accepts only downloaded tools that have no actions of their own, and cannot replace a built-in tool), `registryRevision`                                |
| App                   | `apps/mobile/src/tool-download/`: `store.ts` (download, verification, storage), `state.ts` (catalog, downloaded, revoked), `context.tsx`; the tools page `ToolsView`, the run page, the "Downloads" page |
| Prompt                | `systemPromptFor` in `packages/planner/src/prompt.ts` (the app writes it with the device's registry, D-193; the server no longer fetches the catalog)                                                    |
| Release script        | `apps/api/src/publish.ts`, `apps/api/scripts/tools.ts` (`npm run tools -- …`)                                                                                                                            |
| Example tool          | `tools/job-apply/manifest.json` (job application documents: a résumé and certificates combined into one PDF, a profile photo compressed to 200 KB)                                                       |

**Releasing once** (at the repository root):

```bash
npm run tools -- build tools dist/tools
npm run tools -- sign dist/tools --prompt
npm run tools -- verify dist/tools
```

Then upload all of `dist/tools` to R2. To revoke a version: `npm run tools -- revoke dist/tools <id@version>`, then sign and upload again. `dist/tools` must be kept (the next build uses it to check version numbers and compatibility); it can live on R2 and be downloaded back before a release.

**Local development**: sign with `tools/dev-signing-key.txt`, serve the catalog with `python3 -m http.server --directory dist/tools`, start Metro for the app with `EXPO_PUBLIC_MORPH_TOOLS_URL=http://localhost:<port>`, and give the planning service `MORPH_TOOLS_URL` and `MORPH_TOOLS_DEV_KEY=1`.

**Still missing before launch** (the official public keys were filled into `TOOL_SIGNING_KEYS` on 2026-10-24 and must go out with the next app version): create the R2 bucket and address, set `EXPO_PUBLIC_MORPH_TOOLS_URL` when building the app, and set `MORPH_TOOLS_URL` in the Mac mini's `.env`.

**Differences from the design**:

- "Presets and scenarios can also be shipped with data tools" (§10) was not done this time: a data tool carries its own quick actions, and the presets under "Quick actions → Ready-made" still ship with the app.
- There is no separate download confirmation dialog on "Add": the tool page card already says "Downloads X KB", so tapping "Add" is the user's confirmation (a data tool is only a few KB).
