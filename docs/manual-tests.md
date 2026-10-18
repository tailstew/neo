# Things to test by hand

What `npm test` and `npm run test:recording` can't reach: real keyboards and input methods, the system trash, real sync between computers, a phone, long use, and how things look. Test with the portable exe (`dist\NEO-<version>-portable.exe`) rebuilt from the commit being tested.

Each item says what to do and what should happen. Tick it with the date and the commit when it passes; when a change touches an area, untick what it could have broken. Items marked **(2 computers)** or **(phone)** need that setup.

## Backups (4g)

- [ ] Start NEO with a book that has Writing History. `Backups/` gets `README.txt`, and today's `neo-backup-<date>.zip` has no `book-…/recording/` folders in it and has `_recordings.txt` at the top.
- [ ] `Backups/recordings/<book folder>/<this computer's id>/` holds each finished session and `device.json`, and no open session folder.
- [ ] Kill NEO in Task Manager while writing, start it, open the book. The crashed session is closed and appears in the mirror.
- [ ] Start NEO again the same day. Nothing in the mirror changes (same modified times), and the README isn't rewritten.
- [ ] Switch the interface language, restart. `Backups/README.txt` is rewritten in that language (once the strings are translated).
- [ ] Delete a book from the shelf. Both the book folder and its mirror folder are in the Recycle Bin; restore both and the book and its history come back.
- [ ] Delete one session's `.jsonl.gz` from a book's `recording/<device>/`. Writing History still plays that day, from the mirror, and nothing is copied back into the book.
- [ ] Follow `Backups/README.txt` to restore a chapter from a zip. NEO opens it, and History shows the text going back on the next day.
- [ ] Unzip a zip made before 4g over the library (it holds `recording/` with open session folders). Opening the book doesn't close those sessions again: the stale folders go, the closed files are unchanged, and History plays as before.
- [ ] **(2 computers)** A session written on the other computer is not copied into the mirror by this one within 7 days; after 7 days without the other computer, it is.
- [ ] **(2 computers)** No conflict copies (`… 2.jsonl.gz`, `.sync-conflict-…`) appear in `Backups/recordings/` after a week of normal use on both.

## Recording, while writing

- [ ] Writing feels the same with **Record Writing History** at Off and at Record Only: no lag while typing, even in a long chapter or a 100-page script.
- [ ] Turn the setting off, write, turn it on. Nothing is recorded while off; History shows the text that changed meanwhile as a catch-up, not as typing.
- [ ] Dead keys and AltGr (é, ñ, ă, ș), and the Windows emoji panel (Win+.) replay as typed.
- [ ] An input method (Microsoft Pinyin or Japanese IME): composed text replays and the chapter matches.
- [ ] Windows voice typing (Win+H) into a chapter replays and the chapter matches.
- [ ] Paste from Word, from a web page, and from another NEO chapter. Each replays, and the timeline marks pastes from outside and from the book differently.
- [ ] Spellcheck pass: accept a few suggestions. Each replays.
- [ ] Poetry and a screenplay: type, Tab between elements, let (CONT'D) and page breaks appear. Replays match, and no `data-pg` / `data-contd` marks are recorded into the chapter.
- [ ] Notes tab, chapter titles, outline notes and stickies: edit each. History doesn't play them, but the day's description names them ("Notes, Chapter titles").
- [ ] Leave NEO open past the writer's day end (`library.dayEndsAt`). The session closes and a new one starts on the new day; both days have tiles.
- [ ] Sleep the laptop mid-session, wake it, keep writing. History shows the time away, not a burst of fast typing.
- [ ] Drag a selected sentence to another place in the chapter with the mouse. It replays as a move.
- [ ] The walking note never appears in the replay, and the chapter files don't hold its mark.
- [ ] Nothing ever interrupts typing because of the recording: no popup, no pause, even when the library folder is busy syncing.

## Recording, the files on disk

- [ ] Write for a while: `book-…/recording/` gets `README.txt`, and `<id>/device.json` names this computer. The open session's folder gets a `c-…jsonl` chunk about every 20 seconds, and an `s-…jsonl.gz` rollup every 10 minutes, after which its chunks go.
- [ ] With the library on iCloud or Syncthing, a week of normal use leaves no conflict copies in any `recording/` folder.
- [ ] File → Library Folder… to another folder: recording, History and the backup mirror follow the new library.

## Record Writing History, the setting

- [ ] A new library (move `library.json` aside, or File → Library Folder… to an empty folder): first run's third step, **Your writing history**, offers Off, Record only and Record and timestamp as cards, Record only picked. **Start writing** with each in turn: the File menu's **Record Writing History** shows the same. Record and timestamp chosen there asks nothing more; the first book written is timestamped.
- [ ] A library from before Writing History (take `historyAsked` out of `library.json`, then start NEO): nothing records (no new session in a book's `recording/`) until a question on the shelf, **New: your writing history**, is answered. Esc and a click outside leave it there; it has no close button. The text above the cards says what the history lets the writer do, that timestamps prove when the work was written, and that it starts when turned on. Record only is picked to start with; the timestamp card says timestamps cover the writing from the day they're turned on. **Continue** writes `historyAsked: true` and the level, and NEO doesn't ask again.
- [ ] **(2 computers)** Answer the question on one computer: once the library has synced, the other isn't asked (an open question there goes away) and follows the answer.
- [ ] File → **Record Writing History ▸ Record and Timestamp** asks first, in plain words; Cancel leaves the tick on Record Only and sends nothing. Off stops recording at once and says nothing already recorded is touched; Record Only again catches up what changed meanwhile.
- [ ] History has no level setting of its own; File → Record Writing History is where it changes.
- [ ] File → **Writing History…** is never greyed out. On the shelf it says "Open a book first"; with a book open it opens History.
- [ ] **(phone)** The ⋯ sheet's **Record Writing History** offers Off and Record only, and follows the desktop's choice (Record and timestamp on the desktop shows as Record only).

## Writing History, the dialog

- [ ] The History tab's tooltip, the shelf menu's **Writing History…** and the empty history describe it plainly (how the book was written), in English and in French. Nowhere does the interface say "replay" or "recording" as a noun; it says Writing History, record, play and watch.
- [ ] All four ways in open it: History in the footer, File → Writing History…, a book's shelf menu (without opening the book), and **Watch This Chapter Being Written** in a chapter's menu.
- [ ] Days: ← and → move through the tiles and show each day as it ended; a tile clicked (or Space/Enter on it) opens its day paused, and nothing plays until Play or Space; Esc in the player goes back to the days, Esc again closes.
- [ ] **Watch This Chapter Being Written** opens the player at the chapter's first day, paused.
- [ ] While History is open, clicking any menu item (Goals, Export, Format…) closes History and then does it. The same item's shortcut does nothing while History is open. Find searches the history, and Ctrl+S is **Tag This Moment…** (where Take Snapshot was). A click outside the dialog closes it.
- [ ] Player: ▶ plays as written, ▶▶ at 8× (lit while it's on; pressed again while playing fast goes back to as written; pressed while paused plays fast); a pause over 3 s plays 3 s at ▶ and is skipped at ▶▶, and either way a badge shows its true length ("paused 2 min") while it plays, or briefly at ▶▶. The exported page plays pauses the same way, with the same badge, in the writer's language. On a book with words written before recording began, the first day's start shows those words (not "Nothing written yet at this moment."), in NEO and in the exported page. Dragging the timeline, ⇧← / ⇧→ between sessions, and play running on into the next day. A click or drag on the timeline scrolls the sheet to where the change is, as playing does.
- [ ] Click a paragraph on the sheet: it's highlighted, and while paused **‹ Earlier version** and **Restore This Paragraph** float in the margin to its left and **Later version ›** to its right, as large as the footer's buttons or larger, following it as the sheet scrolls; nothing about it is left in the controls under the sheet. Hover them: the tooltips say "Back to how this read before it last changed" and "On to how this reads after it next changes". They (or [ ]) step back and forward through the times it changed, going off when there's nothing more that way. In a narrower window they become ‹ and ›, and narrower still the restore button is ↺, its name in the tooltip. Esc or a click off the text puts it down. While it plays, the buttons hide.
- [ ] Search (Ctrl+F in the dialog): a name finds first written, last written, written out and moved; the toggles for Match case and Whole words work; picking a finding lands on the moment with the phrase highlighted; Stop leaves "perhaps earlier/later".
- [ ] The replayed page looks exactly like the editor (fonts, italics, scene breaks, dialogue, a script's layout), in light and dark, with Brighter Interface on and off.
- [ ] Opening History on a book with months of writing: the days appear quickly, the rest fill in with progress, and the window stays responsive.
- [ ] Close and reopen History: nothing is rebuilt (instant).
- [ ] The search toggles keep their setting while NEO is open, and go back to the defaults after a restart.
- [ ] With a chapter picked in the side pane, only the days that touched it have tiles, and a split, joined or deleted chapter is labelled as such.
- [ ] Keyboard only: Tab reaches every control in the days and the player, each shows on focus, and Esc always gets out.
- [ ] In German (long words) and in Romanian, the dialog's labels fit and nothing overlaps, at the window's smallest size too.
- [ ] **(2 computers)** Both computers' sessions on one day play interleaved, named by device; a chapter changed on both shows "As it was on …" where they diverged.
- [ ] **(2 computers)** NEO open on both at once on the same book (iCloud or Syncthing): no words lost, the twin chapter appears, and History shows both.

## Restore (phases 3 and 7)

- [ ] In the player, pause on an earlier moment of a chapter and click **Restore This Chapter**. No confirmation: the dialog closes, the chapter reads as it did then, and a toast says "Chapter restored from …", that Ctrl+Z undoes it, and that the text it replaced is in Writing History at "Before restoring to …". Darlings and the snapshot list are unchanged.
- [ ] Open History again: that day has a **Before restoring to …** tag (in Tags in the side pane, a flag on the timeline and on the day's tile). Picking it shows the chapter exactly as it was before the restore.
- [ ] Ctrl+Z (with the caret outside the text) puts the chapter back as it was.
- [ ] Set **Record Writing History** to Off, then restore a chapter from History (it still plays what was recorded). The toast says the replaced text is in a snapshot too; the Darlings tab's list has a new **Before a restore** snapshot holding it; Darlings is unchanged; Ctrl+Z undoes it.
- [ ] In the days, ← to an earlier day and restore from there (the day as it ended).
- [ ] In the whole book, click a paragraph of chapter 3: the restore goes to Chapter 3 (its name is in the button's tooltip); with nothing picked, to the caret's chapter.
- [ ] At the moment that's the chapter as it is now, the button says **Same as now** and does nothing.
- [ ] Pick a deleted chapter under **Deleted**. The days show it as it was just before it went; **Put This Chapter Back** brings it back after the chapter it followed, with its old title, at once.
- [ ] Restore from History opened on the shelf (book menu): it asks once whether to open the book (naming the book open now, if any, which is saved and closed); yes opens it and restores.
- [ ] Click a paragraph on the sheet at an earlier moment: the button beside it is **Restore This Paragraph** (several selected: **Restore Paragraphs**, in its tooltip), and the footer's button still restores the whole chapter. Restoring changes only that paragraph, at once; nothing goes to Darlings; the day gets a "Before restoring to …" tag; Ctrl+Z undoes it.
- [ ] Restore a paragraph from months ago that has been edited many times since: it's found, and it replaces the right paragraph. Note how long "Finding them…" shows.
- [ ] Restore a paragraph that was moved within its chapter: it's found by its words and restored in its new place.
- [ ] Restore a paragraph that was later deleted: the dialog says when it was taken out, and **Add to Darlings, and copy** puts it in Darlings and on the clipboard (paste it into a chapter to check).
- [ ] Restore a paragraph that was moved to another chapter (cut and paste, or an Outline card): the dialog names the chapter it seems to be in now.
- [ ] Restore a paragraph of a chapter that was deleted: the dialog says the chapter was deleted, and Copy works.
- [ ] Select text on the sheet, Ctrl+C, close History, Ctrl+V in a chapter. It pastes as plain prose (no caret mark, no stray styles), and the timeline marks it as pasted from this book.
- [ ] A restore made on a script restores the whole script, and its pages and (CONT'D) come back right.
- [ ] Restore, then open History again: the day shows a Restored marker on the timeline.
- [ ] **Delete this book's history…**: a confirmation says what goes and what stays (snapshots on the Darlings tab stay; the history's tags go, with their number), and **Delete history** stays off until you type "delete history" (any case; in another interface language, that language's phrase). Cancel, Esc and a click outside change nothing. Yes: `recording/` and `Backups/recordings/<book folder>/` are in the Recycle Bin, the book's words are all there, the snapshots are still listed, and History says nothing is recorded yet. Write a little: History shows it as the first day.
- [ ] Restore both folders from the Recycle Bin (with NEO closed): the old history plays again beside the new.
- [ ] **(2 computers)** Delete the history on one while the other has the book open; on the other, keep writing. No words lost, and History on either shows the writing from then on.
- [ ] **(phone)** Restore works on the phone; the delete button isn't there.

## Tags and snapshots (phase 7)

- [ ] In the player, pause, click **Tag This Moment…** (or Ctrl+S while History is open), type "Draft 2", Enter. A toast says it's tagged; Tags in the side pane lists it (newest first), the timeline has a flag there, and the day's tile has a flag in its corner with the name in its tooltip.
- [ ] Tag a moment in the days (no player): the tag is on the day's end.
- [ ] Pick a tag in the side pane: the player opens at that moment, paused, the sheet showing the book as it was then.
- [ ] Right-click a tag: **Rename…** changes its name everywhere; **Remove Tag** takes it away (the moment is still there). Close and reopen History: both stick.
- [ ] Search the history for a word in a tag's name: the tag is listed first, as "Tag · …", and picking it goes to it.
- [ ] Ctrl+S while writing: the snapshot is taken as before (toast, Darlings tab), and History shows it as a tag "Snapshot · Taken by you" at that moment. A snapshot's tag can be named (right-click → **Name…**) and removed; removing it says the snapshot itself is still on the Darlings tab, and it is.
- [ ] The first change of a writing day takes a "Start of the day" snapshot at the writer's day (`library.dayEndsAt`): with the day ending at 4am, writing at 1am and 3am takes no second one; at 5am it does.
- [ ] On the Darlings tab, show a snapshot: **Watch from Here** is in its band (only while the book has a history) and opens History in the player at the snapshot's tag. Right-click a snapshot in the list: **Watch from Here** does the same. A snapshot older than the history opens at its first day.
- [ ] With recording off, or History opened on a book from the shelf without opening it, **Tag This Moment…** is dimmed and its tooltip says why; Ctrl+S in History says the same and tags nothing.
- [ ] History's footer has no **Snapshots** button. On the Darlings tab with no snapshots, the list's hint mentions Writing History.
- [ ] Duplicate a book from the shelf: the copy has no `recording/` folder, opens with no history, and records its own from then on; the original's history is unchanged.
- [ ] **(2 computers)** Tag on one computer, rename the tag on the other: once both have synced, History on each shows the newer name.
- [ ] In German and Russian, Tags, the tag dialog and the restore toasts read right and fit.
- [ ] **(phone)** A tag made on the desktop shows on the phone, and the phone can tag a moment.

## Proof of when I wrote (phase 5)

- [ ] At Record Only, File → Record Writing History offers **Record and Timestamp**. Choosing it asks first, in plain words (title "Timestamp your writing history?"); Cancel leaves it at Record only, and nothing is sent (no `seals/` folder appears).
- [ ] With timestamping on, only `.json` and `.tsr` files appear in `seals/`.
- [ ] Turn it on with a book open: within a few seconds `recording/<id>/seals/` has `000001.json` and `000001.digicert.tsr` and `000001.sectigo.tsr`, and opening History shows a toast "Last timestamped today at …, by DigiCert and Sectigo." (above the dialog, gone after a few seconds); the footer has no such line.
- [ ] Check a stamp without NEO: `openssl ts -verify -data 000001.json -in 000001.digicert.tsr -CAfile proof-roots.pem` (from NEO's folder) says `Verification: OK`. The same for Sectigo's.
- [ ] Write for 20 minutes, then stop (leave NEO open): about five minutes later one new seal appears. In History, its dash on the timeline's track is at the end of those 20 minutes, not at the start of the next writing.
- [ ] Write without stopping for over an hour: a seal once the first unsealed words are an hour old, then one when you stop. Closing the book seals once more only if words were written since the last seal.
- [ ] Open a book, move the caret around and click in and out of the window for a few minutes without typing, then close it: no new seal in `seals/`.
- [ ] Tag a moment in History (a name you type): a new seal appears within a minute, not at the next hour.
- [ ] Turn the network off (airplane mode), write, close the book: seals are written but not stamped, and History's toast as it opens says it's waiting for the network. Turn the network on: within half an hour (or at the next book open), the newest seal is stamped.
- [ ] Typing never slows or stutters when a seal is made, including offline, when the timestamp services take a while to answer.
- [ ] `node scripts/verify-recording.js "<library>/book-…"` on a book written for a few days with proof on says "everything checks", lists each seal with its stamps, and lists the sessions written before proof was on as "timestamped later". `--online` asks drand too and still checks.
- [ ] Set **Record Writing History** to Off: no seals are made, and choosing Record and Timestamp again asks first.
- [ ] **Delete this book's history…** on a book with seals: the confirmation says its seals and timestamps go too; afterwards they're in the Recycle Bin with `recording/`.
- [ ] `Backups/recordings/<book folder>/<id>/seals/` has every seal and stamp.
- [ ] Windows: `%APPDATA%\NEO\secrets.json` holds `proofKey` encrypted (not a readable `-----BEGIN PRIVATE KEY-----`).
- [ ] Turn the network off for over a week of writing (or move the clock), then open the book: once NEO has tried the services again, a warning toast (amber) says your writing since … hasn't been timestamped and points to Timestamp Services…. Start typing right after opening and it doesn't appear. Online again, it doesn't come back.
- [ ] **(2 computers)** Proof on (it's a library setting, so on for both): each computer seals its own folder with its own key, and verify-recording checks both.
- [ ] **(phone)** The phone doesn't offer proof and writes no seals of its own.
- [ ] **(phone)** With proof on on the desktop, write on the phone and let it sync, with the book not open on the desktop: within half an hour a new seal is in the desktop's `recording/<id>/seals/`, with the phone's sessions under `"others"`; the book gets the desktop's folder if it had none. Opening the book on the desktop seals them at once. Nothing new on the phone, and nothing new arrives: no seal.
- [ ] **(phone)** How It Was Written… on that book: the Timestamps row counts the phone's sessions, and says they were timestamped within a day. In History, a day written on the phone shows "Timestamped …" and the dashes on the track. The exported page's checks pass, and `node scripts/verify-recording.js` says the phone's device was "Sealed by" the desktop.
- [ ] **(2 computers + phone)** Both computers have proof on: only one seals a given phone head (look for it under `"others"` in one seal), and neither puts the other computer's sessions under `"others"`.

### Timestamp services…

- [ ] File → Record Writing History has **Timestamp Services…** under a line after Record and Timestamp, and it opens **Timestamp services** (with History open too: History closes first): DigiCert, Sectigo, GlobalSign, all ticked, each with its address. GlobalSign's ends `tsa/r45standard`.
- [ ] ↑ and ↓ show only on the row under the pointer or with focus. Move GlobalSign to the top: close and reopen it; the order is kept. Write past the hour (or tag a moment): the new seal's stamps are `globalsign` and `digicert`.
- [ ] Untick all but one: a warning says each seal has one timestamp. Untick all: it says nothing timestamps your writing. The opt-in, turned off and on again, names the services that are first now, not DigiCert and Sectigo.
- [ ] **Add a service…**, type `freetsa.org/tsr`, Enter: after a moment it says freetsa.org answered, and that its root is in no public list; the button says **Add anyway**. Add it: it's last in the list, with that note under it, and `library.json` has a `proofTsas` entry for `freetsa-org` with its `root` (`-----BEGIN CERTIFICATE-----`).
- [ ] Add `http://ts.ssl.com`: it says its root is in Mozilla's list, and the button says **Add**.
- [ ] Add a web address that isn't a timestamp service (`https://example.com`): it says NEO couldn't use it, and nothing is added. Add one already in the list: it says so.
- [ ] Tick freetsa.org and move it into the first two: the warning says its stamps don't count toward the time cover. With a seal stamped by it, the book's `seals/` holds `root-<16 hex>.pem` once, beside `NNNNNN.freetsa-org.tsr`; `verify-recording.js` lists that stamp "(root added by the writer, in no public list)"; Evidence's Timestamps don't count it; the exported page's proof-roots.pem ends with it, and `openssl ts -verify … -CAfile proof-roots.pem` on its stamp says OK.
- [ ] × on an added service takes it out (its entry leaves `proofTsas`; its stamps in books stay checkable). **Restore the defaults** with one added asks first, then shows the three, ticked, in order.
- [ ] Esc in the address field closes the add row; Esc again closes the dialog, and History stays open. A click outside closes it too.
- [ ] **Restore the defaults** takes `proofTsas` out of `library.json`.
- [ ] **(2 computers)** Move GlobalSign first and add freetsa.org on one; once the library has synced, open Timestamp services… on the other: the same order, freetsa.org there with its note, without checking it again. Its next seal is stamped in that order.
- [ ] **(2 computers)** With the other on the shelf, change the order on the first: once the shelf picks up the library (within 30 s, or on focus), a book opened there seals in the new order.
- [ ] **(phone)** Pocket opens and saves the library without dropping `proofTsas`.

## Evidence report and exported Writing History (phase 6)

- [ ] History's footer has **How It Was Written…**, **Export Writing History…** and **Delete this book's history…** at the right, as pill buttons just like **Tag This Moment…** and the restore button (same size, border and hover; Delete's hover is red), and the footer still fits at the window's smallest width, wrapping rather than overlapping. Light theme too.
- [ ] **How It Was Written…** on a book written for a few days: "Reading every session…", then How "…" was written, figures only: Time, Keys, Rhythm (with bars for the gaps between keys, under 50 ms up to "3.2 s to a minute", each with its %), Pauses, Revised as typed (with bars for deletions in a row: 1 key … 11 or more), Revised later, Pasted, Without typing, Not recorded, Timestamps. No "Judgement" heading and no sentence saying what the figures mean (nothing like "vary as a person’s do"). Numbers look right for what you did (paste a paragraph from a web page: it shows under Pasted).
- [ ] Paste a long passage from another app within a few seconds of switching back to NEO: the report counts it as "within ten seconds of coming back to NEO".
- [ ] Dictate a sentence (Windows: Win+H; macOS: Fn Fn): it's counted under **Without typing**, as "dictation or another program: 1".
- [ ] Turn on spellcheck, right-click a misspelt word and pick a suggestion, three times: **Revised as typed** says "Spelling suggestions picked: 3", and **Without typing** doesn't count them. A book written before this change (the short story) counts its earlier picks the same way.
- [ ] Type a sentence, Backspace a few letters, type on; then click well back in the chapter (500 characters or more before its end) and delete and type a few words there: **Revised as typed** counts the first deletions, **Revised later** counts going back once and the characters typed and deleted there.
- [ ] The chapter table: click a row, see that chapter's report; **← The whole book** goes back; Esc or Done closes the report and leaves History open.
- [ ] On a book with a year of writing, the report takes no more than half a minute, and NEO stays responsive meanwhile (you can type in another book's window, scroll History).
- [ ] With proof on for a while: the report's Timestamps row says how many timestamps, the first and the last (each a date and a time, never "Invalid Date"), one every … on average between them, "Timestamp services: DigiCert, Sectigo", and "Sessions not timestamped within a day of ending: n of m" when some were written before proof was on, with no list of sessions after it. With proof never on: "None: timestamping wasn’t turned on…".
- [ ] With proof on, in History's player: the footer shows "Timestamped …" after the moment's time; scrub across the day and it changes where a new seal begins. A thin track under the timeline's bars has a dash at each timestamp; hover one: the tip says "Timestamped …". Moments after the last seal (still being written) say "Not timestamped". With proof never on, neither shows.
- [ ] **Export Writing History…**, the whole book: the save dialog opens in the last export folder, named "<title> — Writing History.html". Open the file in Chrome, Firefox, Safari and Edge, with the network off: it looks like History in NEO. The chapters are down the left, then Tags (a click goes to that tag's moment, paused). The sheet is in the middle, and the days are tiles under it, the last one picked, showing the book as it is now. The footer stays on screen at any window height: ▶, ▶▶, the moment, the timestamp, **How it was written** and the checks button, which reads "Checking… n%" and then "✓ Checked".
- [ ] In NEO and the exported page, on a book with several chapters: the whole book's day tiles are an 8×8 grid, each chapter a run of cells in order with a thin line where it starts; a short story's tile is a grid of small squares, not stripes. Older books' days are rebuilt once when History first opens.
- [ ] In the exported page: within a few seconds of opening, each day tile shows the same map as that day's tile in NEO (green where words came, red where they went, gold where both); picking a chapter on the left redraws them for that chapter, as a 6×6 grid.
- [ ] In the exported page: a tile opens that day in the player, paused at its start, with ‹ and › days either side of its timeline. ▶ plays as written and ❚❚ pauses; ▶▶ plays 8× and lights up, and a second press goes back to 1×. Space plays and pauses, and Esc goes back to the days. A click or drag on the timeline (or ← / → on it) goes there and scrolls the sheet to where the change is, as playing does, and hovering says what's there (pastes, time away, tags, timestamps). Long pauses are always cut short, and at the day's end it plays on into the next.
- [ ] In the exported page: **How it was written** opens the report in a pop-up, starting "The figures below were worked out again … and match", with the same figures and bars as NEO's Evidence…; the checks button opens "What this page checks" in a pop-up, ending "Made with NEO …". Close, Esc or a click outside closes either. With proof on, the footer says "Timestamped …" and the timeline has the timestamps' track, the same as in NEO for the same day.
- [ ] The exported page with JavaScript off: the report is readable on a plain page.
- [ ] In the exported page, with proof on: each seal's files download from **Every seal**, and `openssl ts -verify -data 000001.json -in 000001.digicert.tsr -CAfile proof-roots.pem` (with the page's own proof-roots.pem) says `Verification: OK`.
- [ ] **Export Writing History…**, only some chapters: the page shows and plays only them; searching the file (open it in a text editor and look for a phrase from a chapter left out) finds nothing; the page says nothing on it fixes them in time.
- [ ] Edit one character in an exported page's data with a text editor (inside a session's base64 is hard; change a seal's `"seq"` instead): the page shows a red ✗.
- [ ] The exported page in your interface language (Language menu, then export): its buttons and checks are translated where the language has them.
- [ ] The exported page on a phone's browser (email it to yourself): no side pane, the sheet and the footer fit, it plays, and there's no sideways scrolling.
- [ ] **(phone)** Pocket's History has neither button.

## Upstream 1.5.0's features, recorded

Each of these changes chapters in code that came in with the rebase onto 1.5.0. After each, the session shows no "A change the recorder didn't see", and History plays it.

- [ ] Restore a Snapshot from the Darlings tab, the whole book and one chapter: History marks it "Snapshot restored", a chapter the snapshot didn't have leaves the book, and the "Before a restore" snapshot it takes is a tag on the moment before.
- [ ] Send a chapter, a written section and a scene to Loose Cards, then drag each back in: "Moved in the Outline".
- [ ] Paste a list into the Outline's List that makes new chapters.
- [ ] Delete a scene and a section to Darlings from their cards; delete a scene break with Backspace.
- [ ] Paste styled text from a web page into a chapter: the spans NEO strips afterwards are a tidy, not part of the next key.
- [ ] Type a dedication in the paperback dialog on a book without one: the new Dedication page is recorded.
- [ ] Open two books quickly one after the other (double-click, then another): only the second is open, and its session holds only its own chapters.
- [ ] Edit the same chapter on two devices so a save finds the other's version: the chapter kept beside it is "From another device, kept beside this one".
- [ ] Change stickies on another device while the book is open here: the comments stream picks the change up as from another device.

## Upgrading from earlier builds

- [ ] Open History on a book recorded with an earlier build of this branch (phases 1 to 4f, sessions with no `day` in their header). Every session still plays, on the day it was written.
- [ ] Sessions written before 4f (no notes, titles, outline or stickies) play, and the first session after upgrading starts each of those from where it stands (a baseline), while the chapters carry on as before.

## Pocket

- [ ] **(phone)** Android: write in a book, close it, reopen. History is in the footer and the book menu and plays the session; the back gesture leaves the player, then the dialog.
- [ ] **(phone)** iPhone (iOS 16.4 or later): the same. On iOS 15 or 16.3 History isn't offered and nothing is recorded.
- [ ] **(phone)** **Record Writing History** in the ⋯ sheet turns recording off and on.
- [ ] **(phone)** iPhone with the library in iCloud: History fetches the desktop's sessions first, and shows them.
- [ ] **(phone)** Open and close History several times on a long book: it doesn't get slower, and the app's memory goes back down once it closes.
- [ ] **(phone)** Kill the app mid-session, reopen the book: the session is closed as crashed and plays.
- [ ] **(phone)** A session written on the phone plays on the desktop, named "iPhone" / "Android", and the desktop's on the phone.
- [ ] **(phone)** Search on the phone over a book with a long history finishes, and shows progress meanwhile.
- [ ] **(phone)** Delete a phone session from the book on the desktop after a desktop has mirrored it (7 days on): the phone still plays it from the mirror.
