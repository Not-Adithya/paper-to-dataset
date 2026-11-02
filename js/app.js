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

// Temporary display for Step 3: shows [fontSize] before each line
function renderExtracted(extracted) {
  const totalLines = extracted.pages.reduce((n, p) => n + p.lines.length, 0);
  let text = `${extracted.paperId}: ${extracted.pages.length} pages, ${totalLines} lines\n\n`;
  for (const page of extracted.pages) {
    text += `===== Page ${page.pageNumber} =====\n`;
    for (const line of page.lines) {
      text += `[${line.fontSize}] ${line.text}\n`;
    }
    text += '\n';
  }
  return text;
}

runBtn.addEventListener('click', async () => {
  if (!selectedFile) {
    output.textContent = 'Choose a PDF first.';
    return;
  }
  runBtn.disabled = true;
  output.textContent = 'Extracting...';
  try {
    const extracted = await extractPdf(selectedFile);
    console.log('Extracted:', extracted);
    output.textContent = renderExtracted(extracted);
  } catch (err) {
    console.error(err);
    output.textContent = 'Error: ' + err.message;
  } finally {
    runBtn.disabled = false;
  }
});
