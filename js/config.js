export const CONFIG = {
  maxChunkTokens: 1000,
  pairsPerChunk: 3,
  model: 'TBD',
  promptVersion: 'v1',
  schemaVersion: 1,

  clean: {
    smallFontRatio: 0.8,      // lines smaller than this x body size = footnotes, refs, legal text
    headingRatio: 1.17,       // lines at least this x body size can be headings
    titleRatio: 1.5,          // page-1 text this x body size, before the first section = title
    repeatPageFraction: 0.4,  // short line repeated on this fraction of pages = running header/footer
    maxHeaderChars: 100,
    maxHeadingChars: 120,
    minSectionChars: 100,     // shorter sections are dropped (stray author lines etc.)
    tableZoneLines: 20,       // after a "Table N:" caption, how many lines to scan for table headers
    indentMin: 4,             // paragraph-start indent range, in PDF points
    indentMax: 30,
    dropSections: ['ccs concepts', 'keywords', 'index terms', 'acknowledgments', 'acknowledgements', 'acknowledgment'],
    stopSections: ['references', 'bibliography'],
  },
};
