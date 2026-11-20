// Sentence-level rules: short, specific pairs. No AI. Pure functions, no DOM.
// Rules: definition ("what is X?"), number (fill in the missing value), reason (why / for what purpose).

const ABBREV = /(?:et\.al|et al|e\.g|i\.e|etc|vs|Figs?|Eqs?|Sec|Tab|cf|approx|No)\.$/i;
const INITIAL = /(?:^|\s)[A-Z]\.$/;

const CITATION = /\s*\[\d+(?:\s*[,–-]\s*\d+)*\]/g;
const CITATION_AS_NOUN = /\b(?:in|by|see|from|of|and|with|to|per|following)\s+\[\d/i;
const REFERS_ELSEWHERE = /\b(?:Table|Figure|Fig\.|Section|Sec\.|Eq\.|Equation|Chapter|Appendix)\s*\d/;
const DEPENDENT_START = /^(?:This|These|Those|That|It|They|Its|Their|Such|Here|There|However|Thus|Therefore|Hence|Moreover|Furthermore|Additionally|Also|Then|Finally|Second|Secondly|Third|Both|Another|Similarly|Likewise|Overall|Instead|Still|Yet|But|And|So|Next|Further)\b/;

const BAD_SUBJECT = /^(?:This|These|Those|That|It|They|We|Our|Their|Its|There|Here|Which|What|Such|Another|Each|Both|Some|Most|All|Many|Other|One|Two|Three|First|Second|Third|Finally|Thus|However|Also|Moreover|Furthermore|Additionally|Therefore|Hence|Overall|In|For|As|On|At|By|With|From|To|When|While|If|Since|Although|Because)\b|^The\s+(?:paper|work|study|goal|aim|purpose|rest|number|following|above|main|key|first|second|third|remaining)\b/i;
const GENERIC_SUBJECT = /\b(?:paper|work|study|section|goal|aim|purpose)\b/i;

const UNITS = 'Hz|kHz|ms|secs?|seconds?|minutes?|hours?|days?|weeks?|months?|epochs?|subjects|participants|patients|samples|units|layers|features|dimensions?|timesteps|neurons|nodes|cells|classes|images|videos|recordings|interviews|users|people|million|billion|thousand|times|folds|trials|parameters|GB|MB|KB|fps';
const NUM_PERCENT = /(?<![\w.-])\d+(?:\.\d+)?\s?%/g;
const NUM_DECIMAL = /(?<![\w.-])\d+\.\d+(?!\.?\d)(?!\s?%)/g;
const NUM_UNIT = new RegExp(`(?<![\\w.-])(\\d{1,3}(?:,\\d{3})*)\\s+(?:${UNITS})\\b`, 'gi');

const CONNECTORS = [
  { re: /,?\s+because\s+/i, label: 'Because', kind: 'reason' },
  { re: /,?\s+due to\s+/i, label: 'Due to', kind: 'reason' },
  { re: /,?\s+in order to\s+/i, label: 'In order to', kind: 'purpose' },
  { re: /,?\s+so that\s+/i, label: 'So that', kind: 'purpose' },
];

const q = (s) => String(s).replace(/"/g, "'");

// ---------- sentence preparation ----------

function splitSentences(paragraph) {
  const parts = paragraph.split(/(?<=[.!?])\s+(?=["“(\[]?[A-Z])/);
  const out = [];
  for (const p of parts) {
    const prev = out[out.length - 1];
    if (prev !== undefined && (ABBREV.test(prev) || INITIAL.test(prev))) {
      out[out.length - 1] = prev + ' ' + p;
    } else {
      out.push(p);
    }
  }
  return out;
}

// Returns a clean, self-standing sentence, or null if it is unusable
function prepare(raw, L) {
  let s = raw.replace(/^[•●▪◦‣]\s*/, '').replace(/\s+/g, ' ').trim();
  if (CITATION_AS_NOUN.test(s)) return null;
  s = s.replace(CITATION, '').replace(/\s+([,.;:!?])/g, '$1').replace(/\s+/g, ' ').trim();
  if (s.length < L.minChars || s.length > L.maxChars) return null;
  if (s.split(' ').length < L.minWords) return null;
  if (!/^[A-Z]/.test(s) || !/[.!?]["”’)]?$/.test(s)) return null;
  if (REFERS_ELSEWHERE.test(s) || /https?:\/\//.test(s)) return null;
  if (/\b(?:I|My|my|me|mine|myself)\b/.test(s)) return null;   // personal narrative
  return s;
}

// ---------- rule: definition ----------

function definition(s) {
  const m = s.match(/\s(is defined as|are defined as|is called|are called|is known as|are known as|refers to|denotes|is|are)\s+(.+)$/);
  if (!m) return null;
  const verb = m[1];
  const rest = m[2];
  if ((verb === 'is' || verb === 'are') && !/^(?:a|an|the|defined|used|called|known|one|any)\b/i.test(rest)) return null;

  const subj = s.slice(0, m.index).trim();
  if (subj.length < 3 || subj.length > 80 || subj.split(' ').length > 8) return null;
  if (/[,;:]/.test(subj)) return null;
  if (/\b(?:and|or|which|that|who|where|when|how|why|what|if|since|because|while|although|not)\b/i.test(subj)) return null;
  if (BAD_SUBJECT.test(subj) || GENERIC_SUBJECT.test(subj)) return null;

  return {
    subject: subj.replace(/^(The|A|An)\s+/, (x) => x.toLowerCase()),
    plural: /^are\b/.test(verb),
  };
}

// ---------- rule: number ----------

function numberCandidate(s) {
  const count = (s.match(/\d+(?:\.\d+)?/g) || []).length;
  if (count === 0 || count > 5) return null;
  const cands = [];
  for (const m of s.matchAll(NUM_PERCENT)) cands.push({ idx: m.index, len: m[0].length, value: m[0].replace(/\s+/g, ''), score: 3 });
  for (const m of s.matchAll(NUM_DECIMAL)) cands.push({ idx: m.index, len: m[0].length, value: m[0], score: 2 });
  for (const m of s.matchAll(NUM_UNIT)) cands.push({ idx: m.index, len: m[1].length, value: m[1], score: 1 });
  if (!cands.length) return null;
  cands.sort((a, b) => b.score - a.score || a.idx - b.idx);
  return cands[0];
}

// ---------- rule: reason / purpose ----------

function reasonSplit(s) {
  let best = null;
  for (const c of CONNECTORS) {
    const m = c.re.exec(s);
    if (m && (!best || m.index < best.m.index)) best = { c, m };
  }
  if (!best) return null;
  const before = s.slice(0, best.m.index).replace(/[,;:\s]+$/, '');
  const after = s.slice(best.m.index + best.m[0].length).trim();
  if (before.length < 25 || before.split(' ').length < 5) return null;
  if (after.length < 20 || after.split(' ').length < 4) return null;
  return { kind: best.c.kind, label: best.c.label, before, after };
}

// ---------- main ----------
// ctx = { title, label, paperId, schemaVersion, limits, seen }

export function sentencePairs(section, ctx) {
  const { title, label, paperId, schemaVersion, limits: L, seen } = ctx;

  const sentences = [];
  for (const para of section.text.split(/\n\n+/)) {
    for (const raw of splitSentences(para)) {
      const s = prepare(raw, L);
      if (s) sentences.push(s);
    }
  }

  const out = [];
  const used = new Set();
  const add = (rule, input, output, sentence) => {
    if (seen.has(input)) return false;
    seen.add(input);
    used.add(sentence);
    out.push({
      input,
      output,
      meta: { stage: 1, rule, section: section.title, paperId, schemaVersion },
    });
    return true;
  };

  // 1. definitions
  let nDef = 0;
  for (const s of sentences) {
    if (nDef >= L.maxDefinitionPerSection) break;
    const d = definition(s);
    if (!d) continue;
    const input = `In the paper "${q(title)}", what ${d.plural ? 'are' : 'is'} ${d.subject}?`;
    if (add('definition', input, s, s)) nDef++;
  }

  // 2. numbers: best sentences first, then back into reading order
  const nums = [];
  sentences.forEach((s, i) => {
    if (used.has(s) || DEPENDENT_START.test(s)) return;
    const c = numberCandidate(s);
    if (c) nums.push({ i, s, c });
  });
  nums.sort((a, b) => b.c.score - a.c.score || a.s.length - b.s.length);

  const picked = [];
  for (const x of nums) {
    if (picked.length >= L.maxNumberPerSection) break;
    const masked = x.s.slice(0, x.c.idx) + '____' + x.s.slice(x.c.idx + x.c.len);
    const input = `Fill in the missing number from the paper "${q(title)}" (section "${q(label)}"):\n"${q(masked)}"`;
    if (seen.has(input)) continue;
    picked.push({ i: x.i, s: x.s, input, output: `${x.c.value}. Full sentence: ${x.s}` });
  }
  picked.sort((a, b) => a.i - b.i);
  for (const p of picked) add('number', p.input, p.output, p.s);

  // 3. reasons / purposes
  let nReason = 0;
  for (const s of sentences) {
    if (nReason >= L.maxReasonPerSection) break;
    if (used.has(s) || DEPENDENT_START.test(s)) continue;
    const x = reasonSplit(s);
    if (!x) continue;
    const ask = x.kind === 'reason' ? 'What reason do they give?' : 'What purpose do they state?';
    const input = `In the paper "${q(title)}" (section "${q(label)}"), the authors write: "${q(x.before)} …" ${ask}`;
    if (add('reason', input, `${x.label} ${x.after}`, s)) nReason++;
  }

  return out;
}
