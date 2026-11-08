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

The fixed core draws 26 kinds of block, runs 97 actions and keeps your records. Everything else is the config, and the config is made of three kinds of parts:

- **Data** is what's stored: tables and their fields. The config holds only the structure; the records themselves live in the phone's database.
- **Containers** are what you see: pages made of blocks (a list, a chart, a calendar, a button…). A container reads data and shows it. It never stores or writes data.
- **Tools** are what writes: a one-tap tool on a block (add a record, check it off, +1, drag it to another column), a quick action (a chain of actions such as scan → straighten → PDF → save) or a reminder.

```
                ┌───────────────────┐
     reads      │       Data        │      writes
   ┌───────────►│  tables, fields   │◄────────────┐
   │            └───────────────────┘             │
┌──┴──────────────┐                    ┌──────────┴──────┐
│   Containers    │    a tap starts    │      Tools      │
│  pages, blocks  ├───────────────────►│ one-tap tools,  │
│                 │                    │ quick actions,  │
│                 │                    │ reminders       │
└─────────────────┘                    └─────────────────┘
```

**Example: the Habits preset.** One ring per habit; tap a ring to check in.

```
Data         Habits       name · times a day · part of day · days
             Check-ins    habit · date · done or skipped
             "Today"      a field on Habits: today's check-ins, computed when shown, never stored

Containers   page "Habits"
               tiles      one ring per habit, filled by Today ÷ times a day
               number     day streak, counted from Check-ins
               calendar   the days you checked in

Tools        on a ring    tap → add a check-in for this habit
             reminder     20:00 on a habit's days unless it's done; "Done" adds a check-in
```

Tink builds the same way: ask it for a habit tracker and it adds tables, a page of blocks and the tools on them, all as config. The rules between the three parts are fixed: a container only reads and navigates; a tool changes only what its container shows, or the record a link leads to; each piece of data is stored once and everything else refers to it.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## What it can do

Some tools you can make by combining a table, a page and a few actions:

| Tool                       | Data                                                                           | Containers                                   | Tools                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Receipts into a budget     | Expenses (amount, date, store, category, receipt); Budgets with spent and left | what's left of each budget, a spending chart | a scan button: scan → straighten → a new expense form, with the total, date and store suggested |
| Business cards to contacts | Contacts (name, company, phone, email, card)                                   | a contact list, a page per contact           | scan → a new contact form with suggestions; Call, Email and vCard buttons on each contact       |
| Bills                      | Bills (amount, how often it repeats)                                           | a calendar of due dates                      | a reminder at 9:00 on the day a bill is due                                                     |
| Trip                       | Itinerary, Bookings with their ticket PDFs, Packing list                       | a day-by-day plan, a packing checklist       | a reminder the evening before a booking; tick items as packed; itinerary as a PDF to share      |
| Sprint board               | Tasks (status, owner, priority, due date)                                      | a board with a column per status             | drag a card to change its status; export to Excel; a stand-up reminder on weekdays              |
| Video too big to send      | none                                                                           | a button on the home page                    | pick a video → compress to 20 MB → share                                                        |

The parts:

- **26 kinds of block:** lists, checklists, boards you drag between, calendars, charts, numbers, forms, file shelves, buttons, images and more.
- **19 field types:** money, dates, ratings, files, links between tables, rollups, formulas, schedules and more. Filters, search, reminders, CSV and Excel export.
- **97 actions that run on the phone:** scan to PDF, Word or Excel, text recognition, PDF tools, image tools (ID photos, background removal, watermarks), video (compress to a size, trim, GIF), audio (record, speech to text, MP3, noise reduction), translation, QR codes, ZIP.
- **Any look:** colors, fonts, card styles, backgrounds, icons, the bottom bar. Several apps in one, each with its own style.
- **Files from anywhere:** share photos, videos or PDFs to Tinkrum and it suggests the quick actions that fit.
- **Undo anything,** back to the first version. English, Chinese and French.

## What it can't do

Most limits come from the rules that keep your data on your phone and keep the app safe to change. Here is what each rule rules out.

**Your files and records never go to a cloud model, so:**

- Tink can't read what you keep. It can't summarize a contract or answer questions about a PDF.
- Reading documents happens on the phone (text recognition, and an optional small model that suggests form values). That's less accurate than a large cloud model: check the suggestions, and treat translations as a way to understand, not as official translations.

**Everything runs offline and nothing sends your data anywhere, so:**

- No live data from the internet: no exchange rates (amounts in different currencies are never added together), no weather, prices or news.
- No connection to other services: Tinkrum doesn't sync with your calendar, bank, cloud drive or other apps, and doesn't send email or post for you. Sharing goes through the phone's share sheet, when you tap.
- No accounts or sync: your app and records live on one phone, and nobody can edit a table with you. Export to keep a backup.

**There's no code, only parts from fixed lists, so:**

- A new kind of block, field or action can't be made from a sentence, and neither can custom screens or games. Tink says so, and "Tell us you need this" sends us that one sentence.
- Quick actions are straight chains: no if/else, no loops, and one quick action can't start another. Formulas are arithmetic with a simple if.

**Nothing happens without your tap, so:**

- No automations: no "every Monday, export my expenses and email them", no filing new photos as they arrive. Reminders only show a notification. (One exception: entries left in the trash for 30 days are deleted.)
- Originals are never moved or deleted, so Tinkrum can't tidy up your photo library; it works on copies.

**Tink changes the app; it doesn't do the task, so:**

- It doesn't answer questions, write messages to send out, or run a quick action. Ask it to "translate this contract" and you get a translate button that runs on your phone.
- It can't change Settings, Change history, the Tink page or permissions, so you can always get back in and undo.

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
