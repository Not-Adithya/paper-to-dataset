export const CONFIG = {
  maxChunkTokens: 1000,
  minChunkTokens: 150,
  schemaVersion: 2,

  // Stage 1 (rule-based)
  rules: {
    minSectionChars: 300,   // sections shorter than this get no pair
    maxOutputChars: 5000,   // longer sections are split into parts
  },

  // Stage 2 settings (used in the next step)
  pairsPerChunk: 3,
  model: 'gemini-3.8-flash',
  temperature: 0.3,
  maxOutputTokens: 8192,
  maxRetries: 3,
  retryBaseDelayMs: 10000,
  requestTimeoutMs: 60000,
  fallbackModels: [],

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
