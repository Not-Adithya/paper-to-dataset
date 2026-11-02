// js/ app.js
import { CONFIG } from './config.js';
import { extractPdf } from './extract.js';
import { cleanAndSection } from './clean.js';
import { chunkSections } from './chunk.js';
import { generatePairs, listModels } from './generate.js';
import { quoteInChunk } from './validate.js';

const fileInput = document.getElementById('pdfFile');
const apiKeyInput = document.getElementById('apiKey');
const modelInput = document.getElementById('modelName');
const chunkNoInput = document.getElementById('chunkNo');
const runBtn = document.getElementById('runBtn');
const testBtn = document.getElementById('testBtn');
const listBtn = document.getElementById('listBtn');
const output = document.getElementById('output');

modelInput.value = CONFIG.model;

let selectedFile = null;
let cache = null; // { cleaned, chunks } for the selected file

fileInput.addEventListener('change', () => {
  selectedFile = fileInput.files[0] || null;
  cache = null;
  if (selectedFile) output.textContent = `Selected: ${selectedFile.name}`;
});

async function getChunks() {
  if (!selectedFile) throw new Error('Choose a PDF first.');
  if (!cache) {
    output.textContent = 'Extracting and chunking...';
    const extracted = await extractPdf(selectedFile);
    const cleaned = cleanAndSection(extracted, CONFIG.clean);
    cache = { cleaned, chunks: chunkSections(cleaned, CONFIG) };
  }
  return cache;
}

function renderChunks({ cleaned, chunks }) {
  let t = `${cleaned.title}\nChunks: ${chunks.length}\n\n`;
  for (const [i, c] of chunks.entries()) {
    t += `#${i + 1}  ${c.id}  ${String(c.tokens).padStart(4)} tok  ${c.sectionPath}`;
    if (c.ofParts > 1) t += `  [part ${c.part}/${c.ofParts}]`;
    t += '\n';
  }
  return t;
}

function renderResult(chunkNo, chunk, cfg, result) {
  let t = `CHUNK #${chunkNo}: ${chunk.id} | ${chunk.sectionPath} | ${chunk.tokens} tok\n`;
  t += `Model: ${cfg.model} | finish: ${result.finishReason}`;
  if (result.usage) t += ` | tokens in/out: ${result.usage.promptTokenCount}/${result.usage.candidatesTokenCount}`;
  t += `\nPairs returned: ${result.pairs.length}\n\n`;

  result.pairs.forEach((p, i) => {
    const found = quoteInChunk(p.input, chunk.text);
    t += `--- Pair ${i + 1}  [${p.task_type}]  input found verbatim in chunk: ${found ? 'YES' : 'NO  <-- check this'}\n`;
    t += `Instruction: ${p.instruction}\n`;
    t += `Input:       ${p.input}\n`;
    t += `Output:      ${p.output}\n\n`;
  });

  t += '='.repeat(60) + '\nSOURCE CHUNK (compare against the pairs above):\n\n' + chunk.text + '\n';
  return t;
}

runBtn.addEventListener('click', async () => {
  runBtn.disabled = true;
  try {
    output.textContent = renderChunks(await getChunks());
  } catch (err) {
    console.error(err);
    output.textContent = 'Error: ' + err.message;
  } finally {
    runBtn.disabled = false;
  }
});

testBtn.addEventListener('click', async () => {
  testBtn.disabled = true;
  try {
    const { chunks } = await getChunks();
    const n = parseInt(chunkNoInput.value, 10);
    if (!(n >= 1 && n <= chunks.length)) throw new Error(`Chunk number must be 1 to ${chunks.length}.`);
    const chunk = chunks[n - 1];
    const cfg = { ...CONFIG, model: modelInput.value.trim() || CONFIG.model };
    output.textContent = `Calling ${cfg.model} on chunk #${n}...`;
    const result = await generatePairs(chunk, apiKeyInput.value.trim(), cfg);
    console.log('Result:', result);
    output.textContent = renderResult(n, chunk, cfg, result);
  } catch (err) {
    console.error(err);
    output.textContent = 'Error: ' + err.message;
  } finally {
    testBtn.disabled = false;
  }
});

listBtn.addEventListener('click', async () => {
  listBtn.disabled = true;
  try {
    output.textContent = 'Fetching models...';
    const names = await listModels(apiKeyInput.value.trim());
    output.textContent = 'Models that support generateContent:\n\n' + names.join('\n');
  } catch (err) {
    console.error(err);
    output.textContent = 'Error: ' + err.message;
  } finally {
    listBtn.disabled = false;
  }
});
