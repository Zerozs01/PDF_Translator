const fs = require('fs');
const path = require('path');

const targetFilePath = path.join(__dirname, '../src/App.tsx');
let content = fs.readFileSync(targetFilePath, 'utf8');

console.log('Original App.tsx length:', content.length);

// 1. Add imports to the top
const importAnchor = "import { buildLayerGroupsFromOCR } from './services/layers/LayerGroupingService';";
const newImports = `import { buildLayerGroupsFromOCR } from './services/layers/LayerGroupingService';\nimport {\n  translateBatchOffline,\n  shouldSkipOverlayForUntranslatedCarryOver,\n  shouldUseDocumentCoverageFallback,\n  clampOverlayTypographyScale,\n  scaleOverlayTypography,\n  readPersistedBooleanFlag,\n  isBalloonAwareGroupingEnabled,\n  isLayoutGroupingDebugEnabled,\n  resolveOverlayExportScale,\n  shouldRetryLineTranslation,\n  getTranslationScriptStats,\n  evaluateUntranslatedTranslation,\n  evaluateThaiCarryoverForEnglish,\n  scoreTranslationCandidate,\n  lookupShortPhraseTh\n} from './services/translation/offlineTranslationService';`;

if (content.includes(importAnchor)) {
  content = content.replace(importAnchor, newImports);
  console.log('Added imports successfully to App.tsx.');
} else {
  console.error('Error: Could not find import anchor in App.tsx.');
  process.exit(1);
}

// 2. Identify and remove Helper Block 1 (Document coverage & Typography scaling)
// Starts with: const shouldUseDocumentCoverageFallback =
// Ends with: resolveOverlayExportScale function block
const helper1StartStr = 'const shouldUseDocumentCoverageFallback = (sourceText: string): boolean => {';
const helper1EndStr = 'return Math.min(3, Math.max(1.5, deviceRatio, sourceRatio));\r\n};';
const helper1EndStrLF = 'return Math.min(3, Math.max(1.5, deviceRatio, sourceRatio));\n};';

let h1Start = content.indexOf(helper1StartStr);
let h1End = -1;
if (content.includes(helper1EndStr)) {
  h1End = content.indexOf(helper1EndStr) + helper1EndStr.length;
} else if (content.includes(helper1EndStrLF)) {
  h1End = content.indexOf(helper1EndStrLF) + helper1EndStrLF.length;
}

if (h1Start !== -1 && h1End !== -1) {
  content = content.slice(0, h1Start) + content.slice(h1End);
  console.log('Removed Typography & Layout helper block (Helper 1).');
} else {
  console.error(`Error: Could not find Helper 1 boundaries: start=${h1Start}, end=${h1End}`);
  process.exit(1);
}

// 3. Identify and remove Helper Block 2 (Offline Translation methods & ARGOS_SHORT_PHRASE_LOOKUP_TH)
// Starts with: const OFFLINE_PIVOT_SOURCE_LANGUAGES =
// Ends with: translateBatchOffline function block
const helper2StartStr = 'const OFFLINE_PIVOT_SOURCE_LANGUAGES = new Set(';
const helper2EndStr = 'return finalDirectTranslations;\r\n  }\r\n}';
const helper2EndStrLF = 'return finalDirectTranslations;\n  }\n}';

let h2Start = content.indexOf(helper2StartStr);
let h2End = -1;
if (content.includes(helper2EndStr)) {
  h2End = content.indexOf(helper2EndStr) + helper2EndStr.length;
} else if (content.includes(helper2EndStrLF)) {
  h2End = content.indexOf(helper2EndStrLF) + helper2EndStrLF.length;
}

if (h2Start !== -1 && h2End !== -1) {
  content = content.slice(0, h2Start) + content.slice(h2End);
  console.log('Removed Translation Batch & Pivot helper block (Helper 2).');
} else {
  console.error(`Error: Could not find Helper 2 boundaries: start=${h2Start}, end=${h2End}`);
  process.exit(1);
}

// 4. Identify and remove Helper Block 3 (shouldSkipOverlayForUntranslatedCarryOver & isSourceFallbackOverlayText)
// Starts with: const shouldSkipOverlayForUntranslatedCarryOver =
// Ends with: isSourceFallbackOverlayText block
const helper3StartStr = 'const shouldSkipOverlayForUntranslatedCarryOver = (';
const helper3EndStr = 'return Boolean(source && translated && source === translated);\r\n};';
const helper3EndStrLF = 'return Boolean(source && translated && source === translated);\n};';

let h3Start = content.indexOf(helper3StartStr);
let h3End = -1;
if (content.includes(helper3EndStr)) {
  h3End = content.indexOf(helper3EndStr) + helper3EndStr.length;
} else if (content.includes(helper3EndStrLF)) {
  h3End = content.indexOf(helper3EndStrLF) + helper3EndStrLF.length;
}

if (h3Start !== -1 && h3End !== -1) {
  content = content.slice(0, h3Start) + content.slice(h3End);
  console.log('Removed Carryover check helper block (Helper 3).');
} else {
  console.error(`Error: Could not find Helper 3 boundaries: start=${h3Start}, end=${h3End}`);
  process.exit(1);
}

// 5. Identify and remove Helper Block 4 (shouldRetryLineTranslation, getTranslationScriptStats, evaluateUntranslatedTranslation, evaluateThaiCarryoverForEnglish, shouldRetryGroupTranslation, scoreTranslationCandidate)
// Starts with: const shouldRetryLineTranslation =
// Ends with: scoreTranslationCandidate block
const helper4StartStr = 'const shouldRetryLineTranslation = (';
const helper4EndStr = 'return score;\r\n};';
const helper4EndStrLF = 'return score;\n};';

let h4Start = content.indexOf(helper4StartStr);
let h4End = -1;
if (content.includes(helper4EndStr)) {
  h4End = content.indexOf(helper4EndStr) + helper4EndStr.length;
} else if (content.includes(helper4EndStrLF)) {
  h4End = content.indexOf(helper4EndStrLF) + helper4EndStrLF.length;
}

if (h4Start !== -1 && h4End !== -1) {
  content = content.slice(0, h4Start) + content.slice(h4End);
  console.log('Removed Retry & Quality assessment helper block (Helper 4).');
} else {
  console.error(`Error: Could not find Helper 4 boundaries: start=${h4Start}, end=${h4End}`);
  process.exit(1);
}

console.log('Final App.tsx length:', content.length);

fs.writeFileSync(targetFilePath, content, 'utf8');
console.log('Refactoring applied successfully to App.tsx!');
