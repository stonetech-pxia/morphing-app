# Morph: Rules for Coding Agents

Read the "Product background" section of this file, `docs/TOOLS_DESIGN.md` §0 and `docs/DECISIONS.md` first. Mobile has its own `apps/mobile/AGENTS.md` (the Expo way of writing things). The founder communicates in Chinese; code comments follow the surrounding code, which means Chinese.

The full background and examples are in `~/Library/Application Support/Claude/side-session-notes/codex-handoff/CODEX_LESSONS.md` (this document is not in the repository). What follows is the part you must obey.

## Invariants (D-375, provisional)

19 rules the founder set in conversation on 2026-10-31 ("Let's go with these rules for now"; the same day 3, 7, 11 and 16 were changed and 19 was added, see D-377–D-381; 11 was changed again that day, see D-385; on 2026-11-06 14 was changed, see D-455). **Only the founder can change them**, and every change goes into `docs/DECISIONS.md` (with the date and where it was said). **Every report must say whether this change touched an invariant.** Guard tests: for core, `packages/core/src/invariants.test.ts` (called "core" below); for mobile, `apps/mobile/src/__tests__/invariants-test.tsx` ("mobile") and `invariants-files-test.ts` ("files"). Each invariant has its own `describe`. When a test finds a violation, do not fix it on your own: mark it `it.fails` / `it.failing` with the comment "violates invariant N, awaiting the founder's decision" (D-376).

Data and privacy

1. The user's data never leaves the phone: records, files, recognized text and recordings are processed only on the device, and no network request carries data content. (core network allowlist; mobile sentinel strings)
2. The AI never sees the content of the data, only its structure (this means the cloud AI; a model running on the phone does not count, and its results only become suggestions, D-396). It sees no record content, file names, file content or recognized text. When the inbox opens the AI, only the file types and the number of files are sent. (mobile: the requests of both kinds of AI; core: the inbox context, parameter redaction)
3. The AI never touches files: it does not read, write, move or delete them. Places in the config that point at user files (file slots, images, image backgrounds) can only be chosen by the user; an AI change can never write a file reference, and file IDs sent to the AI are replaced with placeholders (D-377). (core: the 14 operations, AI writes of file references are rejected; mobile: no file IDs in requests, the AI cannot replace a file slot)
4. Originals are never moved or deleted (photo library, "Files", content://); only copies are processed. (files; core)
5. Changing the app never deletes data: changing the config, deleting a table, deleting a field or restoring an old version leaves the records in place. Records can only be deleted by the user's own hand. (mobile; core)

What the AI may do

6. The AI only changes the app and does not do things for the user (D-113): it does not run tools, does not answer questions, and does not write text meant to leave the app. Text the user wants on a page may be written; only sensitive or offending content is blocked (D-408). (core)
7. Look changes go into a draft first and take effect only when the user confirms; feature changes (D-191: creating a table, adding a quick action, etc.) take effect directly but can be undone at any time in Change history; Change history can always return to any earlier point (D-378). (mobile: look changes go into a draft, feature changes go into Change history and can be undone and restored; core)
8. The AI cannot change the system layer: the AI page, draft confirmation, Change history / undo, Settings, permissions. (core)

Tools

9. A tool cannot trigger a tool; there are no branches and no loops. (core; `relation-rules.test.ts` rule 13)
10. Data leaves the app only by the user's own tap, every time; anything scheduled or automatic can never export, share or send over the network. (core; `relation-rules.test.ts` rule 14)
11. Every action that writes data can be taken back: what is saved and what the user has confirmed shows no undo banner, and the user reverses it with an equally simple action (uncheck, edit again, delete); only deletion shows an undo banner; a bulk change must always ask first (D-385). (mobile; `record-actions-test.tsx`, `tiles-board-test.tsx`; core: setAll has no setting that skips the question, and when it asks it does not mention undo)

Compatibility

12. Old data always opens: every format change comes with a migration, old data and old versions in Change history can all be upgraded, and migrations lose nothing. (core; `migrate-v34.test.ts`, `v34-equivalence.test.ts`)
13. Works without a network: everything works offline except AI changes and the first download. (core network allowlist; native modules need a real device)

Between containers, tools and data

14. There is only one copy of the data, and it lives only in the data: containers and tools only reference data and never store it; the config never holds user data content; computed values are computed on demand and not stored. The only exception: a file's thumbnail and recognized text (image recognition, PDF text) are stored on the device next to that file when the user scans, shares, opens or saves the file, are deleted together with the file, do not enter the config and are not sent to the AI (D-455). (core)
15. Looking never changes anything: opening a page, scrolling, turning a month, expanding and switching language write no data. (mobile: render templates, every page of the sample apps)
16. Every write comes from one user action; a reminder that fires only shows a notification; nothing changes data in the background. The only exception: records that have been in the trash for more than 30 days are permanently deleted automatically at startup (D-037, D-380; it originates from the user's own deletion). (mobile: this is the only write at startup; core)
17. What the user sees is what gets changed: a tool only changes the data shown by the container it is in, or the one record reached by following a link (relation rule 12). (core; `record-ops.test.ts` rule 12)
18. The config is always self-consistent: no references to tables, fields, tools or pages that do not exist (including the parameters of quick-action steps); a deletion either cleans up along with it (see the draft description) or is rejected. (core: every kind of deletion, random deletion sequences, deleting a table or field is not rejected because of steps; `step-refs.test.ts`)

What the user wants

19. What the user wants can be done: a quick action processes files and ends by handing over to a page (for example a new-record form or the record page) where the user confirms the save; any two actions whose types match can be chained; the AI cannot refuse a combination that can be done because it is "unreasonable", at most it adds a reminder. It is still a straight chain, and each step only takes the output of the previous one (invariant 9) (D-381). (core: any two actions whose types match can be chained; planner `invariants.test.ts`: the prompt has no rule that refuses a combination that can be done)

The design rules (the one way to write a read, nesting depth, 6 ways of appearing and 5 one-tap records, setAll ≤ 200, containment and references) are not invariants and can be adjusted through DECISIONS.

## Product principles

- The AI only changes the app and does not do things for the user (D-113, this means the cloud AI; for the on-device model see D-396): it does not write text meant to leave the app (text on a page may be written, D-408), does not answer questions, does not summarize files or recordings, and does not run quick actions itself.
- The cloud AI cannot see file content, file names, recognized text or record content (for the on-device model see D-396); when the inbox opens the AI, only the file types and the number of files are sent.
- The inbox does not run automatically; look changes go into a draft first (D-190), feature changes take effect directly (D-191), and both can be undone.
- Words shown to users: "quick action", "Add", "Remove" (D-112); the AI is called Tink to the user; only the trust notice says it is an AI, provided by Claude by default (D-436).

## Product background (formerly `PRODUCT_HANDOFF_CLAUDE_CODE.md`)

The original product handoff document was deleted on 2026-11-08; the parts that are still useful are written here. Numbers such as §5.1, §7C, §7E and §7G that appear in code comments and docs without a file name, and "handoff document §N", refer to the entry with the same number below. The original is in git history (`git show 21db2d98:PRODUCT_HANDOFF_CLAUDE_CODE.md`). Where this section disagrees with the invariants or `docs/DECISIONS.md`, the latter two win.

- **§1 In one sentence**: the user installs once, and after that keeps changing the interface and features of **the same app** in natural language; data, tools, config and change history are always there. It is not an App Builder: it does not generate another app, and it does not rebuild from a blank template each time. The current scope is files and personal records (from D-368 on).
- **§2 Users**: people who do not program and often handle personal files and records. What is to be validated: they would rather stay and keep changing this one app than install many single-purpose apps that do not talk to each other.
- **§3 Not doing**: no AI-generated or downloaded code running on the phone; "changing features" is limited to registered capabilities plus editable config; no third-party tool marketplace; no autonomous background actions.
- **§4 How a change is presented**: the user is not forced to start from chat. Every change shows the user a restatement, what changed, a preview, and "Apply" and "Cancel", and can be undone after applying. A model saying it succeeded does not count: success is shown only after persistence is done and re-reading and rendering succeeded; if rendering fails, it automatically returns to the last valid version, records the reason and tells the user.
- **§5 Fixed core + changeable layer**: the core (file storage, permissions, tool registry, executor, AI requests, validation, snapshots and restore, rollback, logs) cannot be changed by the AI. The changeable layer is all declarative config, which the renderer only maps to whitelisted components; the AI cannot generate JSX / JS to inject into the runtime. §5.1 Protected elements: "Settings" is always reachable (navigation bar or floating entry), and the validator rejects changes that make it unreachable (D-031). §5.3 A change, wherever it comes from (Tink, long-press edit, other entries later), goes through the same ChangeRequest → Plan → Validate → Preview → Commit. §5.4 `core` does not depend on React Native or Expo, and the server reuses the same validation; the model key lives only on the server.
- **§7B Tools**: a tool declares its actions, input and output types and permissions, and cannot quietly read another tool's data.
- **§7C Quick actions**: linear steps, not Turing-complete (invariant 9). Naming templates accept only whitelisted placeholders (`{date:YYYY-MM-DD}`, `{index}`, `{sourceName}`, etc.), use the device time zone; on a name clash a sequence number is appended, and an existing file is never overwritten.
- **§7D Change protocol**: use semantic operations, not JSON Patch; each kind of operation has its own schema, permission rules and a human-readable description. `baseRevision` is checked at commit, so an old plan cannot overwrite a newer version. Undo and restore both create new versions; the history is append-only and never rewritten.
- **§7E Restoring an old version**: pages, navigation, theme, quick actions, tool settings and install state, and table structure are restored; user files, records and run logs are neither restored nor deleted; tool code always uses the current version, and if an action referenced by the old config no longer exists, validation before the restore fails and tells the user. An old snapshot is migrated step by step → validated → previewed → confirmed, and if migration fails it is not restored (invariant 12).
- **§7F Built-in rules (mock AI)**: a rule parser, not a language model; it recognizes only the phrases in `docs/MOCK_AI_PHRASES.md` (a test reads that list). When it does not recognize a sentence it says "Can't understand that for now" and gives example sentences; it does not guess.
- **§7G File ownership**: user files belong to the workspace, not to a tool. A tool can read only files authorized to it (chosen by the user inside it, or explicitly authorized); files a tool outputs belong to the workspace. Removing a tool only removes its entry points, settings and authorizations and does not delete files; deleting a file is a separate action that needs the user's confirmation.
- **§8 Security and store release**: model output is untrusted; all config first goes through the schema, the capability whitelist and permission checks; backend credentials and model keys are not sent down to the client. For store release, Apple App Review 2.5.2 / 4.7 and Google Play's dynamic code policy must be checked specifically (selling subscriptions on iOS also involves 3.1): whitelisted components and non-Turing-complete quick actions are the main risk reducers, and "technically it runs" does not mean "it can be listed". For the current state and to-dos see `docs/SECURITY_NOTES.md`.
- **§12 Long-term principles**: the core stays stable; the user's software space keeps changing; data ranks above interface; new features are testable, undoable and traceable.
- **§14 Open source and cloud**: AGPL-3.0. The open-source version must be fully usable locally, including with your own key (D-028, D-241); what the cloud sells is convenience, compute and cross-device use, not a crippled open-source version sold for money. Closed-source cloud code does not go into this repository, and the repository has no cloud keys or internal config. The open-source and official versions use the same config format and can import and export. Before merging outside code there must be a CLA (`CONTRIBUTING.md`, P-001). Before launching the cloud there must be a privacy policy (GDPR / CCPA) and store privacy labels, and the app must let users delete their account.

## If it can be done by changing the config, never hard-code it

- For changes to look, entry points, copy and layout, **whenever it can be done by changing the config, change the config**: add a field or value (schema), write it into the starting config / templates / sample apps, and upgrade old data through a migration (every format change comes with a migration and tests, invariant 12).
- **Never** write special cases in the renderer, the shell or anywhere else keyed on specific values such as a page ID, a block ID, the target of `opens` or a table name, so that what is on screen no longer matches the config (for example "the button that opens the toolbox page is always drawn as one row"). That makes the values written in the config have no effect, the user, Tink and page editing cannot change it, and old and new configs cannot be explained.
- The renderer only recognizes values in the config (`look`, `variant`, `show.*`, `style.*`), not specific pages and blocks. If a new look is needed, add a value to the config and let the renderer recognize that value.
- Only the system layer may be written into the code (Settings, Change history, the Tink page, permissions, guide bubbles and banners, invariant 8); these are not pages in the config, and Tink cannot change them. If you are unsure whether a change counts as system layer, ask the founder.
- The report states whether this change changed the config (which field, which migration) or a fixed way of writing things in the code; for the latter, explain why the config could not do it.

## This Mac is also the production server

- **Never `pkill -f "tsx src/main.ts"`**. The production service is the launchd job `dev.stonetech.morph-api`. Note the PID of any test server you start and stop only your own; avoid ports 8787 and 8788.
- **Do not push or deploy unless the founder explicitly asks.** When `apps/api` changed, say so on its own line at the top of the report: "needs a production deploy to take effect".
- Real-model evals use Haiku only: `npm run eval -- --model claude-haiku-5-5 --cases <ids>`. Run them only when you changed a prompt, a mock or an action description, and run only the affected cases. The key is in `.env` in the home directory; never print it.

## Tests in Node do not prove it runs on the phone

- The app runs on Hermes. Hermes has only `Intl.Collator`, `Intl.DateTimeFormat` and `Intl.NumberFormat`; **do not use `Intl.PluralRules`, `ListFormat` or `RelativeTimeFormat`**; for plurals use `isSingular` in `messages.ts`.
- When a change involves native modules (AVFoundation, Media3, Vision, ML Kit, file paths and extensions), JS built-in APIs, touch and layout, or large files and memory, **you must run the real path once in a simulator or on a real device**. If the simulator panel is not authorized, stop and ask the founder to authorize it; do not skip it.
- Native behavior can be verified without a UI: temporarily add a probe route that calls the native module directly, and read the result with `xcrun simctl io <UDID> screenshot`; when done, restore with `git checkout` and do not commit. A newly added route file takes effect only after restarting Metro (with `--clear`).
- Native changes must compile on both sides: on iOS run the whole app (`npx expo run:ios`); on Android run at least `compileDebugKotlin` and `externalNativeBuildDebug` for the changed module. When you bring in a third-party C library, read its build switches and compare the size before and after the switch.
- On iOS, audio processing takes only the main audio track (the first enabled one) and follows the source file's channel count. On Android, decode images only after scaling them down to the target size. Delete native intermediate files when the task ends, on success and on failure. Cancelling a task must always end its Promise.

## Building and installing on the real device

- **Touch the founder's phone only when he explicitly asks.** When a real-device test is needed, write the test steps and hand them to him. Ask which branch and which commit to install first.
- So far builds have been made only for Android (the founder's Samsung SM-S948B, connected by USB). **An iPhone build has not been made yet**: it needs an Apple developer team and signing first, and prebuild will warn that the share extension has no `DEVELOPMENT_TEAM`. Ask the founder about this; do not guess at the configuration.
- Environment: `export JAVA_HOME=~/development/jdk-17/Contents/Home ANDROID_HOME=~/development/android-sdk`. Put `LANG=en_US.UTF-8` in front of CocoaPods and Gradle.
- **Back up the data on the phone first.** A release build cannot `run-as`, so first `adb install -r` a debug build, **do not open it**, then run `adb exec-out run-as app.morph.mobile tar cf - . > app-data.tar` and save the backup in `side-session-notes/android-backups/<time>/`. Both kinds of build are signed with the Expo template's debug key, so they can be installed over each other and the data stays.
- **Building a release build** (it does not depend on Metro; the JS is fixed at build time):

  ```bash
  cd apps/mobile && EXPO_PUBLIC_MORPH_PACKS_URL=https://morph-tools.stonetech.dev/packs \
    npx expo prebuild --platform android --no-install
  cd android && EXPO_PUBLIC_MORPH_API_URL=https://morph-api.stonetech.dev \
    EXPO_PUBLIC_MORPH_TOOLS_URL=https://morph-tools.stonetech.dev \
    EXPO_PUBLIC_MORPH_PACKS_URL=https://morph-tools.stonetech.dev/packs \
    EXPO_PUBLIC_MORPH_CLIENT_TOKEN="$(grep '^MORPH_CLIENT_TOKEN=' ~/projects/morph-prod/.env | cut -d= -f2-)" \
    ./gradlew app:assembleRelease -PreactNativeArchitectures=arm64-v8a
  adb -s <serial> install -r app/build/outputs/apk/release/app-release.apk
  ```

  All four environment variables are baked into the app. If one is missing, AI, tool downloads or scan flattening (D-274; when `PACKS_URL` is missing, scanning does not offer to download the flattening model, and pages still scan but are not flattened) will not work on the phone, and neither the simulator nor unit tests will notice. The token is not a secret (D-132), but do not print it into logs. Prebuild also puts the bundled file packs into the app (D-510, `plugins/with-bundled-packs.js`, cached in `node_modules/.cache/morph-bundled-packs`); without `PACKS_URL` at prebuild it leaves out flattening and layout, and the app offers them as a download again.

- adb quirks: inside the command sandbox the adb server crashes, so run `adb nodaemon server` in the background outside the sandbox. When other sessions also use adb, switch to another port (`ANDROID_ADB_SERVER_PORT=5038`). Give every command `-s <serial>`, and retry on failure. When `adb devices` shows offline (usb_read e00002eb), the only fixes are to replug the cable, or to turn USB debugging off and on again on the phone.
- After installing, open the app once and confirm it starts and AI changes work. Then write down in the report and in the project memory which branch and which commit is on the phone now, and where the backup is.
- The development build on the simulator also goes stale: after native code changes, an old development build running new JS may fail right at startup (for example "cannot open workspace"). In that case first rebuild the development build with `npx expo run:ios --device <UDID> --no-bundler` (it cannot be combined with `--port`); do not treat it as a bug in the code.

## Tests

- To fix a bug, first write a test that **fails on the old code**, then change the code so that it passes.
- Assert what it **should** do; do not copy today's behavior into assertions. Test doubles must model the properties that really cause trouble: extensions, the directory a file is in, the difference between `content://` and `file://`, channel counts.
- For UI, walk through all three states: a new user (no data), with data, and edge cases (wrong count, very large file, mixed types).

## File ownership

- Originals in the user's photo library or "Files", and `content://`: never moved, never deleted.
- Copies that the share extension puts in the App Group, and copies that pickers put in `Caches/ImagePicker` and `Caches/DocumentPicker`: they belong to the inbox batch and are deleted when the batch is released; the inbox batch's files cannot be moved, because "Do it again" still needs them.
- `cache/runs/<runId>/`: belongs to this run, can be moved, and is deleted when the run page is closed.
- A step that has to move a file (for example rename) first checks whether the file belongs to this run; if not, it copies.

## Languages (en / zh / fr)

- All copy goes into `en.ts`, `zh.ts` and `fr.ts` in `packages/core/src/messages/` (the keys of the three files must be identical; one missing and it will not compile; singular forms for strings with counts go in `enSingular` / `frSingular`). Do not write `zh ? '…' : '…'` (`npm run check:locales` will catch it).
- Every string with a count needs a singular form, and must state which parameter decides singular or plural. In French, both 0 and 1 use the singular.
- Do not assemble sentences from translated words; write a complete sentence in each language. French terms: record = entrée, table = tableau, Morph's settings page = Paramètres, recording = enregistrement.
- When you change UI copy, switch the simulator to French and walk through the main flow starting from a fresh install.

## DECISIONS and docs

- Docs (Markdown) are written in English. README.zh-CN.md is the only Chinese doc and follows README.md. Code comments still follow the surrounding code (D-499).
- Do not mark something "Decided" if it is not finished. When you change a decision, `grep` for every place that cites it and update them all. When you write "the founder confirmed", say where and on what day he confirmed it.
- Handoff reports, test plans and measurement results do not go into git; put them in `~/Library/Application Support/Claude/side-session-notes/`.
- Decision numbers often collide: before merging, check the largest number on main again. When you add a table row, no cell may be wider than the widest cell in its column (otherwise prettier re-pads the whole table).
- When you change the planning prompt, do not break the existing rule structure; append new content at the end of the rules.

## Before merging

`npm run check` passes in full; the affected evals have been run; every fix has a test that fails without it; native and UI changes have been run in the simulator; all three languages have been looked at; DECISIONS is consistent from start to end. The report has three separate parts: verified in the simulator, unit tests only, and testable only on a real device.
