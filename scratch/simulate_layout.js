const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

const appData = process.env.APPDATA || (process.platform === 'darwin'
  ? process.env.HOME + '/Library/Application Support'
  : process.env.HOME + '/.config');
const userDataPath = path.join(appData, 'pdf_translator');
app.name = 'pdf_translator';
app.setPath('userData', userDataPath);

// ==================================================
// COPY FUNCTIONS FROM translationOverlayUtils.ts
// ==================================================
const normalizeOverlayInlineText = (text) => String(text || '').replace(/\s+/g, ' ').trim();

const normalizeWhitespace = (text) => String(text || '').replace(/\s+/g, ' ').trim();

const resolveOverlayBBox = (bbox) => {
  if (!bbox) return undefined;
  const x0 = Number(bbox.x0);
  const y0 = Number(bbox.y0);
  const x1 = Number(bbox.x1);
  const y1 = Number(bbox.y1);
  if (![x0, y0, x1, y1].every(Number.isFinite)) return undefined;
  return {
    x0: Math.min(x0, x1),
    y0: Math.min(y0, y1),
    x1: Math.max(x0, x1),
    y1: Math.max(y0, y1),
  };
};

const resolveOverlaySourceBBox = (line) => {
  const lineBBox = resolveOverlayBBox(line.bbox);
  if (!lineBBox) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  const words = Array.isArray(line.words) ? line.words : [];
  const validWords = words
    .map((w) => resolveOverlayBBox(w?.bbox))
    .filter(Boolean);
  if (validWords.length === 0) return lineBBox;
  return {
    x0: Math.min(lineBBox.x0, ...validWords.map((w) => w.x0)),
    y0: Math.min(lineBBox.y0, ...validWords.map((w) => w.y0)),
    x1: Math.max(lineBBox.x1, ...validWords.map((w) => w.x1)),
    y1: Math.max(lineBBox.y1, ...validWords.map((w) => w.y1)),
  };
};

const resolveOverlayMaskBBox = (line) => {
  const sourceBbox = resolveOverlaySourceBBox(line);
  const normalizedLineBBox = resolveOverlayBBox(line.bbox);
  if (!normalizedLineBBox) return sourceBbox;
  return {
    x0: Math.min(normalizedLineBBox.x0, sourceBbox.x0),
    y0: Math.min(normalizedLineBBox.y0, sourceBbox.y0),
    x1: Math.max(normalizedLineBBox.x1, sourceBbox.x1),
    y1: Math.max(normalizedLineBBox.y1, sourceBbox.y1),
  };
};

// Mock typography computation (simulating font size calculation)
const computeOverlayTypography = (text, width, height, hints) => {
  return {
    fontSize: 16,
    lineHeight: 1.2,
    padX: 4,
    padY: 4,
    forceSingleLine: false,
    estimatedLines: Math.max(1, Math.ceil(text.length / 15)),
    contentHeight: Math.max(20, Math.ceil(text.length / 15) * 16 * 1.2),
  };
};

const resolveOverlayTextStartX = (line, bbox) => {
  return bbox.x0;
};

const resolveMedian = (values) => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) * 0.5;
};

const resolveRange = (values) => {
  if (values.length === 0) return 0;
  return Math.max(...values) - Math.min(...values);
};

const resolveLowerBandAverage = (values) => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const count = Math.max(1, Math.floor(sorted.length * 0.5));
  const subset = sorted.slice(0, count);
  return subset.reduce((sum, v) => sum + v, 0) / subset.length;
};

const resolveOverlayStyleKind = (profile, text, opts) => {
  if (opts?.boxed) return 'comic-box';
  return 'comic-bubble';
};

const resolveDocumentStyleKind = (text) => 'document-body';

const joinOverlayGroupText = (group) => {
  return group.map(item => item.text).join(' ');
};

const computeOverlayGroupGeometry = (group) => {
  if (group.length === 0) return { maxGap: 0, compactness: 0 };
  const yCenters = group.map(item => (item.bbox.y0 + item.bbox.y1) * 0.5);
  const boxHeights = group.map(item => item.bbox.y1 - item.bbox.y0);
  const avgHeight = boxHeights.reduce((sum, h) => sum + h, 0) / group.length;
  
  let maxGap = 0;
  for (let i = 0; i < yCenters.length - 1; i++) {
    const gap = (group[i+1].bbox.y0 - group[i].bbox.y1);
    if (gap > maxGap) maxGap = gap;
  }
  return {
    maxGap,
    compactness: maxGap / Math.max(1, avgHeight),
  };
};

const computeOverlayGroupColumnCoherence = (group) => {
  const widths = group.map(item => item.bbox.x1 - item.bbox.x0);
  const xCenters = group.map(item => (item.bbox.x0 + item.bbox.x1) * 0.5);
  const minOverlapX = 0.5; // dummy
  const maxCenterDelta = resolveRange(xCenters);
  const minX = Math.min(...group.map(item => item.bbox.x0));
  const maxX = Math.max(...group.map(item => item.bbox.x1));
  return {
    minOverlapX,
    maxCenterDelta,
    spanWidth: maxX - minX,
    medianWidth: resolveMedian(widths) || 100,
  };
};

const joinOverlayGroupSegments = (texts) => texts.join(' ');
const compactTextLength = (text) => text.replace(/\s+/g, '').length;

const looksDocumentLikeSourceText = (t) => false;
const looksHeadingLikeSourceLine = (t) => false;
const looksStructuredDocumentSourceLine = (t) => false;
const looksTechnicalDocumentSourceLine = (t) => false;
const looksPerLineComicFragmentSource = (t) => false;

const THAI_CHAR_REGEX = /[\u0E00-\u0E7F]/;
const CJK_CHAR_REGEX = /[\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/;

const buildGroupsForOverlayLayout = (inputs) => {
  // จำลองการจัดกลุ่ม (grouping) ใน computeOverlayLayoutMap
  // ใน code จริง มันจะจับกลุ่ม lines ที่อยู่ใกล้กันแนวตั้งในบอลลูนเดียวกัน
  // เรามาหา balloon id หรือจัดกลุ่มแบบง่ายๆ ตาม bbox
  const groups = [];
  let currentGroup = [];
  
  inputs.forEach((item, index) => {
    if (currentGroup.length === 0) {
      currentGroup.push(item);
    } else {
      const prev = currentGroup[currentGroup.length - 1];
      const gapY = item.bbox.y0 - prev.bbox.y1;
      const overlapX = Math.max(0, Math.min(prev.bbox.x1, item.bbox.x1) - Math.max(prev.bbox.x0, item.bbox.x0));
      const prevWidth = prev.bbox.x1 - prev.bbox.x0;
      const itemWidth = item.bbox.x1 - item.bbox.x0;
      const isColumnMatch = overlapX / Math.min(prevWidth, itemWidth) >= 0.35;
      
      // ถ้าอยู่ใกล้กันในแนวตั้งและเหลื่อมกันแนวนอน
      if (gapY >= -10 && gapY <= 40 && isColumnMatch) {
        currentGroup.push(item);
      } else {
        groups.push(currentGroup);
        currentGroup = [item];
      }
    }
  });
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }
  return groups;
};

const computeOverlayLayoutMapSimulated = (inputs, profile = 'manga') => {
  const computed = inputs.map((input) => ({
    ...input,
    typography: computeOverlayTypography(input.text, input.width, input.height, input.hints),
  }));
  const orderedComputed = [...computed].sort((a, b) => {
    if (a.bbox.y0 !== b.bbox.y0) return a.bbox.y0 - b.bbox.y0;
    if (a.bbox.x0 !== b.bbox.x0) return a.bbox.x0 - b.bbox.x0;
    return a.index - b.index;
  });
  
  const result = new Map();
  const groups = buildGroupsForOverlayLayout(orderedComputed);

  groups.forEach(group => {
    if (group.length === 0) return;

    const fontSizes = group.map((item) => item.typography.fontSize);
    const minFontSize = Math.min(...fontSizes);
    const maxFontSize = Math.max(...fontSizes);
    const startXs = group.map((item) => item.bbox.x0);
    const centerXs = group.map((item) => item.bbox.x0 + ((item.bbox.x1 - item.bbox.x0) * 0.5));
    const boxHeights = group.map((item) => item.bbox.y1 - item.bbox.y0);
    const maxHeight = Math.max(...boxHeights);
    const minStartX = Math.min(...startXs);
    const leftEdgeTolerance = Math.max(4, maxHeight * 0.22);
    const sharedLeftEdgeCount = startXs.filter((value) => Math.abs(value - minStartX) <= leftEdgeTolerance).length;
    const hasSharedLeftEdge = group.length >= 2 && sharedLeftEdgeCount >= Math.max(2, Math.ceil(group.length * 0.6));
    
    const effectiveProfile = profile;
    const effectiveDocumentProfile = effectiveProfile === 'official';
    const sharedCenterX = group.length >= 2 ? resolveMedian(centerXs) : undefined;
    const centerRangeLimit = Math.max(20, maxHeight * 1.5);
    const startVarianceLimit = Math.max(4, maxHeight * 0.16);
    
    const isCenteredBlock = group.length >= 2
      && resolveRange(centerXs) <= centerRangeLimit
      && (effectiveDocumentProfile ? (!hasSharedLeftEdge && resolveRange(startXs) >= startVarianceLimit) : resolveRange(startXs) >= startVarianceLimit);
    
    const defaultStyleKind = resolveOverlayStyleKind(effectiveProfile, group.map((item) => item.text).join(' '), {
      boxed: !effectiveDocumentProfile && hasSharedLeftEdge && group.length >= 2 && !isCenteredBlock,
    });
    
    const normalizedFontSize = 16;
    const alignment = isCenteredBlock ? 'center' : 'left';
    
    const allowSectionMerge = true;
    const hasBalloonMember = false;
    const mergedStyleKind = 'comic-bubble';
    const mergedText = joinOverlayGroupText(group);
    const groupGeometry = computeOverlayGroupGeometry(group);
    
    const shouldMergeAsSectionBlock = !effectiveDocumentProfile
      && allowSectionMerge
      && group.length >= 2
      && mergedStyleKind === 'comic-bubble'
      && (
        hasBalloonMember || (
          compactTextLength(mergedText) >= Math.max(8, Math.round(group.length * 3.4))
          && groupGeometry.maxGap <= 60
          && groupGeometry.compactness <= 2.95
        )
      );

    const groupColumnCoherence = computeOverlayGroupColumnCoherence(group);
    const hasStrongColumnContinuity = true;
    const overlyWideSectionSpan = false;

    const canMergeSectionBlock = shouldMergeAsSectionBlock && (hasBalloonMember || (hasStrongColumnContinuity && !overlyWideSectionSpan));

    if (canMergeSectionBlock && mergedStyleKind) {
      console.log(`\n  >> MERGING GROUP (length: ${group.length}):`);
      group.forEach(item => console.log(`     - "${item.hints.sourceText}" -> "${item.text}"`));
      
      const mergedBBox = {
        x0: Math.min(...group.map((item) => item.bbox.x0)),
        y0: Math.min(...group.map((item) => item.bbox.y0)),
        x1: Math.max(...group.map((item) => item.bbox.x1)),
        y1: Math.max(...group.map((item) => item.bbox.y1)),
      };
      
      const mergedTypographyAdjusted = computeOverlayTypography(mergedText, 300, 300, {});
      
      group.forEach((item, index) => {
        result.set(item.index, {
          typography: mergedTypographyAdjusted,
          alignment,
          effectiveProfile,
          styleKind: mergedStyleKind,
          mergedBBox,
          renderText: index === 0 ? mergedText : '',
          hidden: index !== 0,
        });
      });
    } else {
      group.forEach((item) => {
        result.set(item.index, {
          typography: item.typography,
          alignment,
          effectiveProfile,
          renderText: item.text,
          hidden: false,
          bbox: item.bbox,
        });
      });
    }
  });

  return result;
};

app.whenReady().then(function() {
  const configPath = path.join(userDataPath, 'authConfig.json');
  const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  let masterPassword = '';
  if (configData.encryptedMaster) {
    const encryptedBuffer = Buffer.from(configData.encryptedMaster, 'hex');
    masterPassword = safeStorage.decryptString(encryptedBuffer);
  }

  module.paths.push('c:/App/Electron/PDF_Translator/node_modules');
  const Database = require('better-sqlite3-multiple-ciphers');
  const dbPath = path.join(userDataPath, 'pdf_translator.db');

  try {
    const db = new Database(dbPath);
    db.pragma("cipher='sqlcipher'");
    db.pragma("key = '" + masterPassword.replace(/'/g, "''") + "'");

    const docId = 3;
    const pageNum = 25;

    const ocrRow = db.prepare('SELECT ocr_data FROM ocr_cache_engine WHERE document_id = ? AND page_number = ?').get(docId, pageNum);
    const transRow = db.prepare('SELECT translated_by_index FROM translation_cache WHERE document_id = ? AND page_number = ?').get(docId, pageNum);
    
    if (ocrRow && transRow) {
      const ocr = JSON.parse(ocrRow.ocr_data);
      const byIndex = JSON.parse(transRow.translated_by_index || '[]');
      const translatedMap = new Map();
      byIndex.forEach(item => {
        translatedMap.set(item.index, item.text);
      });

      const inputs = [];
      ocr.lines.forEach((line, index) => {
        const transText = translatedMap.get(index);
        if (!transText) return;
        const bbox = line.bbox;
        const width = bbox.x1 - bbox.x0;
        const height = bbox.y1 - bbox.y0;

        inputs.push({
          index,
          text: transText,
          width,
          height,
          bbox,
          line,
          hints: {
            sourceText: line.text,
            sourceBoxWidth: width,
            sourceBoxHeight: height,
          }
        });
      });

      const layoutMap = computeOverlayLayoutMapSimulated(inputs, 'manga');
      console.log('\n--- SIMULATED LAYOUT RESULTS ---');
      inputs.forEach(item => {
        const layout = layoutMap.get(item.index);
        console.log(`[idx:${item.index}] Source: "${item.hints.sourceText}" -> Trans: "${item.text}"`);
        console.log(`    Layout -> hidden: ${layout.hidden} | renderText: "${layout.renderText}"`);
      });
    }

    db.close();
  } catch (err) {
    console.error(err);
  }
  app.quit();
});
