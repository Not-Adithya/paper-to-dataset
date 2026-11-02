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

// Temporary display for Step 5
function renderChunks(cleaned, chunks) {
  const toks = chunks.map((c) => c.tokens);
  const avg = Math.round(toks.reduce((a, b) => a + b, 0) / toks.length);
  const over = chunks.filter((c) => c.tokens > CONFIG.maxChunkTokens).length;
  const under = chunks.filter((c) => c.tokens < CONFIG.minChunkTokens).length;
  const midSentence = chunks.filter((c) => !/[.!?]["”’)\]]?$/.test(c.text.trim())).length;

  let t = `${cleaned.title}\n`;
  t += `Chunks: ${chunks.length} | tokens: min ${Math.min(...toks)}, max ${Math.max(...toks)}, avg ${avg}\n`;
  t += `Over limit: ${over} | under minimum: ${under} | not ending on a sentence end: ${midSentence}\n\n`;

  for (const c of chunks) {
    t += `${c.id}  ${String(c.tokens).padStart(4)} tok  ${c.sectionPath}`;
    if (c.ofParts > 1) t += `  [part ${c.part}/${c.ofParts}]`;
    if (c.mergedSections.length) t += `  (+merged: ${c.mergedSections.join('; ')})`;
    t += '\n';
  }

  t += '\n' + '='.repeat(60) + '\n\n';
  for (const c of chunks) {
    t += `----- ${c.id} | ${c.sectionPath} | ${c.tokens} tok -----\n${c.text}\n\n`;
  }
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
    const chunks = chunkSections(cleaned, CONFIG);
    console.log('Cleaned:', cleaned);
    console.log('Chunks:', chunks);
    output.textContent = renderChunks(cleaned, chunks);
  } catch (err) {
    console.error(err);
    output.textContent = 'Error: ' + err.message;
  } finally {
    runBtn.disabled = false;
  }
});
