// Turns final pairs into downloadable text. Pure functions, no DOM.

export function buildRecords(pairs, includeMeta) {
  return pairs.map((p) =>
    includeMeta
      ? { instruction: p.instruction, input: p.input, output: p.output, task_type: p.task_type, meta: p.meta }
      : { instruction: p.instruction, input: p.input, output: p.output }
  );
}

export function toJson(pairs, includeMeta) {
  return JSON.stringify(buildRecords(pairs, includeMeta), null, 2);
}

export function toJsonl(pairs, includeMeta) {
  return buildRecords(pairs, includeMeta).map((r) => JSON.stringify(r)).join('\n') + '\n';
}
