import { CONFIG } from './config.js';
import { extractPdf } from './extract.js';
import { cleanAndSection } from './clean.js';
import { generateRulePairs } from './rules.js';
import { toJson, toJsonl } from './export.js';

const $ = (id) => document.getElementById(id);
const fileInput = $('pdfFile');
const statusEl = $('status');
const dlJson = $('dlJson');
const dlJsonl = $('dlJsonl');
const includeMeta = $('includeMeta');
const preview = $('preview');

let pairs = null;
let paperId = 'paper';

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.className = isError ? 'error' : '';
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

function renderPreview(list) {
  preview.textContent = '';
  list.forEach((p, i) => {
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
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  pairs = null;
  dlJson.disabled = true;
  dlJsonl.disabled = true;
  preview.textContent = '';
  if (!file) { setStatus(''); return; }

  setStatus('Reading PDF...');
  const t0 = performance.now();
  try {
    const extracted = await extractPdf(file);
    const cleaned = cleanAndSection(extracted, CONFIG.clean);
    if (!cleaned.sections.length) { const sizes = {}; for (const p of extracted.pages) for (const l of p.lines) sizes[l.fontSize] = (sizes[l.fontSize] || 0) + 1; const top = Object.entries(sizes).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s, n]) => `${s}pt x${n}`).join(', '); const sample = (extracted.pages[0]?.lines || []).slice(0, 25).map((l) => `[${l.fontSize}] ${l.text}`).join('\n'); throw new Error(`No sections found.\nLines extracted: ${cleaned.debug.linesIn} | kept: ${cleaned.debug.linesKept} | body font: ${cleaned.debug.bodyFontSize}pt | heading threshold: ${cleaned.debug.headingMin.toFixed(1)}pt\nFont sizes: ${top}\n\nFirst lines of page 1:\n${sample}`); }

    const res = generateRulePairs(cleaned, CONFIG);
    if (!res.pairs.length) throw new Error('No pairs were produced for this paper.');

    pairs = res.pairs;
    paperId = cleaned.paperId.replace(/[^\w.-]+/g, '_');
    const by = Object.entries(res.stats.byRule).map(([k, v]) => `${k}: ${v}`).join(' | ');
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    setStatus(
      `${cleaned.title || file.name}\n` +
      `${extracted.pages.length} pages -> ${pairs.length} pairs in ${secs}s (${by})` +
      (res.skipped.length ? `\nSkipped as too short: ${res.skipped.join('; ')}` : '')
    );
    renderPreview(pairs);
    dlJson.disabled = false;
    dlJsonl.disabled = false;
  } catch (err) {
    console.error(err);
    setStatus('Error: ' + err.message, true);
  }
});

dlJson.addEventListener('click', () => {
  if (pairs) download(`${paperId}_${pairs.length}pairs.json`, toJson(pairs, includeMeta.checked), 'application/json');
});

dlJsonl.addEventListener('click', () => {
  if (pairs) download(`${paperId}_${pairs.length}pairs.jsonl`, toJsonl(pairs, includeMeta.checked), 'application/jsonl');
});
