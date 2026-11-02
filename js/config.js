export const CONFIG = {
  maxChunkTokens: 1000,
  minChunkTokens: 150,
  pairsPerChunk: 3,
  schemaVersion: 1,

  // LLM (Gemini). If the model name 404s, use the "List models" button on the page.
  model: 'gemini-2.5-flash',
  temperature: 0.3,
  maxOutputTokens: 8192,
  maxRetries: 4,
  retryBaseDelayMs: 4000,

  clean: {
    smallFontRatio: 0.8,
    headingRatio: 1.17,
    titleRatio: 1.5,
    repeatPageFraction: 0.4,
    maxHeaderChars: 100,
    maxHeadingChars: 120,
    minSectionChars: 100,
    tableZoneLines: 20,
    indentMin: 4,
    indentMax: 30,
    dropSections: ['ccs concepts', 'keywords', 'index terms', 'acknowledgments', 'acknowledgements', 'acknowledgment'],
    stopSections: ['references', 'bibliography'],
  },
};
