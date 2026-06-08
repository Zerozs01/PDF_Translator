const fs = require('fs');
const path = require('path');

const targetFilePath = path.join(__dirname, '../src/components/OCR/OCRTextLayerPanel.tsx');
let content = fs.readFileSync(targetFilePath, 'utf8');

console.log('Original content length:', content.length);

// 1. Add imports to the top
const importAnchor = "import { resolveMissingOverlayLineFallbackText } from './translationOverlayUtils';";
const newImports = `import { resolveMissingOverlayLineFallbackText } from './translationOverlayUtils';\nimport {\n  applyPanelSafetyLineDedup,\n  collectResidualRepeatedPanelKeys,\n  normalizePreviewText,\n  normalizePanelDedupTextKey,\n  renderPreviewTextWithHighlight\n} from '../../services/ocr/ocrSafetyLineDedup';`;

if (content.includes(importAnchor)) {
  content = content.replace(importAnchor, newImports);
  console.log('Added imports successfully.');
} else {
  console.error('Error: Could not find import anchor.');
  process.exit(1);
}

// 2. Identify the block to delete
const startAnchor = "const normalizePreviewText = (text: string): string => String(text || '').replace(/\\s+/g, ' ').trim();";
const endAnchor = ".map((item) => ({ key: item.key, count: item.count, samples: item.samples }));\r\n};";
const endAnchorLF = ".map((item) => ({ key: item.key, count: item.count, samples: item.samples }));\n};";

let startIndex = content.indexOf(startAnchor);
let endIndex = -1;

if (content.includes(endAnchor)) {
  endIndex = content.indexOf(endAnchor) + endAnchor.length;
} else if (content.includes(endAnchorLF)) {
  endIndex = content.indexOf(endAnchorLF) + endAnchorLF.length;
}

if (startIndex === -1 || endIndex === -1) {
  console.error(`Error: Could not find start (${startIndex}) or end (${endIndex}) anchors.`);
  process.exit(1);
}

console.log('Replacing block from index', startIndex, 'to', endIndex);
console.log('Deleting character count:', endIndex - startIndex);

const part1 = content.slice(0, startIndex);
const part2 = content.slice(endIndex);
content = part1 + part2;

console.log('New content length:', content.length);

fs.writeFileSync(targetFilePath, content, 'utf8');
console.log('Refactoring applied successfully to OCRTextLayerPanel.tsx!');
