// js/ chunk.js
// Step 5: cleaned paper -> chunks
// Pure functions. No DOM access.
// Chunk: { id, paperId, paperTitle, section, sectionPath, part, ofParts, mergedSections, text, tokens }

const ABBREV = /(?:et\.al|et al|e\.g|i\.e|etc|vs|Figs?|Eqs?|Sec|Tab|cf|approx)\.$/i;
const INITIAL = /(?:^|\s)[A-Z]\.$/;

export function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function splitSentences(text) {
  const parts = text.split(/(?<=[.!?])\s+(?=["“(\[]?[A-Z])/);
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

// Last resort: one "sentence" bigger than the limit -> split on word boundaries
function hardSplit(text, maxTokens) {
  const maxChars = maxTokens * 4;
  const out = [];
  let cur = '';
  for (const w of text.split(' ')) {
    if (cur && cur.length + 1 + w.length > maxChars) {
      out.push(cur);
      cur = w;
    } else {
      cur = cur ? cur + ' ' + w : w;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// Text -> units: paragraphs, or sentences when a paragraph alone is over the limit.
// sep = what to put between this unit and the previous one.
function toUnits(text, maxTokens) {
  const units = [];
  for (const para of text.split(/\n\n+/)) {
    const p = para.trim();
    if (!p) continue;
    if (estimateTokens(p) <= maxTokens) {
      units.push({ text: p, sep: '\n\n' });
      continue;
    }
    let first = true;
    for (const s of splitSentences(p)) {
      const pieces = estimateTokens(s) <= maxTokens ? [s] : hardSplit(s, maxTokens);
      for (const piece of pieces) {
        units.push({ text: piece, sep: first ? '\n\n' : ' ' });
        first = false;
      }
    }
  }
  return units;
}

// Pack units into balanced chunks no bigger than maxTokens
function packUnits(units, maxTokens) {
  const total = units.reduce((n, u) => n + estimateTokens(u.text), 0);
  const n = Math.max(1, Math.ceil(total / maxTokens));
  const target = total / n;
  const chunks = [];
  let cur = '';
  let curTok = 0;
  for (const u of units) {
    const t = estimateTokens(u.text);
    if (cur && (curTok + t > maxTokens || (curTok >= target && chunks.length < n - 1))) {
      chunks.push(cur);
      cur = '';
      curTok = 0;
    }
    cur = cur ? cur + u.sep + u.text : u.text;
    curTok += t;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

const withHeading = (s) => `${s.title}\n${s.text}`;

export function chunkSections(cleaned, cfg) {
  const max = cfg.maxChunkTokens;
  const min = cfg.minChunkTokens;
  const out = [];
  const stack = [];   // heading path, e.g. ["2 RELATED WORK", "2.1 ..."]
  let pending = [];   // tiny sections waiting to merge into the next section

  const push = (section, path, mergedTitles, texts) => {
    texts.forEach((text, i) => {
      out.push({
        id: `${cleaned.paperId}-c${String(out.length + 1).padStart(3, '0')}`,
        paperId: cleaned.paperId,
        paperTitle: cleaned.title,
        section,
        sectionPath: path.join(' > '),
        part: i + 1,
        ofParts: texts.length,
        mergedSections: mergedTitles,
        text,
        tokens: estimateTokens(text),
      });
    });
  };

  for (const s of cleaned.sections) {
    while (stack.length >= s.level) stack.pop();
    stack.push(s.title);

    if (estimateTokens(s.text) < min) {
      pending.push(s);
      continue;
    }

    const body = pending.length
      ? [...pending.map(withHeading), withHeading(s)].join('\n\n')
      : s.text;
    push(s.title, [...stack], pending.map((p) => p.title), packUnits(toUnits(body, max), max));
    pending = [];
  }

  // Tiny sections left at the very end: attach to the last chunk
  if (pending.length) {
    const tail = pending.map(withHeading).join('\n\n');
    const last = out[out.length - 1];
    if (last) {
      last.text += '\n\n' + tail;
      last.tokens = estimateTokens(last.text);
      last.mergedSections = [...last.mergedSections, ...pending.map((p) => p.title)];
    } else {
      push(pending[0].title, [pending[0].title], pending.slice(1).map((p) => p.title),
        packUnits(toUnits(tail, max), max));
    }
  }

  return out;
}
