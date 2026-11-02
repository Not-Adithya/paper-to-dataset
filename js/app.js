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

runBtn.addEventListener('click', () => {
  if (!selectedFile) {
    output.textContent = 'Choose a PDF first.';
    return;
  }
  console.log('Run clicked (pipeline not wired yet)');
});
