import { CONFIG } from './config.js';
import { extractPdf } from './extract.js';
import { cleanAndSection } from './clean.js';
import { chunkSections } from './chunk.js';
import { generatePairs, listModels } from './generate.js';
import { quoteInChunk } from './validate.js';
import { runPipeline, allocate } from './run.js';
import { toJson, toJsonl } from './export.js';

const $ = (id) => document.getElementById(id);
const fileInput = $('pdfFile');
const apiKeyInput = $('apiKey');
const modelInput = $('modelName');
const targetInput = $('targetPairs');
const delayInput = $('delaySec');
const planEl = $('plan');
const generateBtn = $('generateBtn');
const stopBtn = $('stopBtn');
const downloadBtn = $('downloadBtn');
const downloadJsonlBtn = $('downloadJsonlBtn');
const includeMeta = $('includeMeta');
const progressWrap = $('progressWrap');
const barFill = $('barFill');
const progressText = $('progressText');
const chunkNoInput = $('chunkNo');
const previewBtn = $('previewBtn');
const testBtn = $('testBtn');
const listBtn = $('listBtn');
const output = $('output');

modelInput.value = CONFIG.model;
targetInput.value = CONFIG.defaultTargetPairs;
delayInput.value = CONFIG.defaultDelaySeconds;

let selectedFile = null;
let cache = null;          // { cleaned, chunks }
let finalPairs = null;
let running = false;
let stopRequested = false;
let lastProgress = null;
let lastUpdateAt = 0;
let timer = null;

// ---------- helpers ----------
const fmt = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const readTarget = () => {
  const n = parseInt(targetInput.value, 10);
  return Number.isFinite(n) ? Math.min(1000, Math.max(1, n)) : CONFIG.defaultTargetPairs;
};
const readDelay = () => {
  const n = parseFloat(delayInput.value);
  return Number.isFinite(n) ? Math.max(0, n) : CONFIG.defaultDelaySeconds;
};
const log = (line) => {
  output.textContent += line + '\n';
  output.scrollTop = output.scrollHeight;
};

function setBusy(busy) {
  running = busy;
  generateBtn.disabled = busy;
  previewBtn.disabled = busy;
  testBtn.disabled = busy;
  listBtn.disabled = busy;
  stopBtn.disabled = !busy;
  if (!busy) stopBtn.textContent = 'Stop';
}

function setDownloads(enabled) {
  downloadBtn.disabled = !enabled;
  downloadJsonlBtn.disabled = !enabled;
}

function download(name, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function baseName() {
  const id = (cache && cache.cleaned.paperId) || 'paper';
  return id.replace(/[^\w.-]+/g, '_');
}

function updatePlan() {
  if (!cache) { planEl.textContent = ''; return; }
  const target = readTarget();
  const delay = readDelay();
  const alloc = allocate(cache.chunks, target, CONFIG.maxPairsPerChunk);
  const jobs = alloc.filter((a) => a > 0).length;
  const cap = cache.chunks.length * CONFIG.maxPairsPerChunk;
  const estMs = jobs * (delay + CONFIG.assumedRequestSec) * 1000;
  let t = `Plan: ${target} pairs from ${jobs} of ${cache.chunks.length} chunks (${jobs} API requests), estimated time ~${fmt(estMs)}.`;
  if (target > cap) t += ` Target is above the maximum for this paper (${cap}); it will be capped.`;
  planEl.textContent = t;
}

async function getChunks() {
  if (!selectedFile) throw new Error('Choose a PDF first.');
  if (!cache) {
    output.textContent = 'Extracting and chunking...';
    const extracted = await extractPdf(selectedFile);
    const cleaned = cleanAndSection(extracted, CONFIG.clean);
    cache = { cleaned, chunks: chunkSections(cleaned, CONFIG) };
    updatePlan();
  }
  return cache;
}

// ---------- progress display ----------
function renderProgress() {
  const p = lastProgress;
  if (!p) return;
  const now = Date.now();
  const elapsed = (p.endedAt || now) - p.startedAt;
  const remaining = Math.max(0, p.total - p.done);
  const per = p.avgJobMs || readDelay() * 1000 + CONFIG.assumedRequestSec * 1000;
  const eta = p.finished ? 0 : Math.max(0, remaining * per - (now - lastUpdateAt));
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  barFill.style.width = pct + '%';
  progressText.textContent =
    `Chunk ${p.done}/${p.total} (${pct}%) | valid pairs so far: ${p.valid} (target ${p.target}) | ` +
    `elapsed ${fmt(elapsed)} | ETA ~${fmt(eta)}\n${p.status}`;
}

function summaryText(result) {
  const s = result.summary;
  let t = '\n' + '='.repeat(60) + '\n';
  t += s.stopReason ? `STOPPED: ${s.stopReason}\n` : 'DONE\n';
  t += `Time: ${fmt(s.elapsedMs)} | API requests planned: ${s.requests}\n`;
  t += `Final pairs: ${s.final} (target ${s.target})\n`;
  t += `Passed validation: ${s.validBeforeDedupe} | duplicates removed: ${s.duplicatesRemoved} | trimmed to target: ${s.trimmed}\n`;
  const rej = Object.entries(s.rejected);
  t += rej.length ? 'Rejected by validation: ' + rej.map(([k, v]) => `${v}x ${k}`).join(', ') + '\n' : 'Rejected by validation: none\n';
  if (s.failed.length) {
    t += `Failed chunks (${s.failed.length}):\n`;
    for (const f of s.failed) t += `  - ${f.chunkId} (${f.section}): ${f.error}\n`;
  }
  if (s.final < s.target && !s.stopReason) {
    t += `Fewer pairs than the target passed validation. Lower the target or try another paper to get more.\n`;
  }
  if (s.final > 0) t += 'You can download the file now.\n';

  t += '\nPREVIEW (first 3 pairs):\n\n';
  result.pairs.slice(0, 3).forEach((p, i) => {
    t += `--- ${i + 1} [${p.task_type}] ${p.meta.section}\nInstruction: ${p.instruction}\nInput: ${p.input}\nOutput: ${p.output}\n\n`;
  });
  return t;
}

// ---------- events ----------
fileInput.addEventListener('change', () => {
  selectedFile = fileInput.files[0] || null;
  cache = null;
  finalPairs = null;
  setDownloads(false);
  progressWrap.hidden = true;
  planEl.textContent = '';
  if (selectedFile) output.textContent = `Selected: ${selectedFile.name}`;
});

targetInput.addEventListener('input', updatePlan);
delayInput.addEventListener('input', updatePlan);

generateBtn.addEventListener('click', async () => {
  if (running) return;
  try {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) throw new Error('Paste your API key first.');
    const { chunks } = await getChunks();
    const cfg = { ...CONFIG, model: modelInput.value.trim() || CONFIG.model };
    const target = readTarget();

    setBusy(true);
    stopRequested = false;
    finalPairs = null;
    setDownloads(false);
    output.textContent = `Model: ${cfg.model} | target: ${target} pairs | delay: ${readDelay()}s\n(Keep this tab open while it runs.)\n\n`;
    progressWrap.hidden = false;
    lastProgress = null;
    timer = setInterval(renderProgress, 500);

    const result = await runPipeline({
      chunks,
      apiKey,
      cfg,
      target,
      delayMs: readDelay() * 1000,
      shouldStop: () => stopRequested,
      onLog: log,
      onProgress: (p) => { lastProgress = p; lastUpdateAt = Date.now(); renderProgress(); },
    });

    finalPairs = result.pairs;
    lastProgress = {
      ...lastProgress,
      finished: true,
      endedAt: Date.now(),
      valid: result.pairs.length,
      status: result.summary.stopReason ? `Stopped: ${result.summary.stopReason}` : 'Finished.',
    };
    renderProgress();
    log(summaryText(result));
    setDownloads(finalPairs.length > 0);
  } catch (err) {
    console.error(err);
    log('Error: ' + err.message);
  } finally {
    clearInterval(timer);
    setBusy(false);
  }
});

stopBtn.addEventListener('click', () => {
  stopRequested = true;
  stopBtn.disabled = true;
  stopBtn.textContent = 'Stopping after current request...';
});

downloadBtn.addEventListener('click', () => {
  if (!finalPairs || !finalPairs.length) return;
  download(`${baseName()}_dataset_${finalPairs.length}pairs.json`, toJson(finalPairs, includeMeta.checked), 'application/json');
});

downloadJsonlBtn.addEventListener('click', () => {
  if (!finalPairs || !finalPairs.length) return;
  download(`${baseName()}_dataset_${finalPairs.length}pairs.jsonl`, toJsonl(finalPairs, includeMeta.checked), 'application/jsonl');
});

// ---------- debug tools ----------
previewBtn.addEventListener('click', async () => {
  previewBtn.disabled = true;
  try {
    const { cleaned, chunks } = await getChunks();
    let t = `${cleaned.title}\nChunks: ${chunks.length}\n\n`;
    chunks.forEach((c, i) => {
      t += `#${i + 1}  ${c.id}  ${String(c.tokens).padStart(4)} tok  ${c.sectionPath}`;
      if (c.ofParts > 1) t += `  [part ${c.part}/${c.ofParts}]`;
      t += '\n';
    });
    output.textContent = t;
  } catch (err) {
    output.textContent = 'Error: ' + err.message;
  } finally {
    previewBtn.disabled = false;
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
    let t = `CHUNK #${n}: ${chunk.id} | ${chunk.sectionPath}\nPairs returned: ${result.pairs.length} | finish: ${result.finishReason}\n\n`;
    result.pairs.forEach((p, i) => {
      t += `--- Pair ${i + 1} [${p.task_type}] input verbatim: ${quoteInChunk(p.input, chunk.text) ? 'YES' : 'NO'}\n`;
      t += `Instruction: ${p.instruction}\nInput: ${p.input}\nOutput: ${p.output}\n\n`;
    });
    output.textContent = t;
  } catch (err) {
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
    output.textContent = 'Error: ' + err.message;
  } finally {
    listBtn.disabled = false;
  }
});
