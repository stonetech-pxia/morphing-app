# Tinkrum

**Make your own tools by talking to your phone.** Tinkrum is an experimental app that lets anyone, not only programmers, talk to AI on their phone and build the everyday tools they need on the spot: a scan button that files receipts into a budget, a habit tracker that works the way they think, a button that shrinks a video until it can be sent.

[中文](README.zh-CN.md)

## The idea

For one small feature, people often have to download a little app full of ads, or find it costs money they don't want to spend. Many people now build their own tools with AI, but most people can't, and making a tool on a phone and getting it running there is a hassle anyway.

Tinkrum tries a different route: you talk to AI, the AI edits a JSON config, and the config puts together tools already built into the app to make the tool you want. The app is a fixed core plus that config. The core knows how to draw pages, run file tools and keep records; the pages, buttons, lists, forms, bottom bar, colors and the quick action behind each button are all written in the config. There are two ways to make a tool:

- **Talk to Tink**, the assistant inside the app: "add a page for the books I read, with a rating", "add a button that scans to Word", "make the cards flatter".
- **Start from a preset**: import an app file someone else made (Wallet, Habits, Trip…) and change it from there. You can save your own app as a preset too.

Because Tink only edits the config, whatever it builds is made of parts the core already knows how to run. It works offline, every change can be undone, and nothing Tink does can reach your data.

Of course it can't meet every need, and right now it can't do much. But I hope it helps the people above.

**Three promises:**

1. **No ads, ever.**
2. **The app is free.** The model behind Tink costs money and my budget is small: early on, I provide a free model quota. If so many people use it that I can't afford it anymore, I'll add a paid option.
3. **Your files and records on the phone are never uploaded.**

## Tink touches the config, never your records or files

```
     what Tink can change                     what Tink can never reach
┌─────────────────────────────┐        ┌─────────────────────────────────┐
│ App config (JSON)           │        │ Your records                    │
│   look, bottom bar, apps    │        │ Your files, photos, recordings  │
│   pages and their blocks    │        │ Text recognized from your files │
│   tables and fields         │        │                                 │
│   quick actions, reminders  │        │                                 │
└─────────────────────────────┘        └─────────────────────────────────┘
```

- **They're stored apart.** Config versions, records and files are kept in different places. Restoring an old version of the app never touches records or files.
- **Tink can only send back config operations.** There are 14 kinds, and none of them reads or writes a record or a file. Removing a table keeps its records.
- **The model sees the layout, not your content.** It gets the config and your sentence, never records, file contents, file names or recognized text. It can't pick a photo or file for you; image and file slots are yours to fill.
- **Every change is checked and can be undone.** The core validates each change before saving it. Changes to the look go into a draft you apply or leave; new features apply right away and can be undone from Change history.

The config does include text you wrote yourself, such as page titles and button labels, so that part reaches the model.

## How it's built

```
Config (JSON)    theme · bottom bar · apps · tables and fields · pages of blocks · quick actions · reminders
      ▲          changed by you, Tink and presets; every change is a new version
Fixed core       draws 26 kinds of block, checks and migrates the config, runs 97 actions,
                 keeps records, owns the system pages (Settings, Change history, Tink)
Native modules   scanning, text recognition, video, audio, speech, translation, sharing
```

The config has three layers, with fixed rules between them:

- **Data**: tables and their fields. Only the structure; the records live in the database.
- **Containers**: pages made of blocks. A block reads data and never stores it.
- **Tools**: quick actions and reminders, the only things that write. A quick action is a straight chain of registered actions (scan → straighten → PDF → save), with no branches or loops.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## What it can do

- **Pages from 26 kinds of block:** lists, checklists, boards you drag between, calendars, charts, numbers, forms, file shelves, buttons, images and more.
- **Your own tables:** 19 field types, including money, dates, ratings, files, links between tables, rollups, formulas and schedules. Filters, search, reminders, CSV and Excel export.
- **Quick actions from 97 on-device actions:** scan to PDF, Word or Excel, text recognition, PDF tools, image tools (ID photos, background removal, watermarks), video (compress to a size, trim, GIF), audio (record, speech to text, MP3, noise reduction), translation, QR codes, ZIP.
- **Any look you like:** colors, fonts, card styles, backgrounds, icons, the bottom bar.
- **Several apps in one**, each with its own style and bottom bar.
- **Files from anywhere:** share photos, videos or PDFs to Tinkrum and it suggests the quick actions that fit.
- **Undo anything,** back to the first version. Works offline, in English, Chinese and French.

## What it can't do

- **Tink can't see or change your records or files**, and can't pick a photo or file for you.
- **Tink builds tools; it doesn't do the task.** It doesn't answer questions, summarize or translate a file itself, run a quick action, or write messages to send out. Ask it to "translate this contract" and you get a translate button that runs on your phone.
- **Tink can't change the system pages:** Settings, Change history, the Tink page and permissions are fixed, so you can always get back in and undo.
- **No code.** The config only holds values from fixed lists. A request that needs a new kind of block, field or action can't be built from a sentence; Tink says so, and you can send that one sentence to us with "Tell us you need this".
- **Quick actions stay simple:** no branches, no loops, and one quick action can't start another.
- **Nothing happens on its own.** Every change to your data comes from your tap (the one exception: entries left in the trash for 30 days are deleted). Exporting, sharing and sending always need your tap; reminders only show a notification.
- **Originals are never moved or deleted.** Tinkrum works on copies.
- **No accounts or sync.** Your app and your records live on one phone.

## Build it

Needs Node.js 22.12+ or 24, plus Xcode for the iOS simulator or JDK 17 and the Android SDK for Android.

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

Tink uses offline built-in rules until you add your own API key in Settings → Tink ([docs/API_KEY_SETUP.md](docs/API_KEY_SETUP.md)). `npm run check` runs lint, type checks and tests. Running your own relay server: [docs/DEPLOY.md](docs/DEPLOY.md). Rules for coding agents, including the 19 invariants behind the list above: [AGENTS.md](AGENTS.md).

## License

[AGPL-3.0](LICENSE). Bundled native code under compatible licenses: LAME 3.100 (LGPL-2.0+), RNNoise (BSD), libebur128 (MIT), whisper.cpp (MIT). The Android build links Google ML Kit, which is closed source; how that fits with AGPL is still being settled. Issues are welcome; pull requests aren't accepted yet ([CONTRIBUTING.md](CONTRIBUTING.md)).
