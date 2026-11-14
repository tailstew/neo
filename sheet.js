// How a chapter's sheet is set: its kind (a chapter, a dedication, a part…),
// the classes its sheet and its text take, and the marks for the screen only
// that its text takes from its words (the opening paragraph with the drop
// cap, a dedication's attribution). NEO's editor and History's player
// (app.js) and the exported page (replay-page.js, which replay-export.js
// inlines this into) all take a sheet from here, so a page is set the same
// in each; history.e2e.js compares them, a page of every kind. Plain DOM, no
// NEO globals: a function's book is the meta handed in. window.NeoSheet, or
// require()d.

(function (root) {
  'use strict';

  const CHAPTER_KINDS = ['copyright', 'dedication', 'epigraph', 'contents', 'prologue', 'part', 'chapter', 'unnumbered', 'epilogue', 'acknowledgments', 'about'];

  const STORY_KINDS = ['chapter', 'unnumbered', 'prologue', 'epilogue'];

  function chapterKind(chId, meta) {
    const k = meta && meta.chapterKinds && meta.chapterKinds[chId];
    if (k && CHAPTER_KINDS.includes(k)) return k;
    // NEO 1.0 kept a prologue and an epilogue as roles of the first and last
    // chapters (a book not opened since reads that way until it is)
    const order = (meta && meta.chapterOrder) || [];
    if (order.length >= 2) {
      if (meta.prologue === chId && order[0] === chId) return 'prologue';
      if (meta.epilogue === chId && order[order.length - 1] === chId) return 'epilogue';
    }
    return 'chapter';
  }

  const isStory = (chId, meta) => STORY_KINDS.includes(chapterKind(chId, meta));

  // a prologue or an epilogue: story that stands outside the numbering
  function chapterRole(chId, meta) {
    const k = chapterKind(chId, meta);
    return k === 'prologue' || k === 'epilogue' ? k : null;
  }

  // A story of one chapter is just "the story": no heading, no number, until a
  // second chapter (or a prologue, an epilogue or a part) joins it. The pages
  // around it don't count.
  function soloStory(meta) {
    const story = meta.chapterOrder.filter((c) => isStory(c, meta) || chapterKind(c, meta) === 'part');
    return story.length === 1 && chapterKind(story[0], meta) === 'chapter' ? story[0] : null;
  }

  // the lines of a page that say who said the lines above them (a dash first)
  const ATTRIBUTED_PAGES = ['dedication', 'epigraph', 'part'];

  // a line that opens with a dash says who said the lines above it
  const isAttribution = (p) => /^(?:[—–]|--?\s)/.test(p.text || '');

  // A chapter that opens on a line of dialogue sets no drop cap: the dash
  // itself would be the letter enlarged. That line, and one that follows a
  // scene break, keep their indent where prose is set flush, so the speech
  // lines up with the lines that answer it. The marks are never saved.
  const OPENING_DASH = /^\s*[-‐‑‒–—―]/;

  // A chapter's opening paragraph — the one with the drop cap and no indent —
  // is its first paragraph with words in it, past a blank line or a *** at the
  // top (the exports skip those too). Poetry stands apart. In an empty
  // chapter it's the paragraph waiting for the first word. Marked data-first,
  // for the screen only.
  function openingPara(body) {
    const ps = [...body.children].filter((p) => p.tagName === 'P' && !p.classList.contains('poetry') && !p.classList.contains('scene-break') && !p.classList.contains('ghost'));
    return ps.find((p) => p.textContent.trim() !== '') || ps[0] || null;
  }

  function markDialogueOpening(body) {
    const first = openingPara(body);
    for (const p of body.querySelectorAll('p[data-first]')) if (p !== first) p.removeAttribute('data-first');
    if (first && !first.hasAttribute('data-first')) first.setAttribute('data-first', '');
    body.classList.toggle('opens-dialogue', !!first && OPENING_DASH.test(first.textContent));
    for (const p of body.querySelectorAll('p[data-speech]')) if (!p.matches('.scene-break + p')) p.removeAttribute('data-speech');
    for (const p of body.querySelectorAll('p.scene-break + p')) {
      const speech = OPENING_DASH.test(p.textContent);
      if (p.hasAttribute('data-speech') !== speech) p.toggleAttribute('data-speech', speech);
    }
  }

  // How a chapter's sheet and its text are set (above). meta is the book
  // (History's may be one that isn't open), order the chapters at the moment
  // shown, which say whether a chapter is the book's only one.
  function sheetLook(chId, meta, { script = meta.format === 'screenplay', narrow = false, order = meta.chapterOrder } = {}) {
    const kind = chapterKind(chId, meta);
    const story = STORY_KINDS.includes(kind);
    const sec = ['sheet', 'kind-' + kind];
    if (chId === soloStory({ ...meta, chapterOrder: order })) sec.push('solo');
    if (!story) sec.push('bookpage');
    const role = chapterRole(chId, meta);
    if (role) sec.push(role);
    // a page that isn't story has no drop cap; a script's lines are set as
    // they print (styles.css, SCREENPLAYS)
    const body = [];
    if (!story || script) body.push('no-cap');
    if (script) body.push('script-body', narrow ? 'sp-narrow' : 'sp-geom');
    return { kind, sec, body };
  }

  // the marks for the screen only that a sheet's text takes from its words:
  // the opening paragraph, and on a dedication, an epigraph or a part, a line
  // that opens with a dash set as the name of whoever said the lines above it
  function markSheet(body, kind) {
    markDialogueOpening(body);
    if (!ATTRIBUTED_PAGES.includes(kind)) return;
    for (const p of body.querySelectorAll('p')) {
      const attr = isAttribution({ text: p.textContent.trim() });
      if (p.hasAttribute('data-attr') !== attr) p.toggleAttribute('data-attr', attr);
    }
  }

  const api = { CHAPTER_KINDS, STORY_KINDS, ATTRIBUTED_PAGES, OPENING_DASH, chapterKind, isStory, chapterRole, soloStory, isAttribution, openingPara, markDialogueOpening, sheetLook, markSheet };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NeoSheet = api;
})(typeof self !== 'undefined' ? self : this);
