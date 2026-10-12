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

- [ ] Writing feels the same with **Keep a Replay of My Writing** on and off: no lag while typing, even in a long chapter or a 100-page script.
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

## Writing History, the dialog

- [ ] All four ways in open it: History in the footer, File → Writing History…, a book's shelf menu (without opening the book), and **Watch This Chapter Being Written** in a chapter's menu.
- [ ] Days: ← and → move through the tiles and show each day as it ended; a tile clicked plays its day; Esc in the player goes back to the days, Esc again closes.
- [ ] Player: play, each speed, Skip pauses, dragging the timeline, ⇧← / ⇧→ between sessions, and play running on into the next day.
- [ ] Click a paragraph on the sheet: it's highlighted, and ‹ › (or [ ]) step back and forward through the times it changed, going off when there's nothing more that way.
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
- [ ] Turn **Keep a replay of my writing** off, then restore a chapter from History (it still plays what was recorded). The toast says the replaced text is in a snapshot too; the Darlings tab's list has a new **Before a restore** snapshot holding it; Darlings is unchanged; Ctrl+Z undoes it.
- [ ] In the days, ← to an earlier day and restore from there (the day as it ended).
- [ ] In the whole book, click a paragraph of chapter 3: the restore goes to Chapter 3 (its name is in the button's tooltip); with nothing picked, to the caret's chapter.
- [ ] At the moment that's the chapter as it is now, the button says **Same as now** and does nothing.
- [ ] Pick a deleted chapter under **Deleted**. The days show it as it was just before it went; **Put This Chapter Back** brings it back after the chapter it followed, with its old title, at once.
- [ ] Restore from History opened on the shelf (book menu): it asks once whether to open the book (naming the book open now, if any, which is saved and closed); yes opens it and restores.
- [ ] Click a paragraph on the sheet at an earlier moment: the button says **Restore This Paragraph** (several selected: **Restore Paragraphs**), and × beside its name goes back to the chapter. Restoring changes only that paragraph, at once; nothing goes to Darlings; the day gets a "Before restoring to …" tag; Ctrl+Z undoes it.
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
- [ ] History's footer has **Snapshots** (only for the open book): it closes History and shows the Darlings tab's snapshot list. With no snapshots, the list's hint mentions Writing History.
- [ ] Duplicate a book from the shelf: the copy has no `recording/` folder, opens with no history, and records its own from then on; the original's history is unchanged.
- [ ] **(2 computers)** Tag on one computer, rename the tag on the other: once both have synced, History on each shows the newer name.
- [ ] In German and Russian, Tags, the tag dialog and the restore toasts read right and fit.
- [ ] **(phone)** A tag made on the desktop shows on the phone, and the phone can tag a moment.

## Proof of when I wrote (phase 5)

- [ ] History's footer has **Prove when I wrote**, off. Its tooltip says what's sent. Ticking it asks first, in plain words; Cancel leaves it off, and nothing is sent (no `seals/` folder appears).
- [ ] Turn it on with a book open: within a few seconds `recording/<id>/seals/` has `000001.json` and `000001.digicert.tsr` and `000001.sectigo.tsr`, and the footer says "Sealed today at …, timestamped by DigiCert and Sectigo."
- [ ] Check a stamp without NEO: `openssl ts -verify -data 000001.json -in 000001.digicert.tsr -CAfile proof-roots.pem` (from NEO's folder) says `Verification: OK`. The same for Sectigo's.
- [ ] Write for over an hour: one new seal an hour while writing, none while not. Closing the book seals once more.
- [ ] Tag a moment in History (a name you type): a new seal appears within a minute, not at the next hour.
- [ ] Turn the network off (airplane mode), write, close the book: seals are written but not stamped, and the footer says it's waiting for the network. Turn the network on: within half an hour (or at the next book open), the newest seal is stamped.
- [ ] Typing never slows or stutters when a seal is made, including offline, when the timestamp services take a while to answer.
- [ ] **Also anchor in Bitcoin**: a `NNNNNN.pending.ots` appears with the next seal; some hours later (with NEO open, or at the next start) it's replaced by `NNNNNN.ots`, and the footer says "Anchored in Bitcoin." `ots verify 000001.ots` (OpenTimestamps client) agrees.
- [ ] `node scripts/verify-recording.js "<library>/book-…"` on a book written for a few days with proof on says "everything checks", lists each seal with its stamps, and lists the sessions written before proof was on as "timestamped later". `--online` asks drand too and still checks.
- [ ] Turn **Keep a replay of my writing** off: no seals are made while it's off, though **Prove when I wrote** stays ticked (and is hidden).
- [ ] **Delete this book's history…** on a book with seals: the confirmation says its seals and timestamps go too; afterwards they're in the Recycle Bin with `recording/`.
- [ ] `Backups/recordings/<book folder>/<id>/seals/` has every seal and stamp, never a `.pending.ots`.
- [ ] Windows: `%APPDATA%\NEO\secrets.json` holds `proofKey` encrypted (not a readable `-----BEGIN PRIVATE KEY-----`).
- [ ] **(2 computers)** Proof on (it's a library setting, so on for both): each computer seals its own folder with its own key, and verify-recording checks both.
- [ ] **(phone)** The phone doesn't offer proof and writes no seals; its sessions are checked as unsealed.

## Evidence report and exported replay (phase 6)

- [ ] History's footer has **Evidence…** and **Export replay…** beside Snapshots, and the footer still fits at the window's smallest width (nothing overlaps the proof line).
- [ ] **Evidence…** on a book written for a few days: "Reading every session…", then How "…" was written: Facts (time, keys, rhythm, pauses, revision, going back, pasted, without a key, not recorded, timestamps), then Judgement, then "These are judgements, not proof." Numbers look right for what you did (paste a paragraph from a web page: it shows under Pasted).
- [ ] Paste a long passage from another app within a few seconds of switching back to NEO: the report counts it as "within ten seconds of coming back to NEO".
- [ ] Dictate a sentence (Windows: Win+H; macOS: Fn Fn): it's counted under **Without a key**.
- [ ] The chapter table: click a row, see that chapter's report; **← The whole book** goes back; Esc or Done closes the report and leaves History open.
- [ ] On a book with a year of writing, the report takes no more than half a minute, and NEO stays responsive meanwhile (you can type in another book's window, scroll History).
- [ ] With proof on for a while: the report's Timestamps row names DigiCert and Sectigo and lists sessions written before proof was on as "timestamped later, on …". With proof never on: "Not sealed…".
- [ ] **Export replay…**, the whole book: the save dialog opens in the last export folder, named "<title> — Writing History.html". Open the file in Chrome, Firefox, Safari and Edge, with the network off: it opens on the book as it is now, plays (Play, speeds, Skip pauses, the slider, the days, ‹ ›), and "What this page checks" ends with green ticks and "The figures below … match."
- [ ] In the exported page, with proof on: each seal's files download from **Every seal**, and `openssl ts -verify -data 000001.json -in 000001.digicert.tsr -CAfile proof-roots.pem` (with the page's own proof-roots.pem) says `Verification: OK`.
- [ ] **Export replay…**, only some chapters: the page shows and plays only them; searching the file (open it in a text editor and look for a phrase from a chapter left out) finds nothing; the page says nothing on it fixes them in time.
- [ ] Edit one character in an exported page's data with a text editor (inside a session's base64 is hard; change a seal's `"seq"` instead): the page shows a red ✗.
- [ ] The exported page in your interface language (Language menu, then export): its buttons and checks are translated where the language has them.
- [ ] The exported page on a phone's browser (email it to yourself): readable, plays, no sideways scrolling.
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
- [ ] **(phone)** **Keep a replay of my writing** in the ⋯ sheet turns recording off and on.
- [ ] **(phone)** iPhone with the library in iCloud: History fetches the desktop's sessions first, and shows them.
- [ ] **(phone)** Open and close History several times on a long book: it doesn't get slower, and the app's memory goes back down once it closes.
- [ ] **(phone)** Kill the app mid-session, reopen the book: the session is closed as crashed and plays.
- [ ] **(phone)** A session written on the phone plays on the desktop, named "iPhone" / "Android", and the desktop's on the phone.
- [ ] **(phone)** Search on the phone over a book with a long history finishes, and shows progress meanwhile.
- [ ] **(phone)** Delete a phone session from the book on the desktop after a desktop has mirrored it (7 days on): the phone still plays it from the mirror.
