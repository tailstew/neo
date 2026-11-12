# Issues to fix

Found by the end-to-end tests (`npm run test:history`, 2026-11-12), most serious first. Take an issue off this list once its fix is in and its test passes.

## 1. Restoring a paragraph can overwrite a different one

The words written over are recoverable (⌘Z, and the "Before restoring to …" tag), but nothing warns the writer.

- **What happens:** a paragraph is cut from the end of its chapter and pasted at the top. Later that day, a new paragraph is added at the end. A History restore of the old paragraph then replaces the new end paragraph instead.
- **Cause:** History carries a paragraph across days by comparing each day's end with the next (`Rec.partDays` in `recording.js`). That comparison can't see a move, so it takes the replaced paragraph for the one picked. Within a day, one change that moves a paragraph both ways (an Outline move in a chapter) does the same, in `partThrough`.
- **Fix:** where a paragraph is replaced by one with few words in common (`likeness`), treat it as gone, so the search by words (`findParagraphs`) finds where it went.
- **Test:** "a paragraph edited and moved within its chapter since is found by its words, and restored in its new place" (`npm run test:history`), failing now. Item 93 in `docs/manual-tests.md`.

## 2. Short paragraphs can't be found by their words

- **What happens:** the search behind restore (`findParagraphs`, `shingles` in `recording.js`) matches runs of three words. A paragraph of one or two words has none, so a dialogue line ("Yes.") or a short heading is never found once it moves, and History says it "can't find them anywhere else."
- **Fix:** for very short paragraphs, compare the exact text.

## 3. Chapters not edited yet don't appear on History's earlier days

- **What happens:** a chapter enters the history at its first edit (its `b` line). On earlier days it's missing from History's side pane and whole-book sheet, though it was in the book. If such a chapter is then deleted or joined, History never shows it before that day.
- **Fix:** when a book starts recording, give every chapter its starting record (a `baseline`), not only those being changed.

## 4. The paragraph buttons never show in words on a 1920-pixel screen

- **What happens:** at 1904 px wide the sheet leaves 170 px margins. "‹ Earlier version" and "Restore This Paragraph" need more room (`renderPart` in app.js), so they always show as ‹ and ›. The words are only in the tooltips.
- **Fix:** stack the left-hand pair, shorten the labels, or accept the short form and update item 66 in `docs/manual-tests.md`.

## 5. Wrong wording for a deleted chapter

- **What happens:** a deleted chapter, played past its delete, says "This chapter doesn't exist yet at this moment." "Yet" is wrong for a chapter that has gone.
- **Fix:** a line such as "This chapter isn't in the book at this moment." for that case (`draw()` in WRITING HISTORY, app.js), translated into every locale.

## 6. Other dialogs may let Tab out the same way History did

- **What happens:** History now keeps Tab inside itself (fixed 2026-11-12: keys could reach the manuscript behind it). NEO has no shared focus trap, so the evidence report, the confirmations, the snapshot view and the other modals may let Tab reach the book behind them. Not checked yet.
- **Fix:** one shared trap that every modal uses, and a test that walks Tab through each dialog.

## 7. Small things

- `npm run lint` already reports 5 errors in `app.js`, at lines 9433, 11524, 17788, 17791 and 19427: an unused loop condition, a `let` that should be `const`, and unnecessary escapes.
- Upstream issue hughhowey/neo#479: the portable exe's updater installs NEO when you quit.
