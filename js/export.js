// Turns final pairs into downloadable text. Records are { input, output } (+ meta if asked).

export function buildRecords(pairs, includeMeta) {
  return pairs.map((p) =>
    includeMeta ? { input: p.input, output: p.output, meta: p.meta } : { input: p.input, output: p.output }
  );
}

export function toJson(pairs, includeMeta) {
  return JSON.stringify(buildRecords(pairs, includeMeta), null, 2);
}

export function toJsonl(pairs, includeMeta) {
  return buildRecords(pairs, includeMeta).map((r) => JSON.stringify(r)).join('\n') + '\n';
}
