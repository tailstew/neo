// How a chapter's sheet is set: its kind (a chapter, a dedication, a part…),
// the classes its sheet and its text take, and the marks for the screen only
// that its text takes from its words (the opening paragraph and the drop
// cap drawn beside it, a dedication's attribution). NEO's editor and History's player
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
    // the engine, joining or emptying paragraphs, writes the indent a paragraph
    // had at that moment onto it for good (the opening one's most of all). The
    // indent is the stylesheet's to give; an alignment the writer chose stays.
    for (const p of body.querySelectorAll(':scope > p[style*="text-indent"]')) {
      p.style.removeProperty('text-indent');
      if (!p.getAttribute('style')) p.removeAttribute('style');
    }
    const first = openingPara(body);
    for (const p of body.querySelectorAll('p[data-first]')) if (p !== first) p.removeAttribute('data-first');
    if (first && !first.hasAttribute('data-first')) first.setAttribute('data-first', '');
    body.classList.toggle('opens-dialogue', !!first && OPENING_DASH.test(first.textContent));
    for (const p of body.querySelectorAll('p[data-speech]')) if (!p.matches('.scene-break + p')) p.removeAttribute('data-speech');
    for (const p of body.querySelectorAll('p.scene-break + p')) {
      const speech = OPENING_DASH.test(p.textContent);
      if (p.hasAttribute('data-speech') !== speech) p.toggleAttribute('data-speech', speech);
    }
    setDropCap(body, first);
  }

  // THE DROP CAP is a letter drawn beside the opening paragraph (that
  // paragraph's ::before, its letter and width handed over in --cap and --cap-w
  // on the sheet's text, which is never saved). It is not a ::first-letter:
  // that makes the engine split the paragraph's text in two behind the scenes,
  // and typing or deleting beside the split left doubled letters on the page,
  // so for a long time the cap had to step aside whenever the caret was in its
  // paragraph. Now the words are one plain run of text to edit. The real first
  // letter is still there, unseen (the neo-cap highlight paints it clear) and
  // drawn back under the cap by its own width, so the line starts where it
  // always did. The editor, History's player and the exported page all draw
  // it here, so a cap sits the same in each.
  const HAS_DOM = typeof document !== 'undefined';
  const capHidden = HAS_DOM && typeof Highlight !== 'undefined' && typeof CSS !== 'undefined' && CSS.highlights ? new Highlight() : null;
  if (capHidden) {
    capHidden.priority = 50; // over the focus, search and spelling highlights: none of them may ink it in
    CSS.highlights.set('neo-cap', capHidden);
  }
  const capState = new WeakMap(); // sheet's text → { range, cap, sig }
  const capWidths = new Map(); // what a letter measures, in em, when its sheet isn't laid out
  const CAP_LEAD = /^[\p{Ps}\p{Pi}\p{Pf}\p{Pe}\p{Po}]*/u; // an opening quote or ¿ is set with its letter
  const capSegmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  // what takes no room in the words (app.js's UNCOUNTED)
  const CAP_SKIP = '.darling-anchor, .ph-mark, .ghost, .fn';

  // The letter (with any mark that opens it) a paragraph's text begins with;
  // '' when it begins with a space or with nothing a cap can be made of
  function capOf(text) {
    const lead = CAP_LEAD.exec(text)[0];
    const rest = text.slice(lead.length);
    if (!rest) return '';
    const g = capSegmenter ? capSegmenter.segment(rest)[Symbol.iterator]().next().value.segment : String.fromCodePoint(rest.codePointAt(0));
    return /[\p{L}\p{N}]/u.test(g) ? lead + g : '';
  }

  // Where the paragraph's words begin: its first text nodes, in order. A flag
  // or a footnote number standing before the first word means no cap.
  function capOpening(p) {
    const nodes = [];
    let text = '';
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeType === Node.ELEMENT_NODE && n.matches(CAP_SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
    });
    // (a rejected element's subtree is skipped; one that takes up room ends the search)
    for (let n = p.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === Node.ELEMENT_NODE && n.matches('.ph-mark, .fn')) return null;
      if (n.nodeType !== Node.ELEMENT_NODE || !n.matches(CAP_SKIP)) break;
    }
    let n;
    while (text.length < 16 && (n = walker.nextNode())) {
      // a line break before the first word: the letter isn't on the first line to be tucked away
      if (n.nodeName === 'BR' && !text) return null;
      if (n.nodeType !== Node.TEXT_NODE || !n.data) continue;
      nodes.push(n);
      text += n.data;
    }
    return nodes.length ? { nodes, text } : null;
  }

  function clearDropCap(body) {
    const st = capState.get(body);
    if (!st) return;
    if (capHidden) capHidden.delete(st.range);
    capState.delete(body);
    body.classList.remove('has-cap');
    body.style.removeProperty('--cap');
    body.style.removeProperty('--cap-w');
    if (!body.getAttribute('style')) body.removeAttribute('style');
  }

  // `remeasure`: the type changed (a font chosen, or one that just arrived)
  function setDropCap(body, first, remeasure = false) {
    const open = capHidden && first && !body.classList.contains('no-cap') && !body.classList.contains('opens-dialogue') &&
      !document.body.classList.contains('no-dropcap') && capOpening(first);
    const cap = open ? capOf(open.text) : '';
    if (!cap) { clearDropCap(body); return; }
    // the cap's own letters, from the paragraph's first character on
    let left = cap.length;
    let end = open.nodes[0];
    let endAt = 0;
    for (const n of open.nodes) {
      end = n;
      endAt = Math.min(left, n.data.length);
      left -= endAt;
      if (!left) break;
    }
    // how the letter is set where it stands (in an italic, say) decides its width
    // (and the letter after it: a pair like "To" is set closer than "Th")
    let sig = cap + '~' + open.text.slice(cap.length, cap.length + 2);
    for (const n of open.nodes) {
      // (the engine's own spans carry their weight and slant in a style)
      for (let el = n.parentElement; el && el !== first; el = el.parentElement) sig += '>' + el.tagName + (el.getAttribute('style') || '');
      if (n === end) break;
      sig += '|';
    }
    let st = capState.get(body);
    if (!st) {
      st = { range: document.createRange(), cap: '', sig: '' };
      capState.set(body, st);
      if (capHidden.size > 400) for (const r of [...capHidden]) if (!r.startContainer.isConnected) capHidden.delete(r); // sheets since redrawn
    }
    const r = st.range;
    if (r.startContainer !== open.nodes[0] || r.startOffset !== 0 || r.endContainer !== end || r.endOffset !== endAt) {
      r.setStart(open.nodes[0], 0);
      r.setEnd(end, endAt);
    }
    if (!capHidden.has(r)) capHidden.add(r);
    if (st.cap !== cap) body.style.setProperty('--cap', JSON.stringify(cap));
    if (!body.classList.contains('has-cap')) body.classList.add('has-cap');
    if (st.sig !== sig || remeasure) {
      const host = open.nodes[0].parentElement;
      const cs = getComputedStyle(host);
      const size = parseFloat(cs.fontSize) || 17;
      // as laid out on the page; from the font's own figures while the sheet isn't on screen
      let w = r.getBoundingClientRect().width / size;
      if (!w) {
        const font = `${cs.fontStyle} ${cs.fontWeight} ${size}px ${cs.fontFamily}`;
        const key = font + '|' + cap;
        if (remeasure || !capWidths.has(key)) {
          const ctx = (setDropCap.canvas || (setDropCap.canvas = document.createElement('canvas'))).getContext('2d');
          ctx.font = font;
          capWidths.set(key, ctx.measureText(cap).width / size);
        }
        w = capWidths.get(key);
        sig = ''; // measured for real the next time it's looked at
      }
      body.style.setProperty('--cap-w', w.toFixed(4) + 'em');
    }
    st.cap = cap;
    st.sig = sig;
    queueCapCheck(body);
  }

  // The letter's width also turns on things no key above can name: whether the
  // engine has just joined two runs of text, so that "AT" is now set as a pair.
  // So once the page has settled after an edit the width is read again, as laid
  // out, and put right if it's off (a pixel, when it is).
  const capChecks = new Set();
  let capCheckFrame = 0;
  function queueCapCheck(body) {
    capChecks.add(body);
    if (capCheckFrame) return;
    capCheckFrame = requestAnimationFrame(() => {
      capCheckFrame = 0;
      const bodies = [...capChecks];
      capChecks.clear();
      const found = [];
      for (const body of bodies) {
        const st = capState.get(body);
        if (!st || !body.isConnected || !st.range.startContainer.isConnected) continue;
        const w = st.range.getBoundingClientRect().width;
        const size = w && parseFloat(getComputedStyle(st.range.startContainer.parentElement).fontSize);
        if (w && size) found.push([body, (w / size).toFixed(4) + 'em']);
      }
      for (const [body, em] of found) if (body.style.getPropertyValue('--cap-w') !== em) body.style.setProperty('--cap-w', em);
    });
  }

  // every sheet's cap, looked at again (the cap turned on or off, a new font)
  function refreshDropCaps(remeasure = false) {
    for (const body of document.querySelectorAll(':is(.chapter-body, .rp-body)')) {
      const first = body.querySelector(':scope > p[data-first]');
      if (first) setDropCap(body, first, remeasure); else clearDropCap(body);
    }
  }
  if (HAS_DOM && document.fonts) document.fonts.addEventListener('loadingdone', () => refreshDropCaps(true));

  // the range of the letter hidden under a sheet's cap, or null (app.js: focus mode's selection)
  const capRange = (body) => (capState.get(body) || {}).range || null;

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

  const api = { CHAPTER_KINDS, STORY_KINDS, ATTRIBUTED_PAGES, OPENING_DASH, chapterKind, isStory, chapterRole, soloStory, isAttribution, openingPara, markDialogueOpening, setDropCap, clearDropCap, refreshDropCaps, capRange, sheetLook, markSheet };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NeoSheet = api;
})(typeof self !== 'undefined' ? self : this);
