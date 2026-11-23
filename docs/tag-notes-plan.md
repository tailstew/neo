# Plan: notes on tags, notes from other programs, and AI feedback in Draft Sleuth

Written 2026-11-23 for an agent starting cold. Three parts, in this order:

1. **NEO:** a tag in Writing History can carry a longer note beside its name.
2. **NEO:** another program can leave a note in a book's folder, and NEO takes it into the history as a tag.
3. **Draft Sleuth:** asks Claude for feedback on a chapter with the writer's own API key, and leaves that feedback for NEO to record.

Two repositories:

- NEO: `C:\Users\DocVoxel\projects\neo-authorship`, branch `recording-phase-0`. Read `AGENTS.md` first; its Writing History section is the map for parts 1 and 2.
- Draft Sleuth: `C:\Users\DocVoxel\projects\neo-lens`, branch `master`. Read `README.md` first.

## Progress

- [x] **Part 1.** Engine (line, stats, `tagsOf`, `tagsIn`, `rec.tag`), History's dialog (`askTagNote`), the note bar (`showTagNote`, `showNoteModal`), Edit Note…, search by note, the exported page, words in every locale, unit tests, a `test:history` test, AGENTS.md and manual-tests.md. Not committed. `npm test` (11 iCloud/library-move failures, the same on HEAD under Windows), `test:history` 52/52, `test:export` 28/28, `recording-format.test.js` untouched and passing. Left for part 2: `noteHead` in app.js and `noteLines` in replay-page.js return nothing yet; they are where "as given by {app}" goes. `rec.tag` already takes `note` as its fifth argument.
- [x] **Part 2.** `book:notes` in main.js (the contract checked, `afterLocal`), `bookNotes` in preload.js (none in Pocket), `takeHistoryNotes` in app.js (book open, each look at the disk, `recRestart`), sealing for `made.from`, names and "As given by …" lines in History and the exported page, no Edit Note… for them, Duplicate leaving `history-notes/` out (main.js and Pocket's bridge), words in every locale, AGENTS.md and manual-tests.md. New `npm run test:history-notes` (6/6) and a `test:proof` test (25/25); `test:history` 52/52, `test:export` 28/28. The delete dialog was left alone. Not committed.
- [x] **Part 3.** Draft Sleuth (`neo-lens`): `lib/feedback.js` (the two prompts with versions, the request, the streamed reply read, errors in words), `lib/historynote.js` (the contract, ids, the chapter hash, checked against NEO's `Rec.digest`), `writeHistoryNote` in `lib/library.js` and `lib/sources/neo.js`, the key in `userData/secrets.json` with `safeStorage`, `lens:ai*` IPC and the call with `net.fetch` in main.js, a Feedback menu (Chapter Feedback…, Proofread Chapter…, Add Feedback You Got Elsewhere…, API Key…, Model), the dialogs in `renderer/app.js`, README. The request follows the `claude-api` skill: `anthropic-version: 2026-10-21`, streamed, Claude Opus 5.5 by default at effort `high` (its own default is `medium`), no `thinking`, and server-side `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) so a refusal is answered by another model; the model the stream names is recorded. `npm test` 167/167; the feedback path driven in Electron with `net.fetch` faked (consent, key encrypted, one note with the right hash, nothing for a proofread, an unticked box, a 401; a pasted note). Not done: keeping the last feedback per chapter in settings (read it again in NEO's history). Not committed.

## Why

The writer pasted a chapter into Claude, asked "what do you think of this chapter", and revised from the reply. They want that use of AI on the record: the feedback kept in the book's Writing History, at the moment it was given, timestamped before the edits it led to. They got there in three decisions, which this plan follows:

- The record is a tag with a note. A tag is already chained, sealed, mirrored and exported.
- Only NEO writes the recording. An outside program leaves a file; NEO turns it into a tag. No command-line route and no second writer in `recording/`.
- Feedback is recorded. Proofreading is not: Draft Sleuth simply writes no file for it.

## The contract between the two programs

Draft Sleuth writes, NEO reads. Neither changes the other's files.

**Where:** `<book folder>/history-notes/<id>.json`. `id` matches `^[a-z0-9-]{1,64}$`. Written as `<id>.json.tmp` then renamed, so a sync program never sees half a file. Written once, never rewritten.

**What:**

```json
{
  "neoNote": 1,
  "id": "ds-20261123t101502-k3f9",
  "at": "2026-11-23T10:15:02.000Z",
  "app": "Draft Sleuth",
  "kind": "feedback",
  "text": "…what the writer should be able to read back, as plain text…",
  "chapter": "ch-ab12",
  "hash": "p0Qb…",
  "model": "claude-fable-5-2",
  "pasted": false
}
```

| Field | Rule |
|---|---|
| `neoNote` | `1`. NEO skips any other number. |
| `id` | The file's name without `.json`. NEO skips a file where they differ. |
| `at` | ISO time the feedback was received (or, when pasted, when it was added). |
| `app` | The program's name, at most 40 characters. Shown as given, never trusted. |
| `kind` | `"feedback"` or `"note"`. Anything else is read as `"note"`. |
| `text` | Plain text, at most 50,000 characters. Draft Sleuth puts the reply, then the prompt it sent. |
| `chapter` | Optional. The chapter the note is about. |
| `hash` | Optional, with `chapter`. The hash of the chapter file exactly as read: SHA-256 of its UTF-8 bytes, the first 16 bytes, base64url. In Node: `crypto.createHash('sha256').update(html, 'utf8').digest().subarray(0, 16).toString('base64url')`. This equals `Rec.digest(html)` in NEO's `recording.js:263`, the hash in each `w` line. |
| `model` | Optional, at most 80 characters. |
| `pasted` | Optional. `true` when the writer pasted feedback they got elsewhere, so the program can't vouch for it. |

NEO ignores a file over 256 KB, one that won't parse, and unknown fields.

## Part 1. NEO: a note on a tag

### The line

The tag line gains an optional sixth item: `['tag', id, label, at, made, note]`. `note` is a string. When there's a note and no `made`, `made` is `null`.

- This is not a new line kind, and an older NEO ignores the extra item and still shows the tag. So `neoRec` stays as it is, and so does `PLAYER`: the same lines still make the same output.
- Update the kinds list at the top of `recording.js` (line 30) to say so.
- A later line with the same id replaces the name, `made` and the note together, as a rename does now. So a rename must carry the note along, and an edited note carries the name along. The earlier wording stays in the recording; that is wanted.

### Where the code is

| What | Where | Change |
|---|---|---|
| Writing the line | `rec.tag` in `app.js:3180` | Take a `note` argument; push `made || null` then `note` when there is one. |
| Session stats | `recording.js:1549` | Add `note` to the pushed object **only when the line has one**, so stats of old sessions stay byte-for-byte what they were. `scripts/recording-format.test.js` compares frozen stats; never regenerate a fixture. |
| Tags out | `tagsOf` in `recording.js:1624` | Carry `note` through (null when absent). |
| The exported page's own reader | `tagsIn` in `replay-page.js:488` | The same. |
| The dialog's tag code | "tags: names on moments" in `app.js` (about 6997–7140): `writeTag`, `tagHere`, `renderTagList` | Below. |

### What the writer sees

- **Tag This Moment…** asks for a name and, below it, an optional note in a larger box. `askInput` (`app.js:467`) has one field, so write a small dialog for this in the same style: a `.modal-backdrop` holding a `.modal`, made a dialog by `dialogify`. Enter in the name field saves; Enter in the note box is a new line; Esc cancels and must `stopPropagation` as `askInput` does. Set the fields' values from code, never by building them into HTML.
- **A tag with a note** shows a small mark on its item in the side pane. Picking it goes to its moment as now, and shows the note in a bar above the sheet, the way `lookForLastRestore` (`app.js:6054`) shows its bar: the first lines, and a way to read all of it in a dialog. The note is set with `textContent` and `white-space: pre-wrap`; it is never parsed as HTML.
- **Right-click on a tag** gains **Edit Note…** (or **Add a Note…**), disabled where Rename is.
- **Search** in History finds a tag by its name today. Let it find one by its note's words too, if that is a small change where the name is matched; leave it out if not.
- **Pocket** shares `app.js`, so the dialog and the note work there. Check the dialog at phone width and in the drawer layout.

### The exported page

In `replay-page.js` (the tag list is about line 730), a tag with a note shows it when picked, in a `<dialog>` like the page's other pop-ups, as plain text. New words go in `REPLAY_PAGE_WORDS` (`app.js:4262`); `scripts/replay-page.test.js` fails on a `T('…')` that isn't listed. A page of chosen chapters carries no tags (`Rec.keepChapters`), so notes appear only in the whole book's export. Don't change that.

## Part 2. NEO: taking in a note another program left

### Reading the folder

Follow the conflict copies exactly; they are the precedent for "a file NEO reads once and never touches".

- `main.js`: a handler `book:notes` beside `book:conflicts` (`main.js:1221`). `(bookId, skip)` → for each `*.json` in `history-notes/`: `{ file, taken: true }` for one named in `skip`, else `{ file, note }` with the parsed and checked note, or `{ file, note: null }` for one that is too big, won't parse or breaks the contract. Check `id` against the file name and every length here, in main.
- `preload.js`: `bookNotes`, beside `bookConflicts`.
- Pocket's bridge gets no such method. `app.js` asks `if (!window.neo.bookNotes) return`, as `takeConflictCopies` does for its own. A phone's library is taken in by the desktop.
- On a Mac the folder can hold iCloud placeholders. Don't add a blocking read of one: use the helpers the other read handlers use (`cloudOnlyAmong`, `afterLocal`; see "On a Mac, iCloud" in `AGENTS.md`).

### Taking one in

In `app.js`, beside `takeConflictCopies` (`app.js:17378`), and called from the same two places (book open at `app.js:7400`, each look at the disk at `app.js:18587`):

1. Only while this book is open and recording (`rec.on && rec.bookId === bookId`). Otherwise leave every file untaken; they wait.
2. For each note not yet taken, write a tag:
   - id `'n-' + note.id`, so two devices that both take it in make one tag (`tagsOf` keeps the last line per id).
   - `label` `null`: it is NEO's own tag, named when shown.
   - `at` `null`: this moment.
   - `made`: `{ from: { app, kind, at, chapter?, model?, pasted?, since? } }`. `since: true` when the note names a chapter and `hash`, and the chapter as NEO holds it now doesn't hash to it (the chapter has changed since the note was made). A chapter that's gone: leave `chapter` in, no `since`.
   - `note`: the file's `text`.
3. Mark the file taken (`conflictTaken(bookId, 'notes', file)`) only once `rec.tag` returned a tag and its `saved` resolved true. Otherwise leave it for the next look.
4. Run `conflictsPresent(bookId, 'notes', found)` so marks for files someone tidied away are forgotten.
5. NEO never moves, rewrites or deletes the file. Say nothing as it's taken in: no toast, no dialog.

### Details that are easy to miss

- **Sealing.** `rec.tag` asks for a seal at once only when `label` is a string (`app.js:3197`). Make it also do so when `made.from` is there, so with Record and Timestamp the feedback is timestamped within minutes.
- **Naming.** In `tagName` (`app.js:7018`) and the exported page's `tagName` (`replay-page.js:723`): kind `feedback` → "Feedback · {app}", else "Note · {app}". The writer can rename it; then the label is theirs.
- **What the bar and the dialog say above the note:** who it is from "as given by {app}" (NEO doesn't vouch for it), the model when there is one, "pasted in by the writer" when `pasted`, the chapter's title when it's in the book, and when `since`, that the chapter had changed by the time NEO recorded it.
- **A note from outside can't be edited** in History, only renamed or removed. The file is the source.
- **Delete this book's history** leaves the files and the taken marks, so the notes aren't taken in again into the new history. Say that in the delete dialog's "what stays" only if it reads naturally; otherwise leave the dialog alone.
- **Duplicate** (`book:duplicate` in `main.js`, and `duplicateBook` in Pocket's bridge) copies the folder without `recording/`. Leave `history-notes/` out too, or the copy's new history takes in the original's notes.
- **Backups.** The daily zip may carry `history-notes/`; nothing to do.

## Part 3. Draft Sleuth: feedback from Claude

Draft Sleuth's README promises "No AI and no network" and "never writes NEO's files". Both stay true unless the writer turns this on, and the README must say exactly what changes.

### Rules

- **Off until asked for.** No key, no call. The first time, a dialog says what is sent (the chapter's text and the prompt, to Anthropic), that it uses the writer's own key and account, and that for a NEO book the feedback is left for NEO's Writing History. It needs a yes.
- **The key** is kept in Draft Sleuth's `userData`, encrypted with Electron's `safeStorage` when the system allows it, never in `settings.json` in the clear when it does, and never in the library or a sidecar. The window can set and clear it and ask whether there is one; it can never read it back.
- **The call is made in the main process** with `net.fetch`, as the Piper download is (`main.js:564`). The window's CSP is `default-src 'self'`; leave it.
- **Before writing the request, load the `claude-api` skill** and follow it for the endpoint, headers, model ids, streaming and errors. Don't write the request from memory. The model is a setting; default to `claude-opus-5-5` (changed from `claude-fable-5-2` on 2026-11-23, at effort `high`), and record the model id the response reports.
- **Nothing the model says is shown as HTML.** Plain text, or a small renderer for bullets and bold that escapes everything first.

### Two actions, two prompts

Keep the prompts in one new file, `lib/feedback.js`, each with a version string, with the functions that build the request and read the response. Pure functions, so `test/feedback.test.js` covers them with no network.

**Feedback** (recorded). System prompt, version `feedback-1`:

> You are an experienced fiction editor reading one chapter of a novel in progress. Give the writer your honest editorial response to this chapter as a reader would experience it.
>
> Cover, in this order: what works and why; what you would look at (tension and stakes, clarity and logic, character, pacing, point of view), each with the place in the text it comes from; and anything that confused you.
>
> Rules. Describe and question; do not rewrite. Do not supply replacement sentences, alternative passages or new plot events to use. Quote at most a few words to point at a place. Leave spelling, punctuation and grammar alone unless a slip changes the meaning. Do not offer to do more, and do not ask a question at the end. Plain text with short headings; no more than 500 words.

User message: the book's title, the chapter's title, then the chapter as plain text (paragraphs separated by blank lines, scene breaks as `***`).

**Proofread** (not recorded). System prompt, version `proofread-1`:

> You are proofreading one chapter of a novel. List slips only: spelling, punctuation, apostrophes, missing or doubled words, wrong word forms. Do not comment on style, structure or content, and do not rewrite sentences for taste.
>
> One slip per line, as: the words as they stand → the correction. Keep the writer's spelling convention (British or American) and their dialogue punctuation style. If you find nothing, say so in one line.

Showing these as a list is enough for now. Turning each into a highlight on the page is a later job.

### Recording it for NEO

New `lib/historynote.js`: builds the note of the contract above and the chapter hash; `test/historynote.test.js` checks the hash against a value worked out with NEO's `Rec.digest` on the same string, and the id, the lengths and the JSON.

- Only for a NEO library source. Add a `writeHistoryNote(bookId, note)` to `lib/library.js` and `lib/sources/neo.js`: make `history-notes/` if it's missing, write `.tmp`, rename. The existing `writeOwn` writes only in the book's folder itself and makes no folder. A Word document's source has no such method, and the window shows the feedback without recording it.
- Read the chapter file once, and use that same string for the hash and for the text sent, so the hash is of exactly what Claude saw.
- `text` in the note: the reply, a blank line, then a line naming the prompt version and the prompt's own text.
- Written once the reply is complete. A call that failed or was cancelled writes nothing.
- The dialog shows, before sending, the line "This feedback will be kept in NEO's Writing History", with a box to untick, remembered in settings. Proofreading never shows it and never writes.
- **Feedback from elsewhere:** a second way in, "Add feedback you got elsewhere…", where the writer pastes what they asked and what came back. Same file, `pasted: true`, no `model` unless they give one, and the hash of the chapter as it is now.

### Where it goes in the app

- IPC in `main.js` and `preload.js`, in the existing `lens:` style: set/clear/has key, ask for feedback, ask for a proofread, cancel, add pasted feedback.
- A **Feedback** menu (or items in File) in `main.js`'s menu, about line 866: Chapter Feedback…, Proofread Chapter…, Add Feedback You Got Elsewhere…, API Key…, Model.
- The reply shows in a panel or dialog in `renderer/app.js`, with a Copy button. Follow how the Natural Voices and Export dialogs are built there.
- Keep the last feedback for each chapter where annotations are kept (settings, with the backup that travels with the book), only if that is a small step; otherwise the writer reads it again in NEO's history.

### README

Rewrite the "No AI and no network" paragraph: still true by default; with an API key the writer adds, a chapter is sent to Anthropic only when they ask for feedback or a proofread. Add `history-notes/` to the list of the only files Draft Sleuth writes in a NEO book's folder, and say NEO reads them into Writing History.

## Tests

**NEO**

- `scripts/recording.test.js`: a tag line with a note → `stats.tags` and `tagsOf` carry it; a rename keeps it; a line without one has no `note` key in its stats.
- `scripts/recording-format.test.js` must pass untouched. If it fails, the change to stats is wrong, not the fixture.
- `scripts/replay-page.test.js`: `tagsIn` carries the note; the new words are listed.
- `scripts/history.e2e.js` (`npm run test:history`), beside the Tag This Moment… test at line 833: tag with a note, see the mark and the bar, edit the note, rename and find the note kept.
- `scripts/recording.e2e.js` or `sync-conflicts.e2e.js` style, for the intake: a file dropped in `history-notes/` becomes one tag, named "Feedback · Draft Sleuth", with its note; the file is byte-for-byte unchanged afterwards; a second look makes no second tag; a broken file and an oversized one are skipped; with recording off nothing is taken, and it is taken once recording is on.
- `npm run test:proof`: a note taken in with Record and Timestamp is sealed without waiting for the hour.
- `npm test`, `npm run lint`, `npm run test:export`.

**Draft Sleuth**

- `npm test` with the two new test files. No test reaches the network: the request builder and response reader are tested on fixed JSON.

## Conventions the user holds to in NEO

- Every new string goes through `t()`, then `node scripts/i18n.js template`, and is translated into **every** file in `locales/` in the same change. Check with `node scripts/i18n.js check <code>`.
- `docs/manual-tests.md` gains an entry for each new behaviour: the automated ones in its "what the tests check" list, and by-hand ones for the two-computer case (a note written on one computer is taken in on the other, once) and the phone (a noted tag reads right in Pocket).
- `AGENTS.md` is kept true: the tags bullet in Writing History (the note, `made.from`, the intake), the files-on-disk tree (`history-notes/`), and "When you change something" if a rule is added.
- After each commit to NEO, run `npm run package:win`; the user tests the portable exe.
- Work goes upstream as pull requests from the fork, not bundles, and no pull request is opened until the user asks.
- Commit only when the user asks.

## Not in this plan

- A `--tag` argument that reaches a running NEO. Considered, and held back until waiting for intake proves annoying.
- Placing an outside note on the exact past moment its chapter hash names. The hash is recorded so this can be done later.
- Notes in an export of chosen chapters. That needs the seals to cover tag lines, which is a seal-format change.
- A count of outside notes in How It Was Written….
- Proofreading slips as highlights on Draft Sleuth's page.
