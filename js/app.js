import { CONFIG } from './config.js';
import { extractPdf } from './extract.js';
import { cleanAndSection } from './clean.js';
import { chunkSections } from './chunk.js';
import { generateRulePairs } from './rules.js';
import { toJson, toJsonl } from './export.js';

const $ = (id) => document.getElementById(id);
const fileInput = $('pdfFile');
const badge1 = $('badge1');
const badge2 = $('badge2');
const paperInfo = $('paperInfo');
const alertBox = $('alert');
const ruleAbstract = $('ruleAbstract');
const ruleSections = $('ruleSections');
const ruleAbbr = $('ruleAbbr');
const stage1Btn = $('stage1Btn');
const dl1Json = $('dl1Json');
const dl1Jsonl = $('dl1Jsonl');
const includeMeta = $('includeMeta');
const stage1Summary = $('stage1Summary');
const stage1Preview = $('stage1Preview');
const previewBtn = $('previewBtn');
const debugOut = $('debugOut');

let prepared = null;   // { cleaned, chunks }
let pairs1 = null;
let prepToken = 0;

// ---------- small UI helpers ----------
function setBadge(el, text, kind) {
  el.textContent = text;
  el.className = 'badge ' + kind;
}
function showAlert(msg) { alertBox.textContent = msg; alertBox.hidden = false; }
function hideAlert() { alertBox.hidden = true; }

function setDownloads(on) {
  dl1Json.disabled = !on;
  dl1Jsonl.disabled = !on;
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

const baseName = () => ((prepared && prepared.cleaned.paperId) || 'paper').replace(/[^\w.-]+/g, '_');

function renderPreview(pairs) {
  stage1Preview.textContent = '';
  pairs.forEach((p, i) => {
    const d = document.createElement('details');
    d.className = 'pair';
    d.open = i === 0;

    const s = document.createElement('summary');
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = p.meta.rule;
    s.append(tag, document.createTextNode(p.input));

    const body = document.createElement('div');
    body.className = 'pair-body';
    const label = document.createElement('strong');
    label.textContent = 'Output';
    const out = document.createElement('p');
    out.textContent = p.output;
    body.append(label, out);

    d.append(s, body);
    stage1Preview.appendChild(d);
  });
}

// ---------- step 1: prepare the paper ----------
function resetAll() {
  prepared = null;
  pairs1 = null;
  hideAlert();
  paperInfo.textContent = '';
  stage1Summary.textContent = '';
  stage1Preview.textContent = '';
  debugOut.textContent = '';
  stage1Btn.disabled = true;
  previewBtn.disabled = true;
  setDownloads(false);
  setBadge(badge2, 'Locked', 'wait');
}

async function prepare(file, token) {
  setBadge(badge1, 'Reading PDF...', 'work');
  try {
    const extracted = await extractPdf(file);
    if (token !== prepToken) return;
    const cleaned = cleanAndSection(extracted, CONFIG.clean);
    const chunks = chunkSections(cleaned, CONFIG);
    if (token !== prepToken) return;

    prepared = { cleaned, chunks };
    paperInfo.textContent =
      `${cleaned.title || '(title not found)'}\n` +
      `${extracted.pages.length} pages | ${cleaned.sections.length} sections | ${chunks.length} chunks`;

    if (!cleaned.sections.length) {
      setBadge(badge1, 'No sections found', 'err');
      showAlert('No sections were detected in this PDF. It may be scanned (image-only) or use an unusual layout.');
      return;
    }
    setBadge(badge1, 'Ready', 'ok');
    setBadge(badge2, 'Ready', 'work');
    stage1Btn.disabled = false;
    previewBtn.disabled = false;
  } catch (err) {
    if (token !== prepToken) return;
    console.error(err);
    setBadge(badge1, 'Failed', 'err');
    showAlert('Could not read this PDF: ' + err.message);
  }
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  prepToken++;
  resetAll();
  if (!file) { setBadge(badge1, 'Waiting', 'wait'); return; }
  prepare(file, prepToken);
});

// ---------- stage 1 ----------
stage1Btn.addEventListener('click', () => {
  if (!prepared) return;
  hideAlert();
  try {
    const opts = {
      abstract: ruleAbstract.checked,
      sections: ruleSections.checked,
      abbreviations: ruleAbbr.checked,
    };
    if (!opts.abstract && !opts.sections && !opts.abbreviations) throw new Error('Tick at least one rule.');

    const res = generateRulePairs(prepared.cleaned, CONFIG, opts);
    pairs1 = res.pairs;
    if (!pairs1.length) throw new Error('No pairs were produced for this paper.');

    const by = Object.entries(res.stats.byRule).map(([k, v]) => `${k}: ${v}`).join(' | ');
    stage1Summary.textContent =
      `${res.stats.total} pairs generated (${by})` +
      (res.skipped.length ? `\nSections skipped as too short: ${res.skipped.join('; ')}` : '') +
      `\nClick a pair below to see its output.`;

    renderPreview(pairs1);
    setDownloads(true);
    setBadge(badge2, `Done: ${pairs1.length} pairs`, 'ok');
  } catch (err) {
    console.error(err);
    showAlert(err.message);
  }
});

dl1Json.addEventListener('click', () => {
  if (!pairs1) return;
  download(`${baseName()}_stage1_${pairs1.length}pairs.json`, toJson(pairs1, includeMeta.checked), 'application/json');
});

dl1Jsonl.addEventListener('click', () => {
  if (!pairs1) return;
  download(`${baseName()}_stage1_${pairs1.length}pairs.jsonl`, toJsonl(pairs1, includeMeta.checked), 'application/jsonl');
});

// ---------- debug ----------
previewBtn.addEventListener('click', () => {
  if (!prepared) return;
  const { cleaned, chunks } = prepared;
  let t = `${cleaned.title}\nChunks: ${chunks.length}\n\n`;
  chunks.forEach((c, i) => {
    t += `#${i + 1}  ${String(c.tokens).padStart(4)} tok  ${c.sectionPath}`;
    if (c.ofParts > 1) t += `  [part ${c.part}/${c.ofParts}]`;
    t += '\n';
  });
  debugOut.textContent = t;
});
