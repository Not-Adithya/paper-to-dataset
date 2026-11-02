// Step 4: extracted pages -> { title, sections: [{ title, level, text }], debug }
// Pure functions. No DOM access.

const LIGATURES = { 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬀ': 'ff', 'ﬃ': 'ffi', 'ﬄ': 'ffl' };

const NUMBERED = /^\d+(?:\.\d+){0,3}\.?\s+\S/;
const KNOWN = /^(?:\d+(?:\.\d+)*\.?\s+)?(?:abstract|introduction|related work|background|preliminaries|method(?:s|ology)?|materials and methods|experiments?|results?(?: and discussion)?|discussions?|conclusions?|future work|limitations|acknowledg(?:e)?ments?|references|bibliography|appendix|ccs concepts|keywords|index terms)\b/i;
const CAPTION = /^(?:Table|Figure|Fig\.)\s*\d+\s*[:.]/;
const TABLE_TOKEN = /^(?:[-–—]|\d+(?:\.\d+)?%?|\[\d+\])$/;
const BULLET = /^[•●▪◦‣]/;
const KEEP_HYPHEN = new Set(['non', 'self', 'cross', 'semi', 'high', 'low', 'long', 'short', 'state', 'end', 'real']);

// ---------- small helpers ----------

function normalizeText(s) {
  return s
    .replace(/[ﬁﬂﬀﬃﬄ]/g, (c) => LIGATURES[c])
    .replace(/\u00AD/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Median font size, weighted by number of characters = the body text size
function weightedMedianFontSize(lines) {
  const weights = new Map();
  for (const l of lines) weights.set(l.fontSize, (weights.get(l.fontSize) || 0) + l.text.length);
  const sorted = [...weights.entries()].sort((a, b) => a[0] - b[0]);
  const total = sorted.reduce((n, [, w]) => n + w, 0);
  let acc = 0;
  for (const [size, w] of sorted) {
    acc += w;
    if (acc >= total / 2) return size;
  }
  return 10;
}

function repeatKey(text) {
  return text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
}

function findRepeatedKeys(lines, pageCount, cfg) {
  const pagesByKey = new Map();
  for (const l of lines) {
    if (l.text.length > cfg.maxHeaderChars) continue;
    const k = repeatKey(l.text);
    if (!pagesByKey.has(k)) pagesByKey.set(k, new Set());
    pagesByKey.get(k).add(l.pageIdx);
  }
  const minPages = Math.max(3, Math.ceil(pageCount * cfg.repeatPageFraction));
  const keys = new Set();
  for (const [k, pages] of pagesByKey) if (pages.size >= minPages) keys.add(k);
  return keys;
}

// Rows of numbers / dashes / [refs] = table data
function looksLikeTableRow(text) {
  const toks = text.split(' ');
  if (toks.length === 1) return TABLE_TOKEN.test(text);
  const hits = toks.filter((t) => TABLE_TOKEN.test(t)).length;
  return hits >= 2 && hits / toks.length >= 0.6;
}

// Short, capitalised, no-period lines right after a "Table N:" caption = column headers
function looksLikeTableHeader(text) {
  if (text.length > 110 || /[.!?]$/.test(text)) return false;
  const toks = text.split(' ');
  const titleish = toks.filter((t) => /^[A-Z(\[]/.test(t) || /[a-z][A-Z]/.test(t) || /\d/.test(t)).length;
  return titleish / toks.length >= 0.55;
}

function normalizeTitle(h) {
  return h.replace(/^\d+(?:\.\d+)*\.?\s*/, '').toLowerCase().replace(/[:.]+$/, '').trim();
}

function headingLevel(h) {
  const m = h.match(/^(\d+(?:\.\d+)*)/);
  return m ? m[1].split('.').length : 1;
}

function buildVocab(lines) {
  const set = new Set();
  for (const l of lines) {
    const words = l.text.toLowerCase().match(/[a-z]+(?:-[a-z]+)*/g);
    if (words) for (const w of words) set.add(w);
  }
  return set;
}

function mode(nums) {
  const counts = new Map();
  let best = null;
  let bestN = 0;
  for (const n of nums) {
    const c = (counts.get(n) || 0) + 1;
    counts.set(n, c);
    if (c > bestN) { best = n; bestN = c; }
  }
  return best;
}

// How far a line is indented from its column's left edge (used to spot paragraph starts)
function makeIndentFn(lines) {
  const byPage = new Map();
  for (const l of lines) {
    if (!byPage.has(l.page)) byPage.set(l.page, []);
    byPage.get(l.page).push(l);
  }
  const info = new Map();
  for (const [page, ls] of byPage) {
    const mid = ls[0].pageWidth / 2;
    info.set(page, {
      mid,
      left: mode(ls.filter((l) => l.x < mid).map((l) => l.x)),
      right: mode(ls.filter((l) => l.x >= mid).map((l) => l.x)),
    });
  }
  return (l) => {
    const i = info.get(l.page);
    if (!i) return 0;
    const base = l.x >= i.mid && i.right !== null ? i.right : i.left;
    return base === null ? 0 : l.x - base;
  };
}

// Join a line onto the text so far, fixing end-of-line hyphenation
function joinLines(text, next, vocab) {
  const m1 = text.match(/([A-Za-z]+)-$/);
  if (!m1) return text + ' ' + next;
  const m2 = next.match(/^([a-z]+)/);
  if (!m2) return text + next; // e.g. "Bag-of-" + "AudioWords": keep the hyphen, no space
  const left = m1[1].toLowerCase();
  const right = m2[1];
  const joined = left + right;
  const hyphenated = left + '-' + right;
  const keep =
    (vocab.has(hyphenated) && !vocab.has(joined)) ||
    (!vocab.has(joined) && !vocab.has(hyphenated) && KEEP_HYPHEN.has(left));
  return keep ? text + next : text.slice(0, -1) + next;
}

function assemble(lines, vocab, indentOf, cfg) {
  let text = '';
  let prev = null;
  for (const l of lines) {
    if (!prev) {
      text = l.text;
    } else {
      const ind = indentOf(l);
      const newPara =
        BULLET.test(l.text) ||
        (ind >= cfg.indentMin && ind <= cfg.indentMax && /[.!?:]["”’)\]]?$/.test(prev.text));
      text = newPara ? text + '\n\n' + l.text : joinLines(text, l.text, vocab);
    }
    prev = l;
  }
  return text.trim();
}

// ---------- main ----------

export function cleanAndSection(extracted, cfg) {
  // 1. Flatten pages into normalized lines
  const all = [];
  extracted.pages.forEach((p, pi) => {
    for (const l of p.lines) {
      const text = normalizeText(l.text);
      if (text) {
        all.push({ text, fontSize: l.fontSize, x: l.x, page: p.pageNumber, pageIdx: pi, pageWidth: p.width });
      }
    }
  });
  const firstPage = extracted.pages[0] ? extracted.pages[0].pageNumber : 1;
  const body = weightedMedianFontSize(all);
  const headingMin = body * cfg.headingRatio;
  const titleMin = body * cfg.titleRatio;
  const repeated = findRepeatedKeys(all, extracted.pages.length, cfg);

  // 2. Drop junk lines (and remember what was dropped)
  const stats = { repeated: 0, smallFont: 0, captions: 0, tableRows: 0, tableHeaders: 0 };
  const samples = { repeated: [], smallFont: [], captions: [], tableRows: [], tableHeaders: [] };
  const drop = (kind, text) => {
    stats[kind]++;
    if (samples[kind].length < 6 && !samples[kind].includes(text)) samples[kind].push(text);
  };

  const kept = [];
  let tableZone = 0;
  for (const l of all) {
    if (repeated.has(repeatKey(l.text))) { drop('repeated', l.text); continue; }
    if (l.fontSize < body * cfg.smallFontRatio) { drop('smallFont', l.text); continue; }
    if (CAPTION.test(l.text)) {
      drop('captions', l.text);
      tableZone = l.text.startsWith('Table') ? cfg.tableZoneLines : 0;
      continue;
    }
    if (looksLikeTableRow(l.text)) { drop('tableRows', l.text); continue; }
    if (tableZone > 0) {
      if (l.fontSize >= headingMin) tableZone = 0;
      else if (looksLikeTableHeader(l.text)) { tableZone--; drop('tableHeaders', l.text); continue; }
      else tableZone = 0;
    }
    kept.push(l);
  }

  const vocab = buildVocab(kept);
  const indentOf = makeIndentFn(kept);

  // 3. Walk the lines: find title, split into sections
  const titleLines = [];
  const sections = [];
  let current = { heading: null, lines: [] }; // heading null = front matter (authors etc.)
  let seenReal = false;
  let stoppedAt = null;

  for (const l of kept) {
    const big = l.fontSize >= headingMin;
    const numbered = NUMBERED.test(l.text);
    const known = KNOWN.test(l.text);

    // Title: very large text on page 1, before any section
    if (!seenReal && l.page === firstPage && l.fontSize >= titleMin) {
      titleLines.push(l.text);
      continue;
    }

    // Second line of a wrapped heading
    if (big && current.heading !== null && current.lines.length === 0 &&
        !numbered && !known && l.text.length <= cfg.maxHeadingChars) {
      current.heading += ' ' + l.text;
      continue;
    }

    const isHeading =
      big && l.text.length <= cfg.maxHeadingChars &&
      (numbered || known || (seenReal && !/[.!?:]$/.test(l.text)));

    if (isHeading) {
      sections.push(current);
      if (cfg.stopSections.includes(normalizeTitle(l.text))) {
        stoppedAt = l.text;
        current = null;
        break;
      }
      current = { heading: l.text, lines: [] };
      seenReal = true;
      continue;
    }
    current.lines.push(l);
  }
  if (current) sections.push(current);

  // 4. Build the output sections
  const out = [];
  const droppedSections = [];
  for (const s of sections) {
    if (s.heading === null) continue; // front matter
    const text = assemble(s.lines, vocab, indentOf, cfg);
    if (cfg.dropSections.includes(normalizeTitle(s.heading))) { droppedSections.push(s.heading); continue; }
    if (text.length < cfg.minSectionChars) { droppedSections.push(`${s.heading} (too short)`); continue; }
    out.push({ title: s.heading, level: headingLevel(s.heading), text });
  }

  return {
    paperId: extracted.paperId,
    source: extracted.source,
    title: titleLines.join(' ') || null,
    sections: out,
    debug: {
      bodyFontSize: body,
      headingMin,
      linesIn: all.length,
      linesKept: kept.length,
      stats,
      samples,
      droppedSections,
      stoppedAt,
    },
  };
}
