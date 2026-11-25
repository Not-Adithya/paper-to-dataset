export const CONFIG = {
  schemaVersion: 2,

  rules: {
    minSectionChars: 300,    // sections shorter than this get no pair
    maxOutputChars: 3000,    // a section answer is clipped to this length (first part only)
    maxSymbolRatio: 0.03,    // sections with more equation/symbol junk than this are skipped
  },

  sentences: {
    minChars: 50,
    maxChars: 350,
    minWords: 8,
    maxNumberPerSection: 2,
    maxDefinitionPerSection: 4,
    maxReasonPerSection: 3,
  },

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
    // a section is dropped when its heading equals or starts with one of these
    dropSections: [
      'ccs concepts', 'keywords', 'index terms',
      'acknowledg', 'author contributions', 'authors contributions', 'funding', 'data availability',
      'conflict of interest', 'conflicts of interest', 'institutional review board', 'informed consent',
      'declaration', 'supplementary', 'abbreviations', 'ethics', 'publisher', 'disclosure',
      'credit', 'competing', 'author information',
    ],
    stopSections: ['references', 'bibliography'],
  },
};
