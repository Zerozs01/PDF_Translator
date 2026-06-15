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

const normalizeOverlayBBox = (bbox) => {
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
  const lineBBox = normalizeOverlayBBox(line.bbox);
  if (!lineBBox) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  const words = Array.isArray(line.words) ? line.words : [];
  const validWords = words
    .map((w) => normalizeOverlayBBox(w?.bbox))
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
  const normalizedLineBBox = normalizeOverlayBBox(line.bbox);
  if (!normalizedLineBBox) return sourceBbox;
  return {
    x0: Math.min(normalizedLineBBox.x0, sourceBbox.x0),
    y0: Math.min(normalizedLineBBox.y0, sourceBbox.y0),
    x1: Math.max(normalizedLineBBox.x1, sourceBbox.x1),
    y1: Math.max(normalizedLineBBox.y1, sourceBbox.y1),
  };
};

const overlayBBoxWidth = (box) => Math.max(0, box.x1 - box.x0);
const overlayBBoxHeight = (box) => Math.max(0, box.y1 - box.y0);
const overlayBBoxArea = (box) => overlayBBoxWidth(box) * overlayBBoxHeight(box);
const overlayBBoxCenterX = (box) => box.x0 + overlayBBoxWidth(box) * 0.5;
const overlayBBoxCenterY = (box) => box.y0 + overlayBBoxHeight(box) * 0.5;

const overlayBBoxOverlapRatioX = (a, b) => {
  const inter = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const union = Math.max(a.x1, b.x1) - Math.min(a.x0, b.x0);
  return inter / Math.max(1, union);
};

const overlayBBoxOverlapRatioY = (a, b) => {
  const inter = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const union = Math.max(a.y1, b.y1) - Math.min(a.y0, b.y0);
  return inter / Math.max(1, union);
};

const overlayBBoxIoU = (a, b) => {
  const interX0 = Math.max(a.x0, b.x0);
  const interY0 = Math.max(a.y0, b.y0);
  const interX1 = Math.min(a.x1, b.x1);
  const interY1 = Math.min(a.y1, b.y1);
  if (interX1 <= interX0 || interY1 <= interY0) return 0;
  const interArea = (interX1 - interX0) * (interY1 - interY0);
  const areaA = overlayBBoxArea(a);
  const areaB = overlayBBoxArea(b);
  const unionArea = areaA + areaB - interArea;
  return interArea / Math.max(1, unionArea);
};

const shouldSuppressOverlappingOverlayBorder = (a, b) => {
  const iou = overlayBBoxIoU(a, b);
  if (iou >= 0.72) return true;
  const overlapX = overlayBBoxOverlapRatioX(a, b);
  const overlapY = overlayBBoxOverlapRatioY(a, b);
  if (overlapX >= 0.88 && overlapY >= 0.68) return true;
  if (overlapY >= 0.88 && overlapX >= 0.68) return true;
  return false;
};

const computeOverlayInputWordCoverage = (input, bbox) => {
  return 0.5; // dummy
};

const isDocumentLikeOverlaySuppressionInput = (input) => false;

const normalizeTranslatedOverlayDuplicateKey = (text) =>
  normalizeWhitespace(String(text || ''))
    .toUpperCase()
    .replace(/[^A-Z0-9\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]+/g, '')
    .replace(/0/g, 'O')
    .replace(/1/g, 'I')
    .replace(/5/g, 'S');

const overlayKeyDiceSimilarity = (a, b) => {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (val) => {
    const s = new Set();
    if (val.length < 2) { s.add(val); return s; }
    for (let i = 0; i < val.length - 1; i++) s.add(val.slice(i, i+2));
    return s;
  };
  const aSet = grams(a); const bSet = grams(b);
  if (aSet.size === 0 || bSet.size === 0) return 0;
  let overlap = 0;
  for (const g of aSet) if (bSet.has(g)) overlap++;
  return (2 * overlap) / (aSet.size + bSet.size);
};

const buildOverlaySuppressionTextKey = (layout, input) => {
  return normalizeTranslatedOverlayDuplicateKey(layout.renderText || input.text || '');
};

const scoreOverlayVisibilityCandidate = (layout, input, bbox) => {
  const area = overlayBBoxArea(bbox);
  const textLen = (layout.renderText || '').length;
  const confidence = input.line?.confidence || 85;
  return textLen * 1.5 + confidence + Math.log10(area) * 2.5;
};

// นำเข้า logic suppressOverlappingOverlayBorders ตัวจริง
const suppressOverlappingOverlayBorders = (
  layoutMap,
  orderedInputs
) => {
  if (layoutMap.size <= 1 || orderedInputs.length <= 1) {
    return layoutMap;
  }

  const inputByIndex = new Map(
    orderedInputs.map((item) => [item.index, item])
  );

  const candidates = Array.from(layoutMap.entries())
    .map(([index, layout]) => {
      if (layout.hidden) return null;
      const input = inputByIndex.get(index);
      if (!input) return null;
      const bbox = normalizeOverlayBBox(layout.mergedBBox || input.bbox);
      if (!bbox || (bbox.x1 - bbox.x0) <= 0 || (bbox.y1 - bbox.y0) <= 0) return null;

      return {
        index,
        bbox,
        layout,
        input,
        textKey: buildOverlaySuppressionTextKey(layout, input),
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.bbox.y0 !== b.bbox.y0) return a.bbox.y0 - b.bbox.y0;
      if (a.bbox.x0 !== b.bbox.x0) return a.bbox.x0 - b.bbox.x0;
      return a.index - b.index;
    });

  if (candidates.length <= 1) return layoutMap;

  const next = new Map(layoutMap);
  const kept = [];

  const shouldSuppressOverlayCandidate = (existing, candidate) => {
    const overlapX = overlayBBoxOverlapRatioX(existing.bbox, candidate.bbox);
    const overlapY = overlayBBoxOverlapRatioY(existing.bbox, candidate.bbox);
    const iou = overlayBBoxIoU(existing.bbox, candidate.bbox);
    const minWidth = Math.max(18, Math.min(overlayBBoxWidth(existing.bbox), overlayBBoxWidth(candidate.bbox)));
    const minHeight = Math.max(8, Math.min(overlayBBoxHeight(existing.bbox), overlayBBoxHeight(candidate.bbox)));
    const centerDeltaX = Math.abs(overlayBBoxCenterX(existing.bbox) - overlayBBoxCenterX(candidate.bbox));
    const centerDeltaY = Math.abs(overlayBBoxCenterY(existing.bbox) - overlayBBoxCenterY(candidate.bbox));
    const verticalGap = Math.max(
      0,
      Math.max(existing.bbox.y0, candidate.bbox.y0) - Math.min(existing.bbox.y1, candidate.bbox.y1)
    );
    const existingCoverage = computeOverlayInputWordCoverage(existing.input, existing.bbox);
    const candidateCoverage = computeOverlayInputWordCoverage(candidate.input, candidate.bbox);
    const dominantCoverage = Math.max(existingCoverage, candidateCoverage);
    const weakCoverage = Math.min(existingCoverage, candidateCoverage);
    const areaRatio = Math.max(overlayBBoxArea(existing.bbox), overlayBBoxArea(candidate.bbox))
      / Math.max(1, Math.min(overlayBBoxArea(existing.bbox), overlayBBoxArea(candidate.bbox)));
    const maxArea = Math.max(overlayBBoxArea(existing.bbox), overlayBBoxArea(candidate.bbox));
    
    const documentLikePair = false;
    const existingSourceKey = normalizeTranslatedOverlayDuplicateKey(
      existing.input.line?.text || existing.input.hints?.sourceText || ''
    );
    const candidateSourceKey = normalizeTranslatedOverlayDuplicateKey(
      candidate.input.line?.text || candidate.input.hints?.sourceText || ''
    );
    const sourceMinLength = Math.min(existingSourceKey.length, candidateSourceKey.length);
    const sourceSameOrSubset = sourceMinLength >= 8 && (
      existingSourceKey === candidateSourceKey
      || existingSourceKey.includes(candidateSourceKey)
      || candidateSourceKey.includes(existingSourceKey)
    );
    const sourceSimilarity = (existingSourceKey && candidateSourceKey)
      ? overlayKeyDiceSimilarity(existingSourceKey, candidateSourceKey)
      : 0;
    const stackedSourceEcho = (
      existingSourceKey.length > 0
      && candidateSourceKey.length > 0
      && (sourceSameOrSubset || sourceSimilarity >= 0.9)
      && areaRatio <= 2.8
      && overlapX >= 0.74
      && centerDeltaX <= Math.max(78, minWidth * 1.06)
      && centerDeltaY <= Math.max(132, minHeight * 4.4)
      && (overlapY >= 0.01 || iou >= 0.02 || verticalGap <= Math.max(14, minHeight * 0.62))
      && sourceSimilarity >= 0.94
    );

    const displacedCoverageEcho = (
      overlapX >= 0.62
      && (overlapY >= 0.16 || iou >= 0.08)
      && centerDeltaX <= Math.max(116, minWidth * 1.72)
      && centerDeltaY <= Math.max(138, minHeight * 4.6)
      && areaRatio >= 1.32
      && (dominantCoverage - weakCoverage) >= 0.16
      && weakCoverage <= 0.44
      && (maxArea >= 9000 || iou >= 0.22)
    );
    const baselineOverlapCollision = shouldSuppressOverlappingOverlayBorder(existing.bbox, candidate.bbox);

    if (!baselineOverlapCollision && !displacedCoverageEcho && !stackedSourceEcho) return false;

    if (iou >= 0.82) return true;

    if (displacedCoverageEcho) {
      const hasHighDifference = (existingSourceKey && candidateSourceKey)
        ? overlayKeyDiceSimilarity(existingSourceKey, candidateSourceKey) < 0.28
        : false;
      if (!hasHighDifference) {
        return true;
      }
    }

    if (stackedSourceEcho) {
      return true;
    }

    if (!documentLikePair) {
      const textSimilarity = overlayKeyDiceSimilarity(existing.textKey, candidate.textKey);
      const separateSourceStack = Boolean(existingSourceKey && candidateSourceKey && existingSourceKey !== candidateSourceKey)
        && overlapX >= 0.42
        && overlapY <= 0.78
        && centerDeltaY >= Math.max(12, minHeight * 0.45)
        && centerDeltaY <= Math.max(96, minHeight * 4.5)
        && iou < 0.68;
      if (separateSourceStack && textSimilarity < 0.84 && sourceSimilarity < 0.82) {
        return false;
      }
      const verticallyDistinctStack = centerDeltaY > Math.max(22, minHeight * 1.05);
      if (verticallyDistinctStack && iou < 0.58 && textSimilarity < 0.76 && sourceSimilarity < 0.72) {
        return false;
      }
    }

    if (existingSourceKey && candidateSourceKey) {
      const minSourceLength = Math.min(existingSourceKey.length, candidateSourceKey.length);
      const sourceSameOrSubset = minSourceLength >= 6 && (
        existingSourceKey.includes(candidateSourceKey)
        || candidateSourceKey.includes(existingSourceKey)
      );
      if (sourceSameOrSubset && iou >= 0.34) return true;

      if (sourceSimilarity >= 0.82 && iou >= 0.4) return true;

      if (!sourceSameOrSubset && sourceSimilarity < 0.58 && iou < 0.62) {
        return false;
      }
    }

    if (!existing.textKey || !candidate.textKey) {
      return iou >= 0.58;
    }

    if (existing.textKey === candidate.textKey) {
      return iou >= 0.15 || (overlapX >= 0.4 && overlapY >= 0.4);
    }

    const minLength = Math.min(existing.textKey.length, candidate.textKey.length);
    const sameOrSubset = minLength >= 6 && (
      existing.textKey.includes(candidate.textKey)
      || candidate.textKey.includes(existing.textKey)
    );
    if (sameOrSubset) {
      return iou >= 0.15 || (overlapX >= 0.4 && overlapY >= 0.4);
    }

    const textSimilarity = overlayKeyDiceSimilarity(existing.textKey, candidate.textKey);
    if (textSimilarity >= 0.9) {
      return iou >= 0.15 || (overlapX >= 0.4 && overlapY >= 0.4);
    }
    if (textSimilarity >= 0.74 && iou >= 0.44) return true;

    return false;
  };

  for (const candidate of candidates) {
    const existingIndex = kept.findIndex((existing) => shouldSuppressOverlayCandidate(existing, candidate));

    if (existingIndex < 0) {
      kept.push(candidate);
      continue;
    }

    const existing = kept[existingIndex];
    const existingScore = scoreOverlayVisibilityCandidate(existing.layout, existing.input, existing.bbox);
    const candidateScore = scoreOverlayVisibilityCandidate(candidate.layout, candidate.input, candidate.bbox);

    console.log(`    Collision in Suppress! "${candidate.input.hints.sourceText}" (Score: ${candidateScore.toFixed(2)}) conflicts with "${existing.input.hints.sourceText}" (Score: ${existingScore.toFixed(2)})`);
    if (candidateScore > existingScore) {
      console.log(`      Suppressing existing: "${existing.input.hints.sourceText}"`);
      next.set(existing.index, {
        ...existing.layout,
        hidden: true,
        preserveMaskWhenHidden: false,
        renderText: '',
      });
      kept[existingIndex] = candidate;
    } else {
      console.log(`      Suppressing candidate: "${candidate.input.hints.sourceText}"`);
      next.set(candidate.index, {
        ...candidate.layout,
        hidden: true,
        preserveMaskWhenHidden: false,
        renderText: '',
      });
    }
  }

  return next;
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

const buildGroupsForOverlayLayout = (inputs) => {
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

  return suppressOverlappingOverlayBorders(result, orderedComputed);
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

      console.log('\n--- SIMULATING LAYOUT WITH SUPPRESSION ---');
      const layoutMap = computeOverlayLayoutMapSimulated(inputs, 'manga');
      
      console.log('\n--- FINAL LAYOUT RESULTS ---');
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
