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

## Restore (phase 3)

- [ ] Click **Restore Chapter N to this moment**: a confirmation says what the chapter becomes (words then and now), that what it holds now goes to Darlings and under what name, how to undo, that History keeps both versions, and that the backups aren't touched. Cancel and Esc leave History as it was.
- [ ] In the player, pause on an earlier moment of a chapter, click **Restore Chapter N to this moment** and confirm. The dialog closes, the chapter reads as it did then, a toast says where the words went, and Darlings' newest entry is the text it replaced, labelled "before restoring to …".
- [ ] Ctrl+Z (with the caret outside the text) puts the chapter and Darlings back as they were.
- [ ] In the days, ← to an earlier day and restore from there (the day as it ended).
- [ ] In the whole book, click a paragraph of chapter 3 and the button names Chapter 3; with nothing picked it names the caret's chapter.
- [ ] At the moment that's the chapter as it is now, the button says **As it is now** and does nothing.
- [ ] Pick a deleted chapter under **Deleted**. The days show it as it was just before it went; **Put this chapter back** brings it back after the chapter it followed, with its old title.
- [ ] Restore from History opened on the shelf (book menu): the book opens and the chapter is restored.
- [ ] Click a paragraph on the sheet at an earlier moment: the button says **Restore this paragraph to this moment** (several selected: **these paragraphs**), and × beside its name goes back to restoring the chapter. Restoring it changes only that paragraph; the old one is in Darlings; Ctrl+Z undoes it.
- [ ] Restore a paragraph from months ago that has been edited many times since: it's found, and it replaces the right paragraph. Note how long "Finding them…" shows.
- [ ] Restore a paragraph that was moved within its chapter: it's found by its words and the confirmation says it moved.
- [ ] Restore a paragraph that was later deleted: the dialog says when it was taken out, and **Add to Darlings, and copy** puts it in Darlings and on the clipboard (paste it into a chapter to check).
- [ ] Restore a paragraph that was moved to another chapter (cut and paste, or an Outline card): the dialog names the chapter it seems to be in now.
- [ ] Restore a paragraph of a chapter that was deleted: the dialog says the chapter was deleted, and Copy works.
- [ ] Select text on the sheet, Ctrl+C, close History, Ctrl+V in a chapter. It pastes as plain prose (no caret mark, no stray styles), and the timeline marks it as pasted from this book.
- [ ] A restore made on a script restores the whole script, and its pages and (CONT'D) come back right.
- [ ] Restore, then open History again: the day shows a Restored marker on the timeline.
- [ ] **Delete this book's history…**: a confirmation says what goes and what stays, and **Delete history** stays off until you type "delete history" (any case; in another interface language, that language's phrase). Cancel, Esc and a click outside change nothing. Yes: `recording/` and `Backups/recordings/<book folder>/` are in the Recycle Bin, the book's words are all there, and History says nothing is recorded yet. Write a little: History shows it as the first day.
- [ ] Restore both folders from the Recycle Bin (with NEO closed): the old history plays again beside the new.
- [ ] **(2 computers)** Delete the history on one while the other has the book open; on the other, keep writing. No words lost, and History on either shows the writing from then on.
- [ ] **(phone)** Restore works on the phone; the delete button isn't there.

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
