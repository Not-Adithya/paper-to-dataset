export const CONFIG = {
  maxChunkTokens: 1000,
  minChunkTokens: 150,
  pairsPerChunk: 3,          // fallback only; each run sets this per chunk
  schemaVersion: 1,

  // LLM (Gemini). The Model box on the page overrides this.
  model: 'gemini-3.8-flash',
  temperature: 0.3,
  maxOutputTokens: 8192,
  maxRetries: 4,
  retryBaseDelayMs: 4000,

  // Dataset run
  defaultTargetPairs: 60,
  maxPairsPerChunk: 8,       // quality cap per chunk
  overRequestFactor: 1.3,    // ask for 30% extra to survive validation
  defaultDelaySeconds: 5,    // pause between requests (free-tier friendly)
  assumedRequestSec: 8,      // used only for the time estimate before the first result
  checkNumbers: true,        // reject pairs whose output has numbers not in the source

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
