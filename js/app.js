import { CONFIG } from './config.js';
import { extractPdf } from './extract.js';
import { cleanAndSection } from './clean.js';
import { chunkSections } from './chunk.js';
import { generatePairs } from './generate.js';
import { validatePairs } from './validate.js';

console.log('Modules loaded', CONFIG);

const fileInput = document.getElementById('pdfFile');
const runBtn = document.getElementById('runBtn');
const output = document.getElementById('output');

let selectedFile = null;

fileInput.addEventListener('change', () => {
  selectedFile = fileInput.files[0] || null;
  if (selectedFile) {
    console.log('File chosen:', selectedFile.name, selectedFile.size, 'bytes');
    output.textContent = `Selected: ${selectedFile.name}`;
  }
});

// Temporary display for Step 4
function renderCleaned(c) {
  const d = c.debug;
  let t = `TITLE: ${c.title || '(not found)'}\n`;
  t += `Body font: ${d.bodyFontSize}pt | heading threshold: ${d.headingMin.toFixed(1)}pt\n`;
  t += `Lines in: ${d.linesIn} | kept: ${d.linesKept}\n`;
  t += `Stopped at: ${d.stoppedAt || '(no references heading found)'}\n\n`;

  t += 'DROPPED (count + examples):\n';
  for (const [kind, n] of Object.entries(d.stats)) {
    t += `  ${kind}: ${n}\n`;
    for (const s of d.samples[kind]) t += `      - ${s.slice(0, 90)}\n`;
  }
  t += `Dropped sections: ${d.droppedSections.join(' | ') || '(none)'}\n\n`;

  t += `SECTIONS KEPT: ${c.sections.length}\n`;
  c.sections.forEach((s, i) => {
    t += `  ${String(i + 1).padStart(2)}. ${'  '.repeat(s.level - 1)}${s.title}  (${s.text.length} chars)\n`;
  });
  t += '\n' + '='.repeat(60) + '\n\n';
  for (const s of c.sections) t += `## ${s.title}\n${s.text}\n\n`;
  return t;
}

runBtn.addEventListener('click', async () => {
  if (!selectedFile) {
    output.textContent = 'Choose a PDF first.';
    return;
  }
  runBtn.disabled = true;
  output.textContent = 'Working...';
  try {
    const extracted = await extractPdf(selectedFile);
    const cleaned = cleanAndSection(extracted, CONFIG.clean);
    console.log('Extracted:', extracted);
    console.log('Cleaned:', cleaned);
    output.textContent = renderCleaned(cleaned);
  } catch (err) {
    console.error(err);
    output.textContent = 'Error: ' + err.message;
  } finally {
    runBtn.disabled = false;
  }
});
