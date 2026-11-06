// Step 7: validation and de-duplication. Pure functions, no DOM.

export function normalizeForMatch(s) {
  return String(s)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function quoteInChunk(quote, chunkText) {
  const q = normalizeForMatch(quote || '');
  return q.length > 0 && normalizeForMatch(chunkText).includes(q);
}

const TASK_TYPES = ['factual_qa', 'explanation', 'summary', 'compare_or_critique'];

const NOT_SELF_CONTAINED =
  /\b(?:the|this|above|given|provided)\s+(?:passage|excerpt|paragraph)\b|\b(?:the|this)\s+(?:section|table|figure)\b|\bthe\s+(?:above|following)\s+text\b|\b(?:table|figure|fig\.)\s*\d/i;
const MENTIONS_PASSAGE = /\b(?:the|this)\s+(?:passage|excerpt)\b/i;
const CITATION_TEST = /\[\d+(?:\s*[,–-]\s*\d+)*\]/;
const CITATION_STRIP = /\s*\[\d+(?:\s*[,–-]\s*\d+)*\]/g;

// Numbers (2+ characters) in the output that do not appear anywhere in the source chunk
function unsupportedNumbers(output, chunkText) {
  const hay = normalizeForMatch(chunkText);
  const nums = output.match(/\d+(?:[.,]\d+)*/g) || [];
  const bad = [];
  for (const n of nums) {
    if (n.length < 2) continue;
    if (hay.includes(n) || hay.includes(n.replace(/,/g, ''))) continue;
    bad.push(n);
  }
  return bad;
}

// Returns { valid: [...], rejected: [{ reason, pair }] }
export function validatePairs(pairs, chunk, opts = {}) {
  const checkNumbers = opts.checkNumbers !== false;
  const valid = [];
  const rejected = [];

  for (const raw of pairs || []) {
    const reject = (reason) => rejected.push({ reason, pair: raw });

    if (!raw || typeof raw !== 'object') { reject('malformed pair'); continue; }

    const instruction = typeof raw.instruction === 'string' ? raw.instruction.trim() : '';
    const input = typeof raw.input === 'string' ? raw.input.trim() : '';
    let output = typeof raw.output === 'string' ? raw.output.trim() : '';

    if (!instruction || !input || !output) { reject('missing field'); continue; }
    if (instruction.length < 15 || input.length < 30 || output.length < 20) { reject('too short'); continue; }
    if (!quoteInChunk(input, chunk.text)) { reject('input not verbatim from chunk'); continue; }
    if (NOT_SELF_CONTAINED.test(instruction) || MENTIONS_PASSAGE.test(output)) { reject('not self-contained'); continue; }
    if (CITATION_TEST.test(instruction)) { reject('citation marker in instruction'); continue; }

    output = output.replace(CITATION_STRIP, '').trim();
    if (normalizeForMatch(output) === normalizeForMatch(input)) { reject('output copies input'); continue; }

    if (checkNumbers && unsupportedNumbers(output, chunk.text).length) {
      reject('number not found in source');
      continue;
    }

    valid.push({
      ...raw,
      task_type: TASK_TYPES.includes(raw.task_type) ? raw.task_type : 'other',
      instruction,
      input,
      output,
    });
  }
  return { valid, rejected };
}

function wordSet(s) {
  return new Set((String(s).toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 2));
}

function jaccard(a, b) {
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

// groups = array of arrays of pairs (one array per chunk). Removes near-duplicate instructions.
export function dedupeGroups(groups, threshold = 0.8) {
  const seen = [];
  let removed = 0;
  const out = groups.map((g) =>
    g.filter((p) => {
      const key = normalizeForMatch(p.instruction);
      const w = wordSet(p.instruction);
      for (const s of seen) {
        if (s.key === key || jaccard(s.w, w) >= threshold) {
          removed++;
          return false;
        }
      }
      seen.push({ key, w });
      return true;
    })
  );
  return { groups: out, removed };
}
