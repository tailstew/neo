# Issues to fix

Found by the end-to-end tests (`npm run test:history`, 2026-11-12), most serious first. Take an issue off this list once its fix is in and its test passes.

## 6. Other dialogs may let Tab out the same way History did

- **What happens:** History now keeps Tab inside itself (fixed 2026-11-12: keys could reach the manuscript behind it). NEO has no shared focus trap, so the evidence report, the confirmations, the snapshot view and the other modals may let Tab reach the book behind them. Not checked yet.
- **Fix:** one shared trap that every modal uses, and a test that walks Tab through each dialog.

## 7. Small things

- `npm run lint` already reports 5 errors in `app.js`, at lines 9433, 11524, 17788, 17791 and 19427: an unused loop condition, a `let` that should be `const`, and unnecessary escapes.
- Upstream issue hughhowey/neo#479: the portable exe's updater installs NEO when you quit.

## Done

- 2026-11-12: **Restoring a paragraph can overwrite a different one.** A paragraph replaced by one with few of its words leaves the part in doubt (`Rec.partDoubt`, in `partDays`, `partStep` and `trackToNow`), and restore looks for it by its words first. The test "…is found by its words, and restored in its new place" passes.
- 2026-11-12: **Short paragraphs can't be found by their words.** A paragraph of one or two words is compared by its words (`wordsOf`, `wordsLike` in `recording.js`), needing two in three alike. Tests in `scripts/recording-restore.test.js`.
- 2026-11-12: **Chapters not edited yet don't appear on History's earlier days.** A chapter this device never recorded gets its `baseline` with the session's first line, all at one moment (`rec.unseen`, `baseUnseen` in app.js); opening a book alone still records nothing. Tests: Nine, never edited, listed on day one (`npm run test:history`); the imported book's second chapter (`npm run test:recording`).
- 2026-11-12: **The paragraph buttons never show in words on a 1920-pixel screen.** They step down as the margin narrows: side by side, the left pair stacked, short words (‹ Older, Restore, Newer ›, translated), ‹ ›, ↺ (`renderPart`, `.hs-part-stack`). At 1904 px: short words, stacked. Test in "a paragraph picked: the buttons beside it…".
- 2026-11-12: **Wrong wording for a deleted chapter.** Played past its going, a chapter says "This chapter isn't in the book at this moment." (`absentSays` in WRITING HISTORY, app.js; the exported page's line, already translated). Test in "a chapter picked at a moment it isn't there…".
