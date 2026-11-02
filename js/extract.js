// Step 3: PDF -> pages of lines { text, fontSize, x, y }
// Uses pdf.js loaded from a CDN. No DOM access in this file.

const PDFJS_VERSION = '4.4.168';
const PDFJS_BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;

let pdfjsPromise = null;
function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(`${PDFJS_BASE}/pdf.min.mjs`).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.mjs`;
      return lib;
    });
  }
  return pdfjsPromise;
}

// Group text items into rows that share (roughly) the same baseline.
function groupIntoRows(items) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.y - it.y) <= Math.max(2, it.size * 0.4)) {
      row.items.push(it);
    } else {
      rows.push({ y: it.y, items: [it] });
    }
  }
  rows.forEach((r) => r.items.sort((a, b) => a.x - b.x));
  return rows;
}

function joinItems(items) {
  let text = '';
  let prevEnd = null;
  for (const it of items) {
    if (prevEnd !== null) {
      const gap = it.x - prevEnd;
      if (gap > it.size * 0.15 && !text.endsWith(' ') && !it.str.startsWith(' ')) {
        text += ' ';
      }
    }
    text += it.str;
    prevEnd = it.x + it.w;
  }
  return text.replace(/\s+/g, ' ').trim();
}

function makeLine(items) {
  // Font size = size of the item with the most characters
  const main = items.reduce((a, b) => (b.str.length > a.str.length ? b : a));
  return {
    text: joinItems(items),
    fontSize: Math.round(main.size * 10) / 10,
    x: Math.round(items[0].x),
    y: Math.round(items[0].y),
  };
}

// Is there a gap in this row near the page middle (the column gutter)?
function findGutter(items, mid) {
  for (let i = 0; i < items.length - 1; i++) {
    const end = items[i].x + items[i].w;
    const nextStart = items[i + 1].x;
    if (nextStart - end >= 12 && end < mid + 20 && nextStart > mid - 20) {
      return i + 1; // index where the right column starts
    }
  }
  return -1;
}

function classifyRow(items, mid) {
  const cut = findGutter(items, mid);
  if (cut !== -1) return { kind: 'split', cut };
  const last = items[items.length - 1];
  if (last.x + last.w <= mid + 10) return { kind: 'left' };
  if (items[0].x >= mid - 10) return { kind: 'right' };
  return { kind: 'full' };
}

function buildLines(items, pageWidth) {
  const rows = groupIntoRows(items);
  const mid = pageWidth / 2;
  const classified = rows.map((r) => ({ row: r, ...classifyRow(r.items, mid) }));

  // Treat the page as two-column only if several rows show a gutter
  const splitCount = classified.filter((c) => c.kind === 'split').length;
  if (splitCount < 5) {
    return rows.map((r) => makeLine(r.items));
  }

  const out = [];
  let band = { left: [], right: [] };
  const flush = () => {
    out.push(...band.left, ...band.right);
    band = { left: [], right: [] };
  };

  for (const c of classified) {
    if (c.kind === 'full') {
      flush();
      out.push(makeLine(c.row.items));
    } else if (c.kind === 'split') {
      band.left.push(makeLine(c.row.items.slice(0, c.cut)));
      band.right.push(makeLine(c.row.items.slice(c.cut)));
    } else if (c.kind === 'left') {
      band.left.push(makeLine(c.row.items));
    } else {
      band.right.push(makeLine(c.row.items));
    }
  }
  flush();
  return out;
}

export async function extractPdf(file) {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;

  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    const items = content.items
      .filter((it) => it.str && it.str.trim() !== '')
      .map((it) => ({
        str: it.str,
        x: it.transform[4],
        y: it.transform[5],
        w: it.width,
        size: Math.hypot(it.transform[0], it.transform[1]),
      }));

    pages.push({
      pageNumber: n,
      width: viewport.width,
      height: viewport.height,
      lines: buildLines(items, viewport.width),
    });
  }

  return {
    paperId: file.name.replace(/\.pdf$/i, ''),
    source: { type: 'upload', fileName: file.name },
    pages,
  };
}
