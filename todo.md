# Writing History: simplify

Commit each step separately. After each commit: `npm test`, `npm run test:recording`, `npm run package:win`.
The order is set by the dependencies: steps 2, 3 and 5 are small and stand alone; step 4 next; steps 1 and 6 last, because they touch the same strings and share one translation pass.

## 1. One setting, three levels, asked once ✅

The levels are **Off**, **Record only** and **Record and timestamp**. Recording stays on this computer. Timestamping sends fingerprints out, so it's never on unless the writer chose it. The writer chooses before writing a word, not after the book is finished.

**Storage:** the level is stored in today's two flags, so a device still on an older version reads it correctly:

| Level | `recordWriting` | `proveWriting` |
|---|---|---|
| Off | `false` | |
| Record only | `true` | `false` |
| Record and timestamp | `true` | `true` |

One helper sets the level, `setHistoryLevel('off' | 'record' | 'timestamp', { asked })`. Every place that changes the setting calls it instead of `setRecordWriting` or `setProveWriting`.

- [x] **File menu** (`main.js:2883`): one entry, **Record Writing History ▸**, with three radio items: **Off**, **Record Only**, **Record and Timestamp**. It replaces "Keep a Replay of My Writing". **Writing History…** (opens the dialog) stays a separate item above it.
  - main.js reads the level from library.json when it builds the menu. The window sends the level whenever it changes (reusing `rec:state`), so the tick stays right when it's changed in the footer or on another device.
  - Picking **Record and Timestamp** from the menu asks with the existing `confirmModal` (the points `setProveWriting` shows), unless the writer chose that level when they were asked.
  - Pocket has no timestamping, so its ⋯ sheet (`pocket/www/index.html:244`) offers only **Off** and **Record only**.
- [x] **First run, step 3: "Your writing history"** (`#firstrun` in `index.html`, `showFirstRun` in `app.js:796`). It comes after the fonts step, before **Start writing**. The three levels are cards, like the pantser/plotter ones, with **Record only** selected:
  - **Off**: NEO keeps no history. Snapshots still work.
  - **Record only**: every keystroke is kept with the book, on this computer, so you can watch how it was written and bring back any earlier version. Nothing is sent anywhere.
  - **Record and timestamp**: every keystroke is recorded as above, and every hour you write, a unique fingerprint of the recording (never your words) goes to two timestamp services. Their receipts prove when it was written.
  - The choice made here *is* the consent (`asked: true`), so nothing asks again. Pocket shows two cards.
- [x] **History footer** (`app.js:4119–4145`): the two checkboxes become the same three-level choice (a small segmented control or a select). At the timestamp level, the line saying when the book was last sealed stays under it; clicking it opens Timestamp services….
- [x] Drop the `recordHintShown` toast (`app.js:6424–6428`); the question replaces it.

### Existing users

These are people who already use NEO and update to the first version with Writing History. They've finished first run, so they'd never see step 3. They're asked once whether to start recording from now on.

- [x] **Nothing records until they've answered.** Today `recordWriting` that isn't set means on (`recordingWanted`, `app.js:2555`). Change it: a library with `firstRunDone` but no `historyAsked` doesn't record. Recording starts after they answer, and only if they chose to. Nothing is recorded behind their back for a session first.
- [x] **Ask once, on the shelf, at the first launch after the update.** NEO starts on the shelf, so the question is there before any book is open and never interrupts writing. If `firstRunDone` is set and `historyAsked` isn't, show step 3 on its own as a dialog:
  - It has the three cards and no close button or Esc, so it can't be skipped.
  - **Record only** is selected, the same as for a new writer; the writer can pick another level.
  - On Continue, set the level and `library.historyAsked = true`, and write library.json before the shelf can be used.
- [x] **Wording for them:**
  - Title: "New: your writing history"
  - Above the cards: "NEO can now record how you write, keystroke by keystroke, so you can watch how any chapter was written and revised, and bring back any earlier version. With timestamps, you also have proof of when your work was written. It starts when you turn it on: what you've already written is where the history begins." (The timestamps sentence only where timestamping exists, so not in Pocket.)
  - On the timestamp card: "Timestamps cover your writing from the day they're turned on."
- [x] **Once per library, not per device.** `historyAsked` lives in library.json:
  - A second computer or Pocket sharing the library isn't asked again; it follows the answer.
  - A device still on an older version doesn't record anything, because that version has no Writing History.
- [x] **Release note:** the README says what's new, that it stays on the computer unless timestamping is chosen, and that File → Record Writing History changes it. (There's no release notes file; they're written at release.)
- [x] **My own library** (the developer's) has no `historyAsked`, so it gets the question too. That's a way to test the question by hand.

## 2. Writing History… is never greyed out ✅
- [x] `main.js:2879`: remove `enabled: recState.book`.
- [x] `app.js:19967`: with no book open, `toast(t('Open a book first'))`, as `doExport` does (`app.js:19666`).
- [x] `rec:state` no longer enables the item. It only rebuilds the menu now; step 1 reuses it for the level's tick.

## 3. Nothing plays until the writer presses Play ✅
- [x] `playIt: false` in:
  - clicking a day tile (`app.js:4508`)
  - Space/Enter on a day (`app.js:5549`)
  - `startWatching` (`app.js:6267`); the `play: true` from Watch This Chapter Being Written (`app.js:6620`) opens paused at the chapter's first day
- [x] Keep as is (they only continue play the writer started): running into the next day (`4793`), the earlier/later tiles (`4533`).
- [x] Rename `openHistory`'s `play` option: it's `firstDay` now.

## 4. History blocks the global menus ✅
- [x] The window tells main when History opens and closes (`ui:modal`, a new preload method).
- [x] `buildMenu()` greys out everything while it's open, except: the Edit menu's own items (the search field needs them), Find (searches the history), ⌘S shown as **Tag This Moment…**, Quit, and the Window menu. Help is greyed out too: its items open windows of their own. A reload gives the menus back (`did-start-loading`).
- [x] Safety net: `onMenu` ignores every other message while `historyShown` is set.
- [x] Evidence…, Timestamp services… and Export… open only from inside History, so the lock already covers them.

## 5. No Snapshots button in History ✅
- [x] Remove `.hs-snaps` and its handler (`app.js:5424–5435`), its markup and its string.
- [x] Keep: Watch from Here on the Darlings tab, and snapshots shown as tags in History.

## 6. One set of words ✅

| Meaning | Word |
|---|---|
| The feature, the dialog, the data | **Writing History** (a name, capitalised; "history" alone after) |
| Capturing it | **record** (verb only) |
| Fixing it in time | **timestamp** (verb), **seal** (what's written) |
| Watching it | **play / watch** |
| The exported file | **Export Writing History…**, "a page that plays it" |

- [x] "replay" as a noun goes from everything the writer sees. "Export replay…" becomes "Export Writing History…", "Making the replay page…" becomes "Making the page…". "Keep a replay of my writing" goes (step 1).
- [x] "recording" as a noun goes from everything the writer sees. "the recording began" becomes "NEO started recording". The backup README keeps the real folder names (`recordings/`, `recording/`) and calls what's in them the history.
- [x] "Prove when I wrote" goes; the three levels replace it (step 1).
- [x] Shelf menu "Writing history…" becomes "Writing History…".
- [x] Go through every string from `grep -ohiE "t\('[^']*(replay|record|history)[^']*'"` across `app.js main.js index.html pocket/www/*`, plus `REPLAY_PAGE_WORDS` and `replay-page.js` (`scripts/replay-page.test.js` checks that list).
- [x] Internal names stay: `neo-replay-*`, `rec:`, `proof:`, file names, the `recordings/` folder and `verify-recording`.
- [x] Done as 31 strings renamed in the code and every locale (plural entries keep their forms; `en.json` says "Played back"), and the keys nothing uses any more dropped.

## 7. Translations, docs, tests, build ✅
- [x] `node scripts/i18n.js template`; translate every new or changed string into every locale.
- [x] `node scripts/pocket-www.js`.
- [x] AGENTS.md: the Writing History and Proof sections (the first-run step, the three levels, `historyAsked`, the menu names, no Snapshots button in History).
- [x] `docs/manual-tests.md`:
  - a new library asks the question in first run
  - a library from before Writing History records nothing until asked, then asks once on the shelf, and the question can't be skipped
  - after the answer, another device sharing the library isn't asked
  - the File menu's level, the footer's and Pocket's stay in step
  - Record and Timestamp from the menu asks first, unless the writer already agreed
  - nothing autoplays
  - the menus are greyed out in History
  - Writing History… with no book open shows "Open a book first"
