// Step 4: extracted pages -> { title, sections: [{ title, level, text }], debug }
// Pure functions. No DOM access.

const LIGATURES = { 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬀ': 'ff', 'ﬃ': 'ffi', 'ﬄ': 'ffl' };

const NUMBERED = /^\d+(?:\.\d+){0,3}\.?\s+\S/;
const KNOWN = /^(?:\d+(?:\.\d+)*\.?\s+)?(?:abstract|introduction|related work|background|preliminaries|method(?:s|ology)?|materials and methods|experiments?|results?(?: and discussion)?|discussions?|conclusions?|future work|limitations|acknowledg(?:e)?ments?|references|bibliography|appendix|ccs concepts|keywords|index terms)\b/i;
const CAPTION = /^(?:Table|Figure|Fig\.)\s*\d+\s*[:.]/;
const TABLE_TOKEN = /^(?:[-–—]|\d+(?:\.\d+)?%?|\[\d+\])$/;
const BULLET = /^[•●▪◦‣]/;
const HEADING_BULLET = /^[■●▪◦•▶►]\s*/;
const KEEP_HYPHEN = new Set(['non', 'self', 'cross', 'semi', 'high', 'low', 'long', 'short', 'state', 'end', 'real']);

// patterns used only by the loose heading detector
const ROMAN = /^[IVX]{1,5}\.\s+\S/;
const CHAPTER = /^(?:chapter|appendix)\s+(?:\d+|[IVX]+|[A-Z])\b/i;
const LEADERS = /\.{4,}|(?:\.\s){4,}/;
const SMALL_WORDS = new Set(['of', 'the', 'and', 'for', 'in', 'on', 'to', 'a', 'an', 'with', 'by', 'or', 'at', 'from', 'vs', 'via', 'as', 'is', 'are']);

// equation / garbage detection
const MATH_GLYPHS = /[\u239B-\u23BD\u0305\u2211\u220F\u222B]/;          // bracket pieces, overline, sum, product, integral
const HEADING_BAD = /[{}\[\]÷=\u2211\u221A\u222B\u221E\u239B-\u23BD\u0305]|\(\d+\)$/;

// text that is not part of the paper body
const BACK_MATTER = new RegExp(
  '(?:^|[\\s.])(?:Author Contributions?|Authors\\u2019? Contributions?|Funding|Institutional Review Board Statement|' +
  'Informed Consent Statement|Data Availability(?: Statement)?|Conflicts? of Interest|' +
  'Declarations? of (?:Competing|competing) (?:Interests?|interests?)|Declaration of Interest|' +
  'CRediT authorship contribution statement|Ethics Statement|Acknowledg(?:e)?ments?|' +
  'Supplementary Materials?|Disclosure Statement)\\s*:'
);
const REFS_INLINE = /\s(?:References|REFERENCES)\s+(?:\[?1\]?\.?\s+)[A-Z]/;

// journal furniture that gets glued into body text
const SCRUBS = [
  /\b(?:Received|Revised|Accepted|Published|Available online)\s*:\s*\d{1,2}\s+[A-Z][a-z]+\s+\d{4}/g,
  /\b[A-Z][A-Za-z.&]+(?:\s[A-Z][A-Za-z.&]+){0,3}\s+(?:19|20)\d{2},\s*\d{1,3},\s*\d{1,6}(?:\s+\d{1,3}\s+of\s+\d{1,3})?/g,
  /\bCopyright\s*:\s*©[^.]*\.(?:\s*Licensee[^.]*\.)?/g,
  /\bCitation:\s+(?:[A-Z][\p{L}'’-]+,\s+(?:[A-Z]\.-?\s?)+;?\s*){1,12}/gu,
];

// ---------- small helpers ----------

function normalizeText(s) {
  return s
    .replace(/[ﬁﬂﬀﬃﬄ]/g, (c) => LIGATURES[c])
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, ' ')
    .replace(/\u00AD/g, '')
    .replace(/\uFFFD/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

const letterRatio = (t) => ((t.match(/[A-Za-z]/g) || []).length) / Math.max(1, t.length);

// equation fragments and symbol soup
function looksLikeMath(text) {
  if (MATH_GLYPHS.test(text)) return true;
  if (/^\(?\d{1,3}\)?$/.test(text) || /^\(\d{1,3}\)$/.test(text)) return true;      // bare equation numbers: "(2)"
  if (NUMBERED.test(text)) return false;
  if (/[{}÷=]/.test(text) && letterRatio(text) < 0.6) return true;                    // "t3[tL1÷tL2] arg{ max ... }, (1)"
  return text.length >= 4 && letterRatio(text) < 0.4;
}

function headingOk(text) {
  if (HEADING_BAD.test(text)) return false;
  const core = text.replace(/^\d+(?:\.\d+)*\.?\s*/, '');
  return core.length >= 2 && letterRatio(core) >= 0.55;
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
  if (!m2) return text + ' ' + next; // capital after a dangling hyphen = a break, not a split word
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

// Remove journal furniture glued into the text (dates, running headers, copyright, citation box)
export function scrubInline(text) {
  let t = text;
  for (const re of SCRUBS) t = t.replace(re, ' ');
  return t.replace(/[ \t]{2,}/g, ' ').replace(/ ?\n\n ?/g, '\n\n').trim();
}

// Cut author contributions / funding / declarations / reference list that run on after the last heading
export function cutBackMatter(text) {
  let cutAt = -1;
  const a = BACK_MATTER.exec(text);
  if (a) cutAt = a.index;
  const b = REFS_INLINE.exec(text);
  if (b && (cutAt === -1 || b.index < cutAt)) cutAt = b.index;
  return cutAt === -1 ? { text, cut: false } : { text: text.slice(0, cutAt).trim(), cut: true };
}

// ---------- title ----------

function validMetaTitle(t) {
  if (!t) return false;
  const s = String(t).trim();
  if (s.length < 15 || s.length > 250) return false;
  if (s.split(/\s+/).length < 3) return false;
  if (/\.(pdf|docx?|tex|indd)\b|microsoft|untitled|^\s*(?:paper|manuscript|document|article)\b/i.test(s)) return false;
  return true;
}

export function cleanTitle(t) {
  if (!t) return null;
  let s = String(t).replace(/\s+/g, ' ').trim();
  s = s.replace(/(\w)-\s+(?=[A-Za-z])/g, '$1-');                     // "Wide- Temperature"
  s = s.replace(/^(?:OPEN|materials|sensors|measurement)\s+(?=[A-Z])/i, '');   // journal name stuck in front
  s = s.replace(/([a-z]{3,})[A-Z*†‡]$/, '$1');                      // trailing footnote marker
  return s.trim() || null;
}

// ---------- loose heading detection (for papers/theses where headings are body-sized) ----------

// Median vertical distance between consecutive lines on the same page = normal line spacing
function medianLineGap(lines) {
  const gaps = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].page !== lines[i - 1].page) continue;
    const g = lines[i - 1].y - lines[i].y;
    if (g > 0 && g < 60) gaps.push(g);
  }
  gaps.sort((a, b) => a - b);
  return gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
}

function looseHeading(text, gap, medianGap, cfg) {
  if (text.length < 3 || text.length > cfg.maxHeadingChars) return false;
  if (LEADERS.test(text) || /[.,;:!?]$/.test(text)) return false;
  const letters = text.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3) return false;
  const words = text.split(' ');
  if (words.length > 12) return false;

  const spaced = gap >= medianGap * 1.5;

  if (CHAPTER.test(text) || ROMAN.test(text)) return true;
  if (KNOWN.test(text) && words.length <= 6) return true;
  if (/^\d+\.\d+(?:\.\d+)*\.?\s+[A-Z]/.test(text)) return true;   // "2.3 Ultrasonic Testing"
  if (/^\d+\.?\s+[A-Z]/.test(text)) return spaced;                 // "2 Methods"

  const upper = letters.replace(/[^A-Z]/g, '').length;
  if (upper / letters.length >= 0.9 && letters.length >= 5) return spaced || gap === 0;

  if (!spaced || words.length > 10) return false;
  const content = words.filter((w) => !SMALL_WORDS.has(w.toLowerCase()));
  if (!content.length) return false;
  const capped = content.filter((w) => /^[A-Z]/.test(w)).length;
  return capped / content.length >= 0.7;
}

const proseCount = (t) => (t.match(/[a-z]{2,}[.!?]["”’)\]]?(?:\s|$)/g) || []).length;

// Walk the kept lines: find the title and split the rest into sections
function walk(kept, ctx, loose) {
  const { headingMin, titleMin, firstPage, cfg, medianGap } = ctx;
  const titleLines = [];
  const sections = [];
  let current = { heading: null, lines: [] }; // heading null = front matter
  let seenReal = false;
  let stoppedAt = null;

  for (const l of kept) {
    const txt = l.text.replace(HEADING_BULLET, '');
    const big = l.fontSize >= headingMin;
    const numbered = NUMBERED.test(txt);
    const known = KNOWN.test(txt);
    const ok = headingOk(txt);

    // Title: very large text on page 1, before any section
    if (!seenReal && l.page === firstPage && l.fontSize >= titleMin) {
      titleLines.push(l.text);
      continue;
    }

    // Second line of a wrapped heading
    if (big && ok && current.heading !== null && current.lines.length === 0 &&
        !numbered && !known && txt.length <= cfg.maxHeadingChars) {
      current.heading += ' ' + txt;
      continue;
    }

    const strictHeading =
      big && ok && txt.length <= cfg.maxHeadingChars &&
      (numbered || known || (seenReal && !/[.!?:]$/.test(txt)));
    const isHeading = strictHeading || (loose && ok && looseHeading(txt, l.gap, medianGap, cfg));

    if (isHeading) {
      sections.push(current);
      if (cfg.stopSections.includes(normalizeTitle(txt))) {
        stoppedAt = txt;
        current = null;
        break;
      }
      current = { heading: txt, lines: [] };
      seenReal = true;
      continue;
    }
    current.lines.push(l);
  }
  if (current) sections.push(current);
  return { titleLines, sections, stoppedAt };
}

// ---------- main ----------

export function cleanAndSection(extracted, cfg) {
  // 1. Flatten pages into normalized lines
  const all = [];
  extracted.pages.forEach((p, pi) => {
    for (const l of p.lines) {
      const text = normalizeText(l.text);
      if (text) {
        all.push({ text, fontSize: l.fontSize, x: l.x, y: l.y, page: p.pageNumber, pageIdx: pi, pageWidth: p.width });
      }
    }
  });
  const firstPage = extracted.pages[0] ? extracted.pages[0].pageNumber : 1;
  const body = weightedMedianFontSize(all);
  const headingMin = body * cfg.headingRatio;
  const titleMin = body * cfg.titleRatio;
  const repeated = findRepeatedKeys(all, extracted.pages.length, cfg);

  // 2. Drop junk lines (and remember what was dropped)
  const stats = { repeated: 0, leaders: 0, smallFont: 0, math: 0, captions: 0, tableRows: 0, tableHeaders: 0 };
  const samples = { repeated: [], leaders: [], smallFont: [], math: [], captions: [], tableRows: [], tableHeaders: [] };
  const drop = (kind, text) => {
    stats[kind]++;
    if (samples[kind].length < 6 && !samples[kind].includes(text)) samples[kind].push(text);
  };

  const kept = [];
  let tableZone = 0;
  for (const l of all) {
    if (repeated.has(repeatKey(l.text))) { drop('repeated', l.text); continue; }
    if (LEADERS.test(l.text)) { drop('leaders', l.text); continue; } // table-of-contents lines
    if (l.fontSize < body * cfg.smallFontRatio) { drop('smallFont', l.text); continue; }
    if (looksLikeMath(l.text)) { drop('math', l.text); continue; }
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

  // vertical gap above each kept line (0 = first on the page)
  kept.forEach((l, i) => {
    const p = kept[i - 1];
    l.gap = p && p.page === l.page && p.y > l.y ? p.y - l.y : 0;
  });
  const medianGap = medianLineGap(kept) || body * 1.2;

  const vocab = buildVocab(kept);
  const indentOf = makeIndentFn(kept);

  // 3. Split into sections: size-based first; if that finds almost nothing, use the loose detector
  const ctx = { headingMin, titleMin, firstPage, cfg, medianGap };
  const realCount = (r) => r.sections.filter((s) => s.heading !== null).length;
  let headingMode = 'size';
  let res = walk(kept, ctx, false);
  if (realCount(res) < 3) {
    res = walk(kept, ctx, true);
    headingMode = 'pattern';
  }

  // 4. Build the output sections
  const out = [];
  const droppedSections = [];
  let backMatterAt = null;
  for (const s of res.sections) {
    if (s.heading === null) continue; // front matter
    if (backMatterAt) { droppedSections.push(`${s.heading} (after back matter)`); continue; }

    let text = scrubInline(assemble(s.lines, vocab, indentOf, cfg));
    const cutRes = cutBackMatter(text);
    text = cutRes.text;
    if (cutRes.cut) backMatterAt = s.heading;

    const t = normalizeTitle(s.heading);
    if (cfg.dropSections.some((d) => t === d || t.startsWith(d))) { droppedSections.push(s.heading); continue; }
    if (text.length < cfg.minSectionChars) { droppedSections.push(`${s.heading} (too short)`); continue; }
    if (headingMode === 'pattern' && proseCount(text) < 2) { droppedSections.push(`${s.heading} (no prose)`); continue; }
    out.push({ title: s.heading, level: headingLevel(s.heading), text });
  }

  const detected = res.titleLines.join(' ') || null;
  const title = cleanTitle(validMetaTitle(extracted.metaTitle) ? extracted.metaTitle : detected);

  return {
    paperId: extracted.paperId,
    source: extracted.source,
    title,
    sections: out,
    debug: {
      mode: headingMode,
      titleFrom: validMetaTitle(extracted.metaTitle) ? 'pdf metadata' : 'page text',
      bodyFontSize: body,
      headingMin,
      medianGap,
      linesIn: all.length,
      linesKept: kept.length,
      stats,
      samples,
      droppedSections,
      backMatterAt,
      stoppedAt: res.stoppedAt,
    },
  };
}
