// Rule-based pairs: cleaned paper -> { input, output, meta }.
// No AI. Outputs are always the paper's own text. Pure functions, no DOM.

import { sentencePairs } from './sentences.js';

const STOP = new Set(['of', 'the', 'and', 'for', 'in', 'on', 'to', 'a', 'an', 'with', 'by']);

// Heading -> section type (first match wins)
const TYPES = [
  ['abstract', /^abstract\b/i],
  ['contributions', /^(?:(?:key|main|major|our)\s+)?contributions?\b/i],   // NOT "Author Contributions"
  ['introduction', /^introduction$/i],
  ['dataset', /\b(?:dataset|data set|corpus)\b/i],
  ['related', /related work|background|prior work|literature/i],
  ['results', /\bresults?\b|\bevaluation\b|\bexperiments?\b/i],
  ['discussion', /discussion|conclusion|future work|limitations/i],
  ['method', /method|architecture|framework/i],
];

// Sections that never belong in technical answers
const SKIP_SECTION = /^(?:author contributions?|authors.? contributions?|funding|data availability|conflicts? of interest|institutional review|informed consent|acknowledg|supplementary|abbreviations|declarations?|ethics|publisher|disclosure|credit|competing|author information|references|bibliography)/i;

const GENERIC = new Set([
  'introduction', 'related work', 'background', 'methodology', 'methods', 'method',
  'results', 'discussion', 'discussions', 'conclusion', 'conclusions', 'dataset',
]);

const stripNumber = (h) => h.replace(/^\d+(?:\.\d+)*\.?\s*/, '').trim();

function prettyHeading(h) {
  const t = stripNumber(h);
  return t === t.toUpperCase() ? t.toLowerCase() : t;
}

// Front-matter junk: title page, committee, copyright, table-of-contents tails
const FRONT_MATTER = /all rights reserved|©\s*copyright|committee member|in partial fulfillment of the requirements/i;
const CUT_AT = /\s+(?:[ivxlc]{1,6}\s+)?(?:table of contents|list of (?:figures|tables|abbreviations|symbols))\b[\s\S]*$/i;

function tidySection(s) {
  const text = s.text.replace(CUT_AT, '').trim();
  if (FRONT_MATTER.test(text) || text.length < 100) return null;
  return { ...s, text };
}

// Heading text that is safe to show inside a question
const headingUsable = (h) => /^[A-Za-z][A-Za-z0-9 ,&:'()\/.-]{2,90}$/.test(stripNumber(h)) && !/=|\bsection no\b/i.test(h);

function classify(heading) {
  const t = stripNumber(heading);
  for (const [type, re] of TYPES) if (re.test(t)) return type;
  return null;
}

function question(type, title, topic, generic) {
  switch (type) {
    case 'contributions':
      return `What are the key contributions of the paper "${title}"?`;
    case 'introduction':
      return `What problem does the paper "${title}" address, and what motivates its approach?`;
    case 'related':
      return generic
        ? `What related work does the paper "${title}" review?`
        : `What prior work on ${topic} does the paper "${title}" review?`;
    case 'dataset':
      return `Describe the dataset used in the paper "${title}".`;
    case 'method':
      return generic
        ? `Describe the methodology of the paper "${title}".`
        : `Describe the methodology used in the paper "${title}" for ${topic}.`;
    case 'results':
      return generic
        ? `What results does the paper "${title}" report?`
        : `What results does the paper "${title}" report for ${topic}?`;
    case 'discussion':
      return `What conclusions, limitations and future work does the paper "${title}" discuss?`;
    default:
      return `In the paper "${title}", explain the section on ${topic}.`;
  }
}

// Clip text to at most `max` characters, ending on a paragraph or sentence boundary.
export function clipText(text, max) {
  if (text.length <= max) return text;
  let cur = '';
  for (const p of text.split(/\n\n+/)) {
    if (cur && cur.length + 2 + p.length > max) break;
    cur = cur ? cur + '\n\n' + p : p;
    if (cur.length > max) break;
  }
  if (cur.length <= max && cur.length >= max * 0.4) return cur;

  const slice = text.slice(0, max);
  const cutAt = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('? '), slice.lastIndexOf('! '));
  return cutAt >= max * 0.4 ? slice.slice(0, cutAt + 1) : slice.replace(/\s+\S*$/, '');
}

// Share of characters that are neither letters, digits, spaces nor ordinary punctuation
export function symbolRatio(t) {
  const bad = (t.match(/[^A-Za-z0-9\s.,;:'"()%\/\-–—’“”?!+°μ±×−]/g) || []).length;
  return bad / Math.max(1, t.length);
}

const sentenceCount = (t) => (t.match(/[a-z]{2,}[.!?]["”’)\]]?(?:\s|$)/g) || []).length;

// ---------- abbreviations ----------

function sentenceAt(text, idx) {
  const head = text.slice(0, idx);
  const start = Math.max(head.lastIndexOf('. '), head.lastIndexOf('? '), head.lastIndexOf('! '), head.lastIndexOf('\n\n'));
  const e = text.slice(idx).search(/[.!?](?:\s|$)/);
  const end = e === -1 ? text.length : idx + e + 1;
  return text.slice(start === -1 ? 0 : start + 2, end).trim();
}

// Finds "Long Name (ABBR)" where the initials of the long name really spell ABBR
function findAbbreviations(text) {
  const found = [];
  const re = /\(([A-Za-z][A-Za-z0-9-]{1,11})\)/g;
  let m;
  while ((m = re.exec(text))) {
    const abbr = m[1];
    if ((abbr.match(/[A-Z]/g) || []).length < 2) continue;
    const letters = abbr.replace(/(?<=[A-Z])s$/, '').replace(/[^A-Za-z]/g, '').toLowerCase();
    if (letters.length < 2) continue;

    const before = text.slice(0, m.index).trimEnd();
    const tokens = [...before.matchAll(/[^\s-]+/g)].slice(-(letters.length + 4));

    let long = null;
    for (let k = letters.length; k <= Math.min(tokens.length, letters.length + 3) && !long; k++) {
      const win = tokens.slice(-k);
      if (!/^[A-Za-z]/.test(win[0][0])) continue;
      if (STOP.has(win[0][0].toLowerCase())) continue;
      if (win.slice(0, -1).some((w) => /[.!?;:]$/.test(w[0]))) continue;
      const initials = win
        .map((w) => w[0])
        .filter((w) => !STOP.has(w.toLowerCase()))
        .map((w) => w[0].toLowerCase())
        .join('');
      if (initials === letters) long = before.slice(win[0].index).trim();
    }
    if (!long) continue;

    const sentence = sentenceAt(text, m.index);
    if (sentence.length < 40 || sentence.length > 600) continue;
    if (symbolRatio(sentence) > 0.03) continue;
    found.push({ abbr, letters, long, sentence });
  }
  return found;
}

// ---------- main ----------

export function generateRulePairs(cleaned, cfg, opts = {}) {
  const o = { abstract: true, sections: true, abbreviations: true, sentences: true, ...opts };
  const r = cfg.rules;
  const title = cleaned.title || cleaned.paperId.replace(/_+/g, ' ');
  const pairs = [];
  const skipped = [];
  const seenAbbr = new Set();
  const seenInputs = new Set();
  const stack = [];

  const make = (rule, section, input, output) => ({
    input,
    output,
    meta: { stage: 1, rule, section, paperId: cleaned.paperId, schemaVersion: cfg.schemaVersion },
  });

  for (const raw of cleaned.sections) {
    if (SKIP_SECTION.test(stripNumber(raw.title))) { skipped.push(`${raw.title} (not technical content)`); continue; }
    const s = tidySection(raw);
    if (!s) { skipped.push(`${raw.title} (front matter)`); continue; }

    while (stack.length && stack[stack.length - 1].level >= s.level) stack.pop();
    const own = classify(s.title);
    const parentType = stack.length ? stack[stack.length - 1].type : 'default';
    const type = own || parentType;
    stack.push({ level: s.level, type });

    if (own === 'abstract') {
      if (o.abstract) pairs.push(make('abstract', s.title, `Summarize the paper "${title}".`, clipText(s.text, r.maxOutputChars)));
    } else if (o.sections) {
      const answer = clipText(s.text, r.maxOutputChars);
      if (answer.length < r.minSectionChars) {
        skipped.push(s.title);
      } else if (symbolRatio(answer) > r.maxSymbolRatio || sentenceCount(answer) < 2) {
        skipped.push(`${s.title} (equations or garbled text)`);
      } else {
        const pretty = prettyHeading(s.title);
        const topic = pretty.replace(/^(?:results?|discussions?|evaluation)\s+(?:from|of|on|for)\s+/i, '');
        const generic = GENERIC.has(stripNumber(s.title).toLowerCase());
        // a heading that is not safe to show in a question becomes a generic question
        const q = headingUsable(s.title)
          ? question(type, title, topic, generic)
          : question(type === 'default' ? 'method' : type, title, '', true);
        pairs.push(make('section', s.title, q, answer));
      }
    }

    if (o.abbreviations) {
      for (const a of findAbbreviations(s.text)) {
        if (seenAbbr.has(a.letters)) continue;
        seenAbbr.add(a.letters);
        pairs.push(make(
          'abbreviation',
          s.title,
          `In the paper "${title}", what does ${a.abbr} stand for?`,
          `${a.abbr} stands for ${a.long}. In the paper: ${a.sentence}`
        ));
      }
    }

    if (o.sentences) {
      pairs.push(...sentencePairs(s, {
        title,
        label: headingUsable(s.title) ? prettyHeading(s.title) : '',
        paperId: cleaned.paperId,
        schemaVersion: cfg.schemaVersion,
        limits: cfg.sentences,
        seen: seenInputs,
      }));
    }
  }

  const byRule = {};
  for (const p of pairs) byRule[p.meta.rule] = (byRule[p.meta.rule] || 0) + 1;
  return { pairs, skipped, stats: { total: pairs.length, byRule } };
}
