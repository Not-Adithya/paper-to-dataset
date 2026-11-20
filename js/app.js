import { CONFIG } from './config.js';
import { extractPdf } from './extract.js';
import { cleanAndSection } from './clean.js';
import { generateRulePairs } from './rules.js';
import { toJson, toJsonl } from './export.js';

const $ = (id) => document.getElementById(id);
const fileInput = $('pdfFile');
const stopBtn = $('stopBtn');
const progressWrap = $('progressWrap');
const barFill = $('barFill');
const progressText = $('progressText');
const statusEl = $('status');
const fileList = $('fileList');
const dlJson = $('dlJson');
const dlJsonl = $('dlJsonl');
const includeMeta = $('includeMeta');
const preview = $('preview');
const useSections = $('useSections');
const useSentences = $('useSentences');

const PREVIEW_LIMIT = 20;
const SENTENCE_RULES = new Set(['number', 'definition', 'reason']);

let allPairs = [];
let fileCount = 0;
let stopRequested = false;

const fmt = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.className = isError ? 'error' : '';
}

function setDownloads(on) {
  dlJson.disabled = !on;
  dlJsonl.disabled = !on;
}

function download(name, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Show up to 12 sentence-level pairs first (the new rules), then fill with the rest
function pickPreview(list) {
  const sent = list.filter((p) => SENTENCE_RULES.has(p.meta.rule));
  const rest = list.filter((p) => !SENTENCE_RULES.has(p.meta.rule));
  const nSent = Math.min(12, sent.length);
  return [...sent.slice(0, nSent), ...rest.slice(0, PREVIEW_LIMIT - nSent)];
}

function renderPreview(list) {
  preview.textContent = '';
  const shown = pickPreview(list);
  shown.forEach((p, i) => {
    const d = document.createElement('details');
    d.className = 'pair';
    d.open = i === 0;
    const s = document.createElement('summary');
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = p.meta.rule;
    s.append(tag, document.createTextNode(p.input));
    const out = document.createElement('p');
    out.textContent = p.output;
    d.append(s, out);
    preview.appendChild(d);
  });
  if (list.length > shown.length) {
    const more = document.createElement('p');
    more.textContent = `Showing ${shown.length} of ${list.length} pairs. The download has all of them.`;
    preview.appendChild(more);
  }
}

function addRow(text, cls) {
  const li = document.createElement('li');
  li.textContent = text;
  li.className = cls;
  fileList.appendChild(li);
  fileList.scrollTop = fileList.scrollHeight;
  return li;
}

function setProgress(done, total, t0, label) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  barFill.style.width = pct + '%';
  const elapsed = Date.now() - t0;
  const eta = done > 0 ? (elapsed / done) * (total - done) : null;
  progressText.textContent =
    `File ${Math.min(done + 1, total)}/${total} (${pct}% done) | pairs so far: ${allPairs.length} | ` +
    `elapsed ${fmt(elapsed)}${eta !== null ? ` | ETA ~${fmt(eta)}` : ''}` +
    (label ? `\n${label}` : '');
}

async function processFile(file, opts) {
  const extracted = await extractPdf(file);
  const cleaned = cleanAndSection(extracted, CONFIG.clean);
  if (!cleaned.sections.length) {
    throw new Error('no sections found (scanned PDF or unusual layout)');
  }
  const res = generateRulePairs(cleaned, CONFIG, opts);
  if (!res.pairs.length) throw new Error('no pairs produced');
  return { pairs: res.pairs, pages: extracted.pages.length, byRule: res.stats.byRule };
}

async function runBatch(files) {
  const sec = useSections.checked;
  const opts = { abstract: sec, sections: sec, abbreviations: sec, sentences: useSentences.checked };

  allPairs = [];
  fileCount = 0;
  stopRequested = false;
  fileList.textContent = '';
  preview.textContent = '';
  setDownloads(false);
  setStatus('');
  progressWrap.hidden = false;
  fileInput.disabled = true;
  stopBtn.disabled = false;

  const t0 = Date.now();
  const totals = {};
  let ok = 0;
  let failed = 0;
  let done = 0;

  for (const file of files) {
    if (stopRequested) break;
    setProgress(done, files.length, t0, `Reading ${file.name}...`);
    const row = addRow(`${file.name}: reading...`, 'work');
    const f0 = performance.now();
    try {
      const r = await processFile(file, opts);
      allPairs.push(...r.pairs);
      for (const [k, v] of Object.entries(r.byRule)) totals[k] = (totals[k] || 0) + v;
      ok++;
      row.textContent = `${file.name}: ${r.pairs.length} pairs (${r.pages} pages, ${((performance.now() - f0) / 1000).toFixed(1)}s)`;
      row.className = 'ok';
    } catch (err) {
      console.error(file.name, err);
      failed++;
      row.textContent = `${file.name}: FAILED, ${err.message}`;
      row.className = 'fail';
    }
    done++;
    fileCount = ok;
    setProgress(done, files.length, t0, '');
  }

  barFill.style.width = Math.round((done / files.length) * 100) + '%';
  progressText.textContent = stopRequested ? 'Stopped.' : 'Finished.';
  fileInput.disabled = false;
  stopBtn.disabled = true;
  stopBtn.textContent = 'Stop';

  const byRule = Object.entries(totals).map(([k, v]) => `${k}: ${v}`).join(' | ');
  setStatus(
    `${files.length} file${files.length === 1 ? '' : 's'} selected | ${done} processed: ${ok} ok, ${failed} failed` +
    (stopRequested ? `, ${files.length - done} skipped (stopped)` : '') +
    ` | ${allPairs.length} pairs total | ${fmt(Date.now() - t0)}` +
    (byRule ? `\nBy rule: ${byRule}` : ''),
    ok === 0
  );

  if (allPairs.length) {
    renderPreview(allPairs);
    setDownloads(true);
  }
}

fileInput.addEventListener('change', () => {
  const files = [...fileInput.files].filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
  if (!files.length) return;
  fileInput.value = ''; // lets you pick the same files again with different options
  if (!useSections.checked && !useSentences.checked) {
    setStatus('Tick at least one pair type.', true);
    return;
  }
  runBatch(files).catch((err) => {
    console.error(err);
    setStatus('Error: ' + err.message, true);
    fileInput.disabled = false;
    stopBtn.disabled = true;
  });
});

stopBtn.addEventListener('click', () => {
  stopRequested = true;
  stopBtn.disabled = true;
  stopBtn.textContent = 'Stopping after this file...';
});

dlJson.addEventListener('click', () => {
  if (!allPairs.length) return;
  download(`dataset_${fileCount}papers_${allPairs.length}pairs.json`, toJson(allPairs, includeMeta.checked), 'application/json');
});

dlJsonl.addEventListener('click', () => {
  if (!allPairs.length) return;
  download(`dataset_${fileCount}papers_${allPairs.length}pairs.jsonl`, toJsonl(allPairs, includeMeta.checked), 'application/jsonl');
});
