// Step 7 will add full validation. For now: the "is this quote really in the chunk?" check.

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

export function validatePairs(pairs, chunk) {
  throw new Error('validatePairs not implemented yet');
}
