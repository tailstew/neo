# Things to test by hand

What `npm test` and `npm run test:recording` can't reach: real keyboards and input methods, the system trash, real sync between computers, a phone, long use, and how things look. Test with the portable exe (`dist\NEO-<version>-portable.exe`) rebuilt from the commit being tested.

Items a script can check are in the end-to-end tests instead, listed at the end (`npm run test:history`, `test:recording`, `test:proof`, `test:export`, `test:writing`). Each item says what to do and what should happen. Tick it with the date and the commit when it passes; when a change touches an area, untick what it could have broken. Items marked **(2 computers)** or **(phone)** need that setup.

The second computer is the Chromebook: its Linux (arm64) runs `dist\linux-arm64-unpacked` packed as a tarball (`npm run package:linux` can't make the AppImage on Windows without Developer Mode, since it needs symlinks), and the library is synced with Syncthing over the Wi-Fi, `Documents\NEO Library` here and `~/Documents/NEO Library` there. The phone is the Android phone, with Pocket.

## Backups (4g)

- [x] Start NEO with a book that has Writing History. `Backups/` gets `README.txt`, and today's `neo-backup-<date>.zip` has no `book-…/recording/` folders in it and has `_recordings.txt` at the top. *(2026-10-29, 7c87c3e)*
- [x] `Backups/recordings/<book folder>/<this computer's id>/` holds each finished session and `device.json`, and no open session folder. *(2026-10-29, 7c87c3e)*
- [x] Kill NEO while writing (`taskkill /F /T /IM NEO.exe`: Task Manager's End task closes it nicely), start it, open the book. The crashed session is closed and appears in the mirror. *(2026-10-29, 7c87c3e)*
- [x] Start NEO again the same day. Nothing in the mirror changes (same modified times), and the README isn't rewritten. *(2026-10-29, 7c87c3e)*
- [x] Switch the interface language (View → Language), quit and start NEO again (switching only reloads the window). `Backups/README.txt` is rewritten in that language (once the strings are translated). *(2026-10-29, 4871622)*
- [x] Delete a book from the shelf. Both the book folder and its mirror folder are in the Recycle Bin; restore both (NEO closed), then File → Reshelve a Book…, and the book and its history come back. *(2026-10-29, d96a03b)*
- [x] Switch the interface to French and back to English: the first shelf, if never renamed, reads Works in Progress again (not En cours d’écriture). A shelf you named yourself keeps its name. *(2026-10-30, 78cb104)*
- [x] Delete one session's `.jsonl.gz` from a book's `recording/<device>/`. Writing History still plays that day, from the mirror, and nothing is copied back into the book. *(2026-10-29, 4871622)*
- [x] Follow `Backups/README.txt` to restore a chapter from a zip. NEO opens it, and History shows the text going back as the book opens, before anything is typed or clicked ("Changed while NEO wasn’t recording"). *(2026-10-29, d96a03b)*
- [x] Unzip a zip made before 4g over the library (it holds `recording/` with open session folders). Opening the book doesn't close those sessions again: the stale folders go, the closed files are unchanged, and History plays as before. *(2026-10-29, d96a03b: no such zip left, so a closed session's first chunk was put back as an open folder by hand)*
- [x] **(2 computers)** A session closed on the other computer reaches this one's `Backups/recordings/<book folder>/<its id>/` because the other computer mirrored it, and this one never writes it: in Syncthing's file info (`/rest/db/file`) its version names only the other device. *(2026-10-30, 6947c24: Chromebook session `2026-10-30T14-15-35Z-iwwz`)*
- [ ] **(phone)** A session written on the phone (Pocket mirrors nothing) isn't in the desktop's mirror for 7 days; after that, the desktop's next start (or its hourly backup) copies it.
- [ ] **(2 computers)** No conflict copies (`… 2.jsonl.gz`, `.sync-conflict-…`) appear in `Backups/recordings/` after a week of normal use on both. *(started 2026-10-30 with the Chromebook; look again from 2026-11-06)*

## Recording, while writing

- [ ] Writing feels the same with **Record Writing History** at Off and at Record Only: no lag while typing, even in a long chapter or a 100-page script.
- [ ] Dead keys and AltGr (é, ñ, ă, ș), and the Windows emoji panel (Win+.) replay as typed.
- [ ] An input method (Microsoft Pinyin or Japanese IME): composed text replays and the chapter matches.
- [ ] Windows voice typing (Win+H) into a chapter replays and the chapter matches.
- [ ] Paste from Word, from a web page, and from another NEO chapter. Each replays, and the timeline marks pastes from outside and from the book differently.
- [ ] Sleep the laptop mid-session, wake it, keep writing. History shows the time away, not a burst of fast typing.
- [ ] Drag a selected sentence to another place in the chapter with the mouse. It replays as a move.
- [ ] Nothing ever interrupts typing because of the recording: no popup, no pause, even when the library folder is busy syncing.

## Recording, the files on disk

- [ ] With the library on iCloud or Syncthing, a week of normal use leaves no conflict copies in any `recording/` folder.
- [ ] File → Library Folder… to another folder: recording, History and the backup mirror follow the new library.

## Record Writing History, the setting

- [ ] **(2 computers)** Answer the question on one computer: once the library has synced, the other isn't asked (an open question there goes away) and follows the answer.
- [ ] **(phone)** The ⋯ sheet's **Record Writing History** offers Off and Record only, and follows the desktop's choice (Record and timestamp on the desktop shows as Record only).

## Writing History, the dialog

- [ ] Click or drag on the timeline: the sheet scrolls to where the change is, as playing does. The exported page plays pauses as NEO does, with the same badge in the writer's language. *(The rest of this item, ▶▶, the pause badge, the first moment of a day or a chapter, the play head's bounds and the moved and pasted markers, is in `npm run test:history`.)*
- [ ] A paragraph picked: the buttons beside it are as large as the footer's or larger and follow it as the sheet scrolls. As the window narrows they step down: ‹ Earlier version and Restore This Paragraph side by side, then one above the other, then ‹ Older / Restore / Newer ›, then ‹ and ›, and in the narrowest window restore is ↺. On a 1920-pixel screen, maximised, they're in words (‹ Older above Restore, Newer › on the right). *(Found 2026-11-12: at 1904 px they never showed in words; fixed the same day. The tooltips, hiding while it plays, words at 1904 px and ‹ › in a narrow window are in `npm run test:history`.)*
- [ ] The replayed page looks exactly like the editor (fonts, italics, scene breaks, dialogue, a script's layout), in light and dark, with Brighter Interface on and off.
- [ ] Opening History on a book with months of writing: the days appear quickly, the rest fill in with progress, and the window stays responsive.
- [ ] **(2 computers)** Both computers' sessions on one day play interleaved, named by device; a chapter changed on both shows "As it was on …" where they diverged. *(first half passed 2026-10-30, 6947c24: Teacher's Pet, the laptop and the Chromebook, in order and named, on both; the divergence still to see, with the next item)*
- [ ] **(2 computers)** NEO open on both at once on the same book (iCloud or Syncthing): no words lost, the twin chapter appears, and History shows both.

## Restore (phases 3 and 7)

- [ ] Restore a paragraph from months ago that has been edited many times since: it's found, and it replaces the right paragraph. Note how long "Finding them…" shows.
- [ ] **(2 computers)** Delete the history on one while the other has the book open; on the other, keep writing. No words lost, and History on either shows the writing from then on.
- [ ] **(phone)** Restore works on the phone; the delete button isn't there.

## Tags and snapshots (phase 7)

- [ ] **(2 computers)** Tag on one computer, rename the tag on the other: once both have synced, History on each shows the newer name.
- [ ] In German and Russian, the tag dialog and the restore toasts read right and fit. *(History's controls, footer and side pane, Tags among them, at the smallest window in German, Romanian and Russian: `npm run test:history`.)*
- [ ] **(phone)** A tag made on the desktop shows on the phone, and the phone can tag a moment.

## Proof of when I wrote (phase 5)

- [ ] **With the network**, the real services (the tests use timestamp services on this computer): turn on Record and Timestamp and write; the seal's stamps are DigiCert's and Sectigo's, and `openssl ts -verify -data 000001.json -in 000001.digicert.tsr -CAfile proof-roots.pem` (from NEO's folder) says `Verification: OK`, the same for Sectigo's. `node scripts/verify-recording.js "<library>/book-…" --online` asks drand and still says everything checks. In Timestamp services…, adding `freetsa.org/tsr` says its root is in no public list (**Add anyway**), and `http://ts.ssl.com` that its root is in Mozilla's list (**Add**).
- [x] With timestamping on, write a sentence and quit NEO within a minute (before the five-minute seal). Start it again and open the book: within a few seconds a new seal covers those words. Open and close a book without typing: no seal. *(2026-10-30, 6947c24, on the Chromebook's Linux: seal 000001 at the next open, stamped by DigiCert and Sectigo; record test opened and closed, no seal and no folder)*
- [ ] **(2 computers)** Proof on (it's a library setting, so on for both): each computer seals its own folder with its own key, and verify-recording checks both.
- [ ] **(phone)** The phone doesn't offer proof and writes no seals of its own.
- [ ] **(phone)** With proof on on the desktop, write on the phone and let it sync, with the book not open on the desktop: within half an hour a new seal is in the desktop's `recording/<id>/seals/`, with the phone's sessions under `"others"`; the book gets the desktop's folder if it had none. Opening the book on the desktop seals them at once. Nothing new on the phone, and nothing new arrives: no seal.
- [ ] **(phone)** How It Was Written… on that book: the Timestamps row counts the phone's sessions, and says they were timestamped within a day. In History, a day written on the phone shows "Timestamped …" and the dashes on the track. The exported page's checks pass, and `node scripts/verify-recording.js` says the phone's device was "Sealed by" the desktop.
- [ ] **(2 computers + phone)** Both computers have proof on: only one seals a given phone head (look for it under `"others"` in one seal), and neither puts the other computer's sessions under `"others"`.

### Timestamp services…

- [ ] **(2 computers)** Move GlobalSign first and add freetsa.org on one; once the library has synced, open Timestamp services… on the other: the same order, freetsa.org there with its note, without checking it again. Its next seal is stamped in that order.
- [ ] **(2 computers)** With the other on the shelf, change the order on the first: once the shelf picks up the library (within 30 s, or on focus), a book opened there seals in the new order.
- [ ] **(phone)** Pocket opens and saves the library without dropping `proofTsas`.

## Evidence report and exported Writing History (phase 6)

- [ ] On a book with a year of writing, the report takes no more than half a minute, and NEO stays responsive meanwhile (you can type in another book's window, scroll History).
- [ ] In NEO and the exported page, on a book with several chapters: the whole book's day tiles are an 8×8 grid, each chapter a run of cells in order with a thin line where it starts; a short story's tile is a grid of small squares, not stripes. Older books' days are rebuilt once when History first opens.
- [ ] In the exported page: within a few seconds of opening, each day tile shows the same map as that day's tile in NEO (green where words came, red where they went, gold where both); picking a chapter on the left redraws them for that chapter, as a 6×6 grid.
- [ ] Open an exported file in Firefox, Safari and Edge, with the network off: it looks and plays as it does in Chrome, and its checks button ends "✓ Checked". *(Chrome's engine: `npm run test:export`.)*
- [ ] Hover the timeline, in History and in the exported page: the tips say what's there (pastes, time away, tags, and on the timestamps' track "Timestamped …").
- [ ] **(phone)** The exported page on a phone's browser (email it to yourself): no side pane, the sheet, the controls and the header's buttons fit, it plays, and there's no sideways scrolling. *(At a phone's width in Chrome's engine: `npm run test:export`.)*
- [ ] **(phone)** Pocket's History has neither button.

## Upstream 1.5.0's features, recorded

Each of these changes chapters in code that came in with the rebase onto 1.5.0. After each, the session shows no "A change the recorder didn't see", and History plays it.

- [ ] Type a dedication in the paperback dialog on a book without one: the new Dedication page is recorded.
- [x] Edit the same chapter on two devices so a save finds the other's version: the chapter kept beside it is "From another device, kept beside this one". *(failed 2026-10-30, 6947c24, laptop and Chromebook over Syncthing: each saved its own words, Syncthing kept one file and set the other aside as `….sync-conflict-….html`, and NEO showed only the one kept; fix on branch `sync-conflict-copies`; passed with the fix, 2026-10-30, 9c93ec1)*

## Sync conflict copies (branch `sync-conflict-copies`)

- [x] **(2 computers)** With both builds on that branch, edit the same chapter on both within a few seconds, five times. Every version shows: one as the chapter, each other as the chapter after it ("… from other device, <time>"), the same on both computers once synced, with no chapter twice. Each `….sync-conflict-….html` has moved from `chapters/` into the book's `sync-conflicts/`, unchanged. *(2026-10-30, 9c93ec1, record test: two clashes became chapters on both, every word typed on either is in the book; Syncthing left `~syncthing~….tmp` files of its own, and `book.json` has 13 conflict copies, none with a different chapter order)*
- [x] Open record test (it still holds the copies made on 2026-10-30): "lapyop", "laptop", "chromebookwww2" and "chromebookwww1 fred" each come in as a chapter after chapter 1, and the copies move to `sync-conflicts/`. *(2026-10-30, 9c93ec1: on the laptop, then the Chromebook showed the same four chapters, none twice; a new `book.sync-conflict-…json` differed only in `lastPosition` and `modified`)*
- [x] Open record test (its folder holds 13 `book.sync-conflict-…json` and `book.json.sync-conflict-…bak` copies from 2026-10-30, none with another chapter order): the chapters stay as they were, and every one of those copies moves into `sync-conflicts/`. *(2026-10-30, b9d0865: all 13 moved, the 7 chapters as they were)*
- [x] **(2 computers)** With the book open on both, add a chapter on one and type a few words in it, while typing in another chapter on the other, until a `book.sync-conflict-…json` appears. The new chapter is in the book on both, in its place and with its title, and nothing was put in twice. *(2026-10-30, b9d0865: record test, both sets of changes on both computers; the laptop's caret then went to the Chromebook's spot, as meant when the other device's writing is the newer)*
- [x] **(2 computers)** Move a section card to loose cards on one computer while the other is typing in the same book: the loose card is there on both once synced. *(passed 2026-10-30 on Bad News, both computers on bf46c9f)* *(2026-10-30, b9d0865: failed. The Chromebook, typing, kept saving its older book.json; the laptop took that in, so the chapters set on cards came back (empty on the laptop, with their words on the Chromebook) and the cards made after them went: 42 cards on one, 18 on the other. Fixed by `book.removed`; test again on a new book, with both computers on the new build.)*
- [x] **(2 computers)** On a fresh book open on both: while typing steadily on one, set two chapters and two sections on loose cards on the other, place one card back, delete another. Once synced, and after clicking away and back on each, both show the same chapters and the same cards, nothing twice and nothing back that was taken out; the outline card count is the same on both. *(2026-10-30, bf46c9f, bad news: the two chapters set on cards stayed out on both, the two cards deleted went on both (into Darlings), the section's card is on both, every word typed is there. A section moved off chapter 1 while the Chromebook typed in it made the usual "from other device" chapter, holding the section again; Enter pressed on an empty line on the Chromebook split chapter 1, so the section is in the book three times)*
- [ ] **(2 computers)** Set a chapter on a card on one computer while the other is typing *in that chapter*: the chapter stays on both (with the new words), and the card is there too. Nothing typed is lost.
- [ ] **(2 computers)** Add a chapter with a title on one computer while the other types: it stays, with its title, on both, even when a `book.sync-conflict-…json` appears.
- [ ] Set a chapter on a card, then ⌘Z: the chapter is back and the card gone, and the other computer shows the same once synced.

## Pocket

- [x] **(phone)** Android: write in a book (the on-screen keyboard, then a hardware one), close it, reopen. Each session ends with its `end` line (`verify-recording` on the book pulled with `adb pull`). History is in the footer (the tab strip fades at an edge with more tabs past it), the ⋯ sheet and the book menu, and plays the session; a finger dragged along the timeline moves the play head; the back gesture leaves the player, then the dialog. ⋯ → Darlings opens Darlings. *(2026-11-13, 9045ce8, OnePlus 9, Android 14)*
- [ ] **(phone)** iPhone (iOS 16.4 or later): the same. On iOS 15 or 16.3 History isn't offered and nothing is recorded.
- [x] **(phone)** **Record Writing History** in the ⋯ sheet turns recording off and on: Off writes no session and `recordWriting: false`; back on, the words written meanwhile come in as a `catch-up`. *(2026-11-13, 9045ce8, OnePlus 9, Android 14)*
- [ ] **(phone)** iPhone with the library in iCloud: History fetches the desktop's sessions first, and shows them.
- [x] **(phone)** Open and close History several times on a long book: it doesn't get slower, and the app's memory goes back down once it closes. *(2026-11-13, 9045ce8, OnePlus 9, Android 14: a copy of Jagged Future, 22 sessions, 2.4 MB; first open ~2 s, then ~0.5 s each; 157 MB on the shelf, 165 MB in the book after five opens)*
- [x] **(phone)** Kill the app mid-session (`adb shell am force-stop com.hughhowey.neopocket`), reopen the book: the session is closed as crashed (only once the book opens: reopening the app alone leaves it open), the words it hadn't recorded come in as a `catch-up`, and the day plays through, those words all at once. *(2026-11-13, 9045ce8, OnePlus 9, Android 14)*
- [ ] **(phone)** A session written on the phone plays on the desktop, named "iPhone" / "Android", and the desktop's on the phone.
- [x] **(phone)** Search on the phone over a book with a long history finishes, and shows progress meanwhile. A finding picked shows its phrase; upright and on its side History's side pane and footer buttons are in the ☰ drawer, and the text fills the sheet; a restore can be undone from its toast, or from History while the chapter is as it left it. *(2026-11-13, a601c42, OnePlus 9, Android 14: a copy of Jagged Future; "the door" in about a second; "zebra crossing" finds nothing)*
- [ ] **(phone)** Delete a phone session from the book on the desktop after a desktop has mirrored it (7 days on): the phone still plays it from the mirror.

## Checked by the e2e tests

These were items here. The end-to-end tests now check them: `npm run test:history` (scripts/history.e2e.js), `test:recording` (scripts/recording.e2e.js), `test:proof` (scripts/proof.e2e.js), `test:export` (scripts/export.e2e.js) and `test:writing` (scripts/writing.e2e.js); run them after a change to Writing History. When one fails, the item comes back here until it passes.

The timestamp services in `test:proof`, `test:export` and `test:writing` are `scripts/fake-tsa.js` on this computer, standing in for DigiCert, Sectigo and GlobalSign: real RFC 3161 tokens (`openssl ts -verify` accepts them) signed under a test root it makes on each run (no key is kept or committed) that those tests trust as one of NEO's own, so nothing reaches the network. The five minutes after the writing stops are shortened there, and the hour, the half hour and the week are the main process's clock moved on (`scripts/e2e-neo.js`). The system trash is a folder of the test's own.

- All four ways in open History: the footer, File → Writing History…, a book's shelf menu, Watch This Chapter Being Written. `test:history`, `test:recording`
- The days: ← and → show each day as it ended; Enter opens one paused, Space plays, Esc goes back, then closes. `test:history`
- Watch This Chapter Being Written opens at the chapter's first day, paused. `test:recording`
- While History is open a menu item clicked closes it and does it; its shortcut does nothing; Find searches the history; Ctrl+S tags; a click outside closes it. `test:history`, `test:recording`
- Search: first written, written out; Match case and Whole words; a finding lands on its moment, highlighted. `test:history`, `test:recording`
- History closed and opened again rebuilds nothing. `test:history`
- The search toggles keep their setting while NEO is open. `test:history`
- With a chapter picked, only the days that changed it have tiles. `test:history`
- Chapters joined, made a section, set on a card or deleted leave the side pane's list at the moment they went, and are listed on the day before. `test:history`
- A chapter picked at a moment it isn't there stays listed, dimmed, and the sheet says so: "This chapter isn't in the book at this moment." once it has gone (deleted, joined, on a card), "…doesn't exist yet…" before it was made. `test:history`
- Keyboard only: Tab reaches every control in the days and the player, each visible with focus, never leaves the dialog, and Esc gets out. `test:history`
- Keyboard only: Tab and Shift+Tab stay inside every dialog (a question, a confirmation, a choice, the shortcuts, Timestamp services…, and How It Was Written… and Delete history over History), and Esc closes each. `test:history`
- Restore This Chapter: at once, no confirmation, the toast, the "Before restoring to …" tag first, no snapshot or Darlings. `test:recording`
- After a restore, the "Before restoring to …" tag is in Tags, on the day's tile and on the timeline, and shows the chapter as it was. `test:history`
- Ctrl+Z undoes a restore. `test:recording`
- With recording off, a restore keeps the chapter in a "Before a restore" snapshot, and the toast says so. `test:history`, `test:recording`
- Restore from the days, on an earlier day. `test:history`
- In the whole book the restore goes to the picked paragraph's chapter, named in the tooltip. `test:history`
- The chapter as it is now: Same as now, greyed out. `test:history`
- Put This Chapter Back brings a deleted chapter back after the one it followed. `test:recording`
- Restore from History opened on the shelf asks once to open the book, then restores. `test:history`
- Restore This Paragraph (Restore Paragraphs for several) changes only them, tags the moment before, and Ctrl+Z undoes it. `test:history`, `test:recording`
- A paragraph taken out since: History says when, and Add to Darlings, and copy keeps it. `test:history`
- A paragraph moved to another chapter since: History names the chapter it seems to be in. `test:history`
- A paragraph whose chapter was deleted: History says so, and Copy works. `test:recording`
- Text copied from the sheet pastes without the player's caret, recorded as from this book and that moment. `test:recording`
- A restore shows a Restored marker on the timeline. `test:history`
- Tag This Moment… (Ctrl+S in History): toast, newest moment first in Tags, a flag on the timeline and on the day's tile. `test:history`, `test:recording`
- A moment tagged in the days is the day's end. `test:history`
- A tag picked opens the player at its moment. `test:recording`
- Rename… and Remove Tag from a tag's right-click menu, kept after History is opened again. `test:history`
- Search finds a tag by its name, first. `test:history`, `test:recording`
- Ctrl+S's snapshot is a tag "Snapshot · Taken by you", which can be named and removed, the snapshot staying. `test:history`, `test:recording`
- The writer's day (ending at 4am: 1am and 3am the day before), and a day's first change taking one start-of-day snapshot. `test:history`
- Tag This Moment… is dimmed, saying why, with recording off and from the shelf; Ctrl+S then tags nothing. `test:history`
- A duplicated book has no recording/; the original keeps its history. `test:recording`

### The setting, recording and the files on disk

- First run's last step: Off, Record only and Record and timestamp as cards, Record only picked; each, chosen, is the File menu's; Record and timestamp asks nothing more, and the first book written is sealed and stamped. `test:writing`
- A library from before Writing History records nothing until asked, once, on the shelf: what the history lets the writer do, that timestamps prove when, that it starts when turned on; Record only picked; no close button, and Esc and a click outside leave it; Continue writes `historyAsked` and the level. `test:recording`, `test:writing`
- File → Record Writing History ▸ Record and Timestamp asks first, in plain words; Cancel leaves the tick on Record Only, sends nothing and makes no `seals/`. `test:proof`
- Off says nothing already recorded is touched; nothing records while off; Record Only again catches up what changed meanwhile, as a catch-up, not as typing. `test:recording`, `test:writing`
- History has no level setting of its own. `test:history`
- File → Writing History… is never greyed out; on the shelf it says "Open a book first". `test:recording`
- `recording/` gets `README.txt`, this computer's folder a `device.json` naming it, the open session chunks as it goes, and a rollup replaces its chunks. `test:writing`
- A session ends with the writer's day, and the next day has its own tile. `test:recording`, `test:history`
- Spelling suggestions picked from NEO's menu (spellcheck on, the word right-clicked) replay. `test:export`
- Poetry (⌘⇧Enter) and a script typed with Tab between elements across pages: the replay matches, and no `data-pg`, `data-contd`, `data-fill` or `data-ghost` is in the recording or the file. `test:writing`
- The Notes, a chapter title, an outline note and a sticky edited: the whole book's tile names them, and the sheet shows only chapters. `test:writing`
- The walking note never reaches the recording or the chapter file. `test:writing`
- A book from before Writing History, with chapters never edited: History's first day lists them all. `test:history`, `test:recording`
- A book recorded by an earlier build (sessions with no `day`, no notes or titles recorded) plays every session on its day; the first session now starts the notes and titles from a baseline and carries the chapters on. `test:writing`
- Linux with the home folder reported as Documents: a library synced into `~/Documents/NEO Library` is the one opened, not a first run; with no Documents folder a first library goes there; a library an earlier NEO put in the home folder stays, and none is made in Documents; File → Library Folder… shows the folder and offers no Use Default Folder. `npm test` on branch `linux-documents-folder` (scripts/library-folder.test.js)

### Upstream 1.5.0's features, recorded

Each with no change the recorder didn't see, and every write replaying to its file. `test:writing`

- A snapshot restored from the Darlings tab, one chapter and the whole book: "Snapshot restored" on the timeline, a chapter it didn't have leaves, and the "Before a restore" snapshot is a tag.
- A chapter, a written section and a script's scene to Loose Cards and back: "Moved in the Outline".
- A list pasted into the Outline's List makes chapters.
- A section and a scene deleted to Darlings from their cards; a scene break deleted with Backspace.
- Styled text pasted from a web page: no styling stays, and NEO's tidy is a change of its own.
- Two books opened one after the other: only the second is open, and its session holds only its chapters.
- Stickies changed on another device while the book is open: the stream takes them in as from another device.

### Writing History, the dialog, and restore

- A restore's toast has an Undo button that undoes it, and goes; typing in the book puts it away. `test:history`
- History offers Undo This Restore just before or after a restore while the chapter is as the restore left it, and puts back the text from before; once the chapter is written in, it doesn't. When the book's last change is that restore, a bar above the sheet says so as History opens, and undoes it. `test:history`
- A search finding picked brings its phrase into sight, also where the chapter held it before the recording began (a baseline), far from the caret. `test:history`
- On a phone either way up (600 px wide; 800 × 380), History's text is as wide as the editor's page there, the side pane is a drawer (☰ in the title bar, clear of the sheet; the footer's buttons inside it): ☰ brings it, a chapter picked, a tap beside it or Esc puts it away (Esc staying in the player), and Find brings it with the search field. `test:history`
- The History tab's tooltip, the dialog and an empty history say what it is plainly, with no "replay" or "recording" as a noun; their French is there. `test:history`
- A search stopped while it looks inside the days: its findings say "perhaps earlier" and "perhaps later". `test:history`
- A day's timeline names its split, its joins, its delete and its card. `test:history`
- How It Was Written…'s chapter table says what took each chapter no longer in the book (joined, moved to a loose card, deleted). `test:history`
- In German, Romanian and Russian, at the smallest window, History's controls, footer and side pane don't overlap or run out of their boxes. `test:history`
- A paragraph edited and moved within its chapter is found by its words and restored in its new place. `test:history`
- A one- or two-word paragraph moved since is found by its words. `npm test` (scripts/recording-restore.test.js)
- A script restored from History comes back whole, with as many page breaks and (CONT'D)s as before. `test:writing`
- Delete this book's history…: what goes (the tags, with their number; the timestamps) and what stays (the book, its snapshots); the phrase in any case, and in French the French phrase; yes: `recording/` and its mirror in the trash, the words and snapshots there, and what's written next is the first day. `test:writing`, `test:history`, `test:proof`, `test:recording`
- Both folders put back from the trash (merged, as Windows puts a folder back): the old history plays again beside the new. `test:writing`
- On the Darlings tab, Watch from Here in a snapshot's band and its right-click menu; with no snapshots, the hint mentions Writing History. `test:history`

### Proof of when I wrote

With the test's own timestamp services. `test:proof`

- Record and Timestamp turned on with a book open: within seconds `000001.json`, `.digicert.tsr` and `.sectigo.tsr`, and only `.json` and `.tsr` in `seals/`; History's toast says "Last timestamped today at …, by DigiCert and Sectigo." and its footer doesn't.
- `secrets.json` holds `proofKey`, not a readable PEM.
- The writing stops: one seal five minutes later, and at its dash on History's track the sheet shows that stretch whole and nothing after.
- Writing on for over an hour: a seal once the first unsealed words are an hour old, then one when it stops; closing the book seals only if words came since.
- Caret moves, clicks and focus alone seal nothing; a session that ended with a seal, then only clicks, counts as timestamped within a day.
- A moment tagged with a name is sealed at once.
- Typing goes on while a seal waits on slow services.
- Offline: seals written but not stamped, and History's toast says it's waiting; online, the half hour's retry stamps the newest.
- A week with no stamp: an amber warning as the book opens, pointing to Timestamp Services…; not when the writer is typing by then; not once a stamp comes.
- NEO's window crashes after a sentence: opening the book again seals the crashed session at once, and verify-recording counts it.
- verify-recording: everything checks, each seal with its stamps, every session timestamped within a day.
- The backup mirror has every seal and stamp.
- Off: no seals; Record and Timestamp again asks first.
- Delete this book's history… on a book with seals says its timestamps go; they go to the trash with `recording/`.
- Timestamp Services…: under a line after Record and Timestamp; from History it closes History first; the three, ticked, with their addresses (GlobalSign's ends `tsa/r45standard`); ↑ and ↓ only on the row pointed at or with focus; GlobalSign moved first is kept, and stamps first; one ticked warns of one timestamp, none of none; the opt-in then names the services first now.
- Adding a service: one whose root is in no public list says so (**Add anyway**), goes last with its note, and its root is in `library.json`; one whose root is public says so (**Add**); one that isn't a timestamp service, or is already listed (however its address is written), isn't added.
- The added service ticked into the first two warns; its seal brings its root beside the seals once; verify-recording says the root was added by the writer.
- × takes an added service out; Restore the defaults asks first when one was added, then shows the three in order, and takes `proofTsas` out of `library.json`.
- Esc in the address closes the add row, Esc again the dialog with History left open; a click outside closes it.

### How It Was Written… and Export ▸ Writing History…

`test:export`; the exported file is opened in a window of its own, as Chrome would open it.

- History's footer: Tag This Moment…, restore, How It Was Written… and Delete as one kind of pill, the last two at the right, no Export; Delete's hover is red; at the smallest window they wrap, never overlap.
- How It Was Written…: "Reading every session…", then figures only (no "Judgement"), every row; the rhythm's bars from "under 50 ms" to "3.2 s to a minute", each with its %; deletions in a row from "1 key" to "11 or more"; pastes from outside in characters, with no count of pastes; one within ten seconds of coming back to NEO; text cut and pasted within the book under Moved, not Pasted; dictation, Undo from the Edit menu and a cut with the mouse each their own sentence under Not typed, which ends with what it leaves out; three spelling picks under Revised as typed, not under Not typed.
- Typed with Backspaces, then once back 500 characters or more before the end: Revised as typed and Revised later count each.
- The chapter table: a row opens that chapter's report, ← The whole book goes back, and Esc and Done close the report and leave History open.
- With timestamping never on: "None: timestamping wasn't turned on…", and the player shows no "Timestamped" and no track.
- With timestamps: the Timestamps row's count, first and last (never "Invalid Date"), the mean between, the services, and "Sessions not timestamped within a day of ending: n of m"; in the player "Timestamped …" changes as it's scrubbed, a dash per seal, "Not timestamped" after the last.
- File ▸ Export: Writing History… in a section of its own between the formats and Paperback for KDP… (in a script, after Final Draft); on the shelf, second to last, exporting without opening the book; with no book open "Open a book first"; a book never recorded "This book has no Writing History to export yet."; from History, it closes History and asks.
- The ask: the warning alone (red-edged; every keystroke and the time zone, nothing about devices; the health sentence; the risk in bold), I understand focused, Continue plainly grey in dark and light until ticked; Space ticks, Enter continues; Esc and Cancel export nothing; then the description ("One file that plays…") and the choices. In French, the warning is French.
- The choices: the whole book picked; chapters typed (`1-3, 5`, `1 - 3; 5`, `1–3 5`, `3,1,2,5`) or clicked, the field rewritten shortest; `0`, `5-3`, a number past the last or a letter said in red with Export greyed; the whole book again hides it all.
- The whole book: the save dialog in the last export folder, named "<title> — Writing History.html"; the file checks itself; the chapters down the left; the tiles; no footer; the buttons at the right of the header; the controls above the tiles, and on screen in a low window.
- The exported player: a tile opens its day paused, with the days either side; ▶ and ❚❚; ▶▶ lit at 8× and back; Space; ← and → on the timeline; Esc back to the days.
- The exported pop-ups: How it was written, starting "The figures below were worked out again … and match"; the checks, ending "Made with NEO"; Close, Esc and a click outside close them.
- With JavaScript off the file is the report on a plain page; at a phone's width, no side pane and nothing wider than the screen; exported in French, its buttons are French.
- Chapters `1-2, 4`, and `3`: named for them, only their writing inside (unpacked too), only they on the left; with nothing timestamped, "its timestamps can't be verified".
- Moved-in text: chapter 3 alone is warned of chapter 2's text, 2–3 isn't; a chapter joined to another: the export of the one that took it says the text came from a chapter no longer in the book.
- The whole book with its seals: checked; each seal's fingerprint as verify-recording prints it; its files to download; its stamps check against the page's own roots. A seal changed by one character: "Some checks failed".
- One chapter, timestamped, as a public sample: no Tags; its seals checked against its own lines; how many other chapters they cover; the same fingerprints as the whole book's; verify-recording still says everything checks.
