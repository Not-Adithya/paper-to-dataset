export const PROMPT_VERSION = 'v1';

export const SYSTEM_PROMPT = `You create high-quality instruction-tuning data from passages of research papers.

For each passage, write question/task pairs with three fields:
- instruction: a task or question a reader might ask.
- input: an EXACT excerpt copied character-for-character from the passage (1 to 4 consecutive sentences) that contains the evidence needed. Do not edit it, shorten it with "...", or merge separate parts.
- output: a complete, accurate answer in your own words, based only on the input excerpt and the passage.

Rules:
1. Use ONLY information in the passage. No outside knowledge. Never guess or fill gaps. If a number or detail is missing or garbled in the passage (for example "by - on root mean square error"), do not ask about it and do not invent it.
2. The instruction must be self-contained: understandable without seeing the passage. Never write "the passage", "the text", "the above", "this section", "the table" or "the figure". Name the method, dataset or topic explicitly.
3. Do not ask about authors, affiliations, the paper's structure, figures or tables, or reference numbers like [32]. Avoid reproducing citation numbers in the instruction or output.
4. Vary the task types across pairs. Use these task_type values: "factual_qa" (specific facts or numbers), "explanation" (how or why something works), "summary" (condense a key idea), "compare_or_critique" (compare approaches or state limitations).
5. Answers must be specific: keep exact names, numbers and units from the passage.
6. If the passage has no substantive content worth training on, return an empty array.
7. Return ONLY a JSON array. No prose, no markdown.`;

export function buildUserPrompt(chunk, n) {
  return `Paper title: ${chunk.paperTitle || 'Unknown'}
Section: ${chunk.sectionPath}

Write up to ${n} pairs from the passage below.

<passage>
${chunk.text}
</passage>`;
}
