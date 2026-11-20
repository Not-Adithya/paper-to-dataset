export const CONFIG = {
  schemaVersion: 2,

  rules: {
    minSectionChars: 300,   // sections shorter than this get no pair
    maxOutputChars: 5000,   // longer sections are split into parts
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
    dropSections: ['ccs concepts', 'keywords', 'index terms', 'acknowledgments', 'acknowledgements', 'acknowledgment'],
    stopSections: ['references', 'bibliography'],
  },
};
