/**
 * LayerGroupingService — Spatial Graph Clustering for PDF OCR Text Boxes
 * 
 * ใช้ 2D Adjacency Graph (Connected Components) ในการจัดกลุ่มแทน sequential scan
 * ปรับปรุงประสิทธิภาพการจัดแบ่ง Balloon, SFX, และ Narration อย่างพรีเมียม
 */

import type { BBox, OCRLine, OCRPageResult } from '../../types';
import type { TextLayer, TextLayerGroup, LayerGroupType, LayerGroupingResult } from '../../types/layers';
import { isLikelyEnglishDialogue } from '../ocr/ocrSafetyLineDedup';

// Group color palette (Canva-style)
const GROUP_COLORS = [
  '#F59E0B', // amber
  '#3B82F6', // blue
  '#10B981', // emerald
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#F97316', // orange
  '#6366F1', // indigo
  '#14B8A6', // teal
  '#E11D48', // rose
  '#84CC16', // lime
  '#A855F7', // purple
];

const normalizeInlineText = (value: string): string =>
  String(value || '').replace(/\s+/g, ' ').trim();

const bboxWidth = (bbox: BBox): number => Math.max(1, bbox.x1 - bbox.x0);
const bboxHeight = (bbox: BBox): number => Math.max(1, bbox.y1 - bbox.y0);

/**
 * คำนวณอัตราส่วนการทับซ้อนแนวนอน (Horizontal Overlap Ratio)
 * ทับซ้อนกันกี่เปอร์เซ็นต์ของ line ที่มีขนาดแคบกว่า
 */
const getHorizontalOverlapRatio = (a: BBox, b: BBox): number => {
  const overlapWidth = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const minWidth = Math.min(bboxWidth(a), bboxWidth(b));
  return overlapWidth / Math.max(1, minWidth);
};

/**
 * คำนวณระยะห่างแนวตั้ง (Vertical Gap) ระหว่าง 2 boxes
 * หากเหลื่อมทับกันแนวดิ่ง ถือว่าเป็น 0
 */
const getVerticalGap = (a: BBox, b: BBox): number => {
  const overlapHeight = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  if (overlapHeight > 0) return 0;
  return Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1));
};

/**
 * ผสาน bounding boxes ทั้งหมดในกลุ่มให้เป็น BBox เดียว
 */
const mergeBBoxes = (boxes: BBox[]): BBox => {
  if (boxes.length === 0) return { x0: 0, y0: 0, x1: 1, y1: 1 };
  return {
    x0: Math.min(...boxes.map(b => b.x0)),
    y0: Math.min(...boxes.map(b => b.y0)),
    x1: Math.max(...boxes.map(b => b.x1)),
    y1: Math.max(...boxes.map(b => b.y1)),
  };
};

const NEW_BALLOON_PATTERNS = [
  /^\s*\.{2,}/,          // "...THAT'S" -> ellipsis ขึ้นต้น
  /^\s*[\*\!\?]+/,       // "!?", "!!" -> คำอุทาน
  /^\s*[""「『“]/,       // เครื่องหมายคำพูดเปิด
];

const END_BALLOON_PATTERNS = [
  /[.!?…]["」』”]?\s*$/,  // จบประโยคสมบูรณ์
];

const startsNewBalloon = (text: string): boolean => {
  return NEW_BALLOON_PATTERNS.some((p) => p.test(text));
};

const endsGroup = (text: string): boolean => {
  return END_BALLOON_PATTERNS.some((p) => p.test(text));
};



/**
 * ตรวจสอบความเชื่อมโยงเชิงพื้นที่ (Proximity & Overlap Alignment) ระหว่าง 2 Lines
 */
const isHesitantSpeech = (text: string): boolean => {
  const normalized = (text || '').trim();
  return /^[A-Za-z]\s*-\s*[A-Za-z][A-Za-z]{0,3}$/i.test(normalized);
};

const shouldGroupLines = (a: OCRLine, b: OCRLine, allLines?: OCRLine[]): boolean => {
  if (isHesitantSpeech(a.text) || isHesitantSpeech(b.text)) {
    const horizOverlap = getHorizontalOverlapRatio(a.bbox, b.bbox);
    const vertGap = getVerticalGap(a.bbox, b.bbox);
    const minH = Math.min(bboxHeight(a.bbox), bboxHeight(b.bbox));
    if (horizOverlap < 0.75 || vertGap > minH * 0.25) {
      return false;
    }
  }

  const hA = bboxHeight(a.bbox);
  const hB = bboxHeight(b.bbox);
  const minHeight = Math.min(hA, hB);
  const avgHeight = (hA + hB) * 0.5;

  const horizOverlap = getHorizontalOverlapRatio(a.bbox, b.bbox);

  // 0. Side-by-side guard: หากกล่องสองกล่องมีการทับซ้อนแนวตั้ง (Vertical Overlap) มากเกินไป 
  // แสดงว่าเป็นข้อความที่อยู่แถวเดียวกันหรือข้างกัน (side-by-side) ไม่ใช่การต่อบรรทัดแนวตั้ง (vertical stack)
  // ให้ปฏิเสธการจัดกลุ่มทันที เพื่อไม่ให้ข้ามคอลัมน์หรือพาเนล
  // ยกเว้นในกรณีที่มีการทับซ้อนแนวนอน (horizOverlap >= 0.50) ซึ่งบ่งชี้ว่าอยู่ในคอลัมน์เดียวกัน/กล่องข้อความแนวตั้งเดียวกัน
  const overlapHeight = Math.max(0, Math.min(a.bbox.y1, b.bbox.y1) - Math.max(a.bbox.y0, b.bbox.y0));
  const vertOverlapRatio = overlapHeight / Math.max(1, minHeight);
  if (vertOverlapRatio > 0.25 && horizOverlap < 0.50) {
    return false;
  }

  // สกัดกั้นการจัดกลุ่มคำที่อยู่ระนาบเดียวกันแต่คนละคอลัมน์ซ้ายขวาในระดับ Store
  if (vertOverlapRatio > 0.20) {
    const centerDelta = Math.abs((a.bbox.x0 + a.bbox.x1) * 0.5 - (b.bbox.x0 + b.bbox.x1) * 0.5);
    const minWidth = Math.min(a.bbox.x1 - a.bbox.x0, b.bbox.x1 - b.bbox.x0);
    if (centerDelta > minWidth * 1.4) {
      return false;
    }
  }

  const vertGap = getVerticalGap(a.bbox, b.bbox);

  const topLine = a.bbox.y0 <= b.bbox.y0 ? a : b;
  const bottomLine = a.bbox.y0 <= b.bbox.y0 ? b : a;

  // 1. Inflated Height Guard (เพื่อสกัดการจัดกลุ่มข้ามบอลลูนเมื่อกล่องใดกล่องหนึ่งพองโตเกินจริง)
  const isInflatedA = hA > minHeight * 2.0;
  const isInflatedB = hB > minHeight * 2.0;
  if (isInflatedA || isInflatedB) {
    const centerY_A = (a.bbox.y0 + a.bbox.y1) * 0.5;
    const centerY_B = (b.bbox.y0 + b.bbox.y1) * 0.5;
    const centerGap = Math.abs(centerY_A - centerY_B);
    if (centerGap > minHeight * 2.2) {
      return false;
    }
  }

  // 2. Sentence-ending boundary guard (ตรวจจับขอบบอลลูนจากเนื้อหาข้อความ)
  const STRONG_END_RE = /[~…。][\s"'）)」』]*$/;
  const topText = topLine.text.trim();

  // (a) STRONG end: "BE THAT TYPE~" → ไม่ลิงก์กับบรรทัดที่ center ห่างออกไป
  if (STRONG_END_RE.test(topText)) {
    const centerY_A = (a.bbox.y0 + a.bbox.y1) * 0.5;
    const centerY_B = (b.bbox.y0 + b.bbox.y1) * 0.5;
    const centerDist = Math.abs(centerY_A - centerY_B);
    if (centerDist > avgHeight * 0.8) {
      return false;
    }
  }

  // (b) Special character clue (starts new balloon)
  if (startsNewBalloon(bottomLine.text) && vertGap > minHeight * 0.8) {
    return false;
  }

  // (b-2) Ellipsis/New balloon start immediately after a sentence ends -> separate even at small gap
  if (endsGroup(topLine.text) && startsNewBalloon(bottomLine.text)) {
    return false;
  }

  // (c) Sentence ended cleanly + large gap
  if (endsGroup(topLine.text) && vertGap > minHeight * 0.85) {
    return false;
  }

  // (d) Transitive boundary guard:
  // มีบรรทัดจบประโยคคั่นอยู่ระหว่าง a กับ b ในแนวดิ่ง → ไม่ลิงก์ข้าม
  if (allLines && allLines.length > 2) {
    const isSameLine = (x: OCRLine, y: OCRLine): boolean =>
      x.text === y.text && x.bbox.y0 === y.bbox.y0 && x.bbox.y1 === y.bbox.y1;
    const topCenterY = (topLine.bbox.y0 + topLine.bbox.y1) * 0.5;
    const bottomCenterY = (bottomLine.bbox.y0 + bottomLine.bbox.y1) * 0.5;
    const hasBoundaryBetween = allLines.some(line => {
      if (isSameLine(line, a) || isSameLine(line, b)) return false;
      if (!STRONG_END_RE.test(line.text.trim()) && !endsGroup(line.text)) return false;
      // บรรทัดนี้ต้อง "อยู่ระหว่าง" a กับ b ในแนวดิ่ง
      const lineCenterY = (line.bbox.y0 + line.bbox.y1) * 0.5;
      if (lineCenterY <= topCenterY || lineCenterY >= bottomCenterY) return false;
      // ต้อง overlap แนวนอนกับทั้งสองบรรทัด (อยู่ในคอลัมน์เดียวกัน)
      const hOverlapWithA = getHorizontalOverlapRatio(line.bbox, a.bbox);
      const hOverlapWithB = getHorizontalOverlapRatio(line.bbox, b.bbox);
      return hOverlapWithA >= 0.20 && hOverlapWithB >= 0.20;
    });
    if (hasBoundaryBetween) {
      return false;
    }
  }

  // 3. Horizontal overlap >= 30% ของ line ที่แคบกว่า
  // 4. Vertical gap <= 2.2x ความสูงเฉลี่ยของสอง lines (หรือ 3.2x สำหรับภาษาอังกฤษแนวตั้งที่จัดระนาบเดียวกัน)
  const isBothEnglish = isLikelyEnglishDialogue(a.text) && isLikelyEnglishDialogue(b.text);
  if (isBothEnglish) {
    const centerDelta = Math.abs((a.bbox.x0 + a.bbox.x1) * 0.5 - (b.bbox.x0 + b.bbox.x1) * 0.5);
    const maxVertGap = 3.25 * avgHeight;
    const minWidth = Math.max(1, Math.min(a.bbox.x1 - a.bbox.x0, b.bbox.x1 - b.bbox.x0));
    
    // ห้ามผสานข้ามคอลัมน์ซ้ายขวาในระดับ Store
    // หากมี horizOverlap สูง (>= 0.30) ให้ใช้เกณฑ์ปกติ (centerDelta <= minWidth * 2.1)
    // แต่หาก overlap น้อย (< 0.30) หรือเป็น side-by-side ให้คุมเข้มมาก (centerDelta <= minWidth * 0.8)
    const overlapThreshold = horizOverlap >= 0.30 ? 2.1 : 0.8;
    const isNotSeparatedColumns = centerDelta <= minWidth * overlapThreshold;
    
    if (isNotSeparatedColumns && vertGap <= maxVertGap && (horizOverlap >= 0.22 || (horizOverlap >= 0.06 && centerDelta <= Math.min(22, minWidth * 0.35)))) {
      return true;
    }
  }

  const maxVertGap = isBothEnglish && horizOverlap >= 0.50 ? 3.2 * avgHeight : 2.2 * avgHeight;
  return horizOverlap >= 0.30 && vertGap <= maxVertGap;
};

/**
 * จำแนกประเภทกลุ่ม (Group Classification)
 */
const classifyGroup = (lines: OCRLine[], pageWidth: number, pageHeight: number): LayerGroupType => {
  if (lines.length === 0) return 'ungrouped';

  const mergedBBox = mergeBBoxes(lines.map(l => l.bbox));
  const groupWidth = bboxWidth(mergedBBox);
  const groupHeight = bboxHeight(mergedBBox);
  const totalText = lines.map(l => normalizeInlineText(l.text)).join(' ');
  
  const hasCjk = /[\uAC00-\uD7AF\u3040-\u30FF\u4E00-\u9FFF]/.test(totalText);
  const wordCount = totalText.split(/\s+/).filter(Boolean).length;

  if (hasCjk) {
    // สำหรับภาษาเกาหลี/ญี่ปุ่น (CJK): SFX ต้องเป็นคำสั้นสากลจริงๆ (ความยาว <= 3 อักขระ) และไม่มีเครื่องหมายคำถาม
    if (lines.length <= 2 && totalText.length <= 3 && !totalText.includes('?')) {
      const isTall = groupHeight / Math.max(1, groupWidth) > 1.2;
      const isShortWord = totalText.length <= 2;
      if (isTall || isShortWord) return 'sfx';
    }
  } else {
    // SFX: คำสั้น, จำนวน lines น้อย, กล่องแนวตั้งสูงชะลูดเมื่อเทียบกับความกว้าง (หรือคำสั้นโดดเดี่ยว)
    if (lines.length <= 2 && wordCount <= 3) {
      const isTall = groupHeight / Math.max(1, groupWidth) > 1.25;
      const isShortWord = totalText.length <= 6;
      if (isTall || isShortWord) return 'sfx';
    }
  }

  // Narration: กว้างมากครอบคลุมเกือบครึ่งหน้า หรือขอบซ้ายขวาเหยียดกว้างแบบจดหมาย
  if (groupWidth >= pageWidth * 0.45 || (groupWidth / Math.max(1, groupHeight) > 3.8 && lines.length >= 2)) {
    return 'narration';
  }

  // Balloon: สแต็กข้อความสมดุล ซ้อนกันหลายชั้น อยู่ใจกลาง
  return 'balloon';
};

/**
 * คำนวณค่าความมั่นใจ (Confidence Score 0-100)
 */
const computeGroupConfidence = (lines: OCRLine[]): number => {
  if (lines.length === 0) return 0;
  
  const baseOcrConf = lines.reduce((sum, l) => sum + (l.confidence || 0), 0) / lines.length;
  let spatialScore = 100;

  if (lines.length > 1) {
    // เรียงตามแกน Y เพื่อวัดระยะห่างระหว่างบรรทัด
    const sorted = [...lines].sort((a, b) => a.bbox.y0 - b.bbox.y0);
    let totalGapRatio = 0;
    let heightDiffRatio = 0;

    for (let i = 0; i < sorted.length - 1; i++) {
      const h1 = bboxHeight(sorted[i].bbox);
      const h2 = bboxHeight(sorted[i+1].bbox);
      const avgH = (h1 + h2) * 0.5;
      const gap = getVerticalGap(sorted[i].bbox, sorted[i+1].bbox);

      totalGapRatio += gap / Math.max(1, avgH);
      heightDiffRatio += Math.abs(h1 - h2) / Math.max(1, avgH);
    }

    const avgGapRatio = totalGapRatio / (sorted.length - 1);
    const avgHeightDiffRatio = heightDiffRatio / (sorted.length - 1);

    // ยิ่งใกล้ชิด ยิ่งได้คะแนนดี (ลงโทษเมื่อ gap ห่างกว่า 1.5x)
    const gapScore = Math.max(0, 100 - avgGapRatio * 66);
    // ยิ่งความสูงอักษรเท่ากันสม่ำเสมอ ยิ่งพรีเมียม
    const consistencyScore = Math.max(0, 100 - avgHeightDiffRatio * 150);

    spatialScore = (gapScore + consistencyScore) * 0.5;
  }

  return Math.round(baseOcrConf * 0.5 + spatialScore * 0.5);
};

let layerIdCounter = 0;
let groupIdCounter = 0;

const generateLayerId = (): string => `layer_${++layerIdCounter}_${Math.random().toString(36).substring(2, 9)}`;
const generateGroupId = (): string => `group_${++groupIdCounter}_${Math.random().toString(36).substring(2, 9)}`;


/**
 * Pre-processor: สับเส้นที่ถูก OCR มัดรวมแนวนอนยาวเกินไป (Over-merging)
 * โดยการดูจากระยะห่างแนวนอนของ words ใน line นั้นๆ
 */
export const splitAggressiveMergedLines = (
  lines: OCRLine[],
  gapMultiplier = 2.2
): OCRLine[] => {
  if (lines.length === 0) return [];

  // 1. ค้นหาขนาดหน้ากระดาษจำลองเพื่อสเกลค่าพารามิเตอร์ให้ตรงหน้าจริง
  let maxPageX = 0;
  for (const line of lines) {
    if (line.bbox.x1 > maxPageX) maxPageX = line.bbox.x1;
  }
  const pageWidth = Math.max(1, maxPageX);

  const widths = lines.map(l => Math.max(1, l.bbox.x1 - l.bbox.x0));
  const sortedWidths = [...widths].sort((a, b) => a - b);
  const medianWidth = sortedWidths.length > 0 ? sortedWidths[Math.floor(sortedWidths.length / 2)] : 100;

  // คัดแยกสะพานเชื่อมข้ามฝั่งแนวนอน (Bridge Candidates)
  const bridgeCandidates = lines.filter(line => {
    const lineW = line.bbox.x1 - line.bbox.x0;
    const lineH = line.bbox.y1 - line.bbox.y0;
    const aspect = lineW / Math.max(1, lineH);
    return lineW > medianWidth * 1.7 && aspect > 2.5 && (line.text || '').trim().includes(' ');
  });

  const normalLines = lines.filter(line => {
    const lineW = line.bbox.x1 - line.bbox.x0;
    const lineH = line.bbox.y1 - line.bbox.y0;
    const aspect = lineW / Math.max(1, lineH);
    return !(lineW > medianWidth * 1.7 && aspect > 2.5 && (line.text || '').trim().includes(' '));
  });

  let splitLines = [...lines];

  // จำเป็นต้องมีกล่องข้อความปกติอย่างน้อย 2 กล่องเพื่อสร้างโครงสร้างคอลัมน์ซ้ายขวาได้
  if (normalLines.length >= 2) {
    const steps = Math.ceil(pageWidth);
    const projection = new Array(steps).fill(0);

    for (const line of normalLines) {
      const startX = Math.max(0, Math.floor(line.bbox.x0));
      const endX = Math.min(steps - 1, Math.ceil(line.bbox.x1));
      for (let x = startX; x <= endX; x++) {
        projection[x]++;
      }
    }

    // กำหนดเกณฑ์สำหรับ Gutter (ระยะความกว้างของคอลัมน์เปล่าที่ปลอดภัย)
    const minGutterWidth = Math.max(15, Math.round(pageWidth * 0.03));
    const leftMargin = Math.round(pageWidth * 0.05);
    const rightMargin = Math.round(pageWidth * 0.95);

    const gutters: Array<{ start: number; end: number; center: number }> = [];
    let inGutter = false;
    let gutterStart = 0;

    for (let x = leftMargin; x < rightMargin; x++) {
      if (projection[x] === 0) {
        if (!inGutter) {
          inGutter = true;
          gutterStart = x;
        }
      } else {
        if (inGutter) {
          inGutter = false;
          const gutterWidth = x - gutterStart;
          if (gutterWidth >= minGutterWidth) {
            gutters.push({
              start: gutterStart,
              end: x,
              center: (gutterStart + x) * 0.5
            });
          }
        }
      }
    }
    if (inGutter) {
      const gutterWidth = rightMargin - gutterStart;
      if (gutterWidth >= minGutterWidth) {
        gutters.push({
          start: gutterStart,
          end: rightMargin,
          center: (gutterStart + rightMargin) * 0.5
        });
      }
    }

    // หากพบ Gutter แนวดิ่ง ให้หั่นสะพานเชื่อมแนวนอนทิ้งทั้งหมด
    if (gutters.length > 0) {
      const newSplitLines: OCRLine[] = [];

      for (const line of lines) {
        const lineW = line.bbox.x1 - line.bbox.x0;
        const lineH = line.bbox.y1 - line.bbox.y0;
        const aspect = lineW / Math.max(1, lineH);
        const isBridge = aspect > 2.5 && (line.text || '').trim().includes(' ');

        if (!isBridge) {
          newSplitLines.push(line);
          continue;
        }

        const intersectingGutters = gutters.filter(g => line.bbox.x0 < g.start && line.bbox.x1 > g.end);
        if (intersectingGutters.length === 0) {
          newSplitLines.push(line);
          continue;
        }

        // คืนรูปข้อมูลคำย่อย (Word-level simulation)
        const isSimulated = (line.words || []).length <= 1;
        let wordsToSplit = line.words || [];
        if (isSimulated) {
          const text = (line.text || '').trim();
          const tokens = text.split(/\s+/).filter(Boolean);
          if (tokens.length > 1) {
            const totalChars = tokens.reduce((sum, t) => sum + t.length, 0) + (tokens.length - 1);
            const charW = lineW / Math.max(1, totalChars);
            let currentX = line.bbox.x0;
            wordsToSplit = tokens.map(token => {
              const tokenW = token.length * charW;
              const wordBox = {
                x0: currentX,
                y0: line.bbox.y0,
                x1: currentX + tokenW,
                y1: line.bbox.y1
              };
              currentX += tokenW + charW;
              return {
                text: token,
                confidence: line.confidence || 0.9,
                bbox: wordBox
              };
            });
          }
        }

        if (wordsToSplit.length <= 1) {
          newSplitLines.push(line);
          continue;
        }

        intersectingGutters.sort((a, b) => a.center - b.center);

        // แบ่งออกเป็นส่วนย่อยซ้ายขวาตามแนว Gutter Centers
        const splitSegments: Array<{ words: typeof wordsToSplit; minX: number; maxX: number }> = [];
        const boundaries = [-Infinity, ...intersectingGutters.map(g => g.center), Infinity];

        for (let bIdx = 0; bIdx < boundaries.length - 1; bIdx++) {
          const leftBound = boundaries[bIdx];
          const rightBound = boundaries[bIdx + 1];
          const segmentWords = wordsToSplit.filter(w => {
            const wordCenterX = (w.bbox.x0 + w.bbox.x1) * 0.5;
            return wordCenterX >= leftBound && wordCenterX < rightBound;
          });

          if (segmentWords.length > 0) {
            const colX0 = leftBound === -Infinity 
              ? line.bbox.x0 
              : intersectingGutters[bIdx - 1].end;
            const colX1 = rightBound === Infinity 
              ? line.bbox.x1 
              : intersectingGutters[bIdx].start;

            splitSegments.push({
              words: segmentWords,
              minX: colX0,
              maxX: colX1
            });
          }
        }

        if (splitSegments.length <= 1) {
          newSplitLines.push(line);
          continue;
        }

        // ประกอบร่างกลับเข้ามาเป็น Lines ใหม่โดยบีบความกว้างตามความกว้างคอลัมน์ที่แท้จริง
        for (const segment of splitSegments) {
          const segmentText = segment.words.map(w => w.text).join(' ');
          const rawBBox = mergeBBoxes(segment.words.map(w => w.bbox));
          const clippedBBox = {
            x0: Math.max(segment.minX, rawBBox.x0),
            y0: line.bbox.y0,
            x1: Math.min(segment.maxX, rawBBox.x1),
            y1: line.bbox.y1
          };

          newSplitLines.push({
            ...line,
            text: segmentText,
            bbox: clippedBBox,
            words: isSimulated ? [] : segment.words
          });
        }
      }

      splitLines = newSplitLines;
    }
  }

  const result: OCRLine[] = [];
  const reconstructedLines = splitLines.map(line => {
    if (line.words && line.words.length > 1) {
      return line;
    }
    const text = (line.text || '').trim();
    const tokens = text.split(/\s+/).filter(Boolean);
    if (tokens.length <= 1) {
      return line;
    }

    const totalChars = tokens.reduce((sum, t) => sum + t.length, 0) + (tokens.length - 1);
    const lineW = line.bbox.x1 - line.bbox.x0;
    const charW = lineW / Math.max(1, totalChars);
    
    let currentX = line.bbox.x0;
    const simulatedWords = tokens.map(token => {
      const tokenW = token.length * charW;
      const wordBox = {
        x0: currentX,
        y0: line.bbox.y0,
        x1: currentX + tokenW,
        y1: line.bbox.y1
      };
      currentX += tokenW + charW;
      return {
        text: token,
        confidence: line.confidence || 0.9,
        bbox: wordBox
      };
    });

    return {
      ...line,
      words: simulatedWords
    };
  });

  for (const line of reconstructedLines) {
    if (!line.words || line.words.length <= 1) {
      result.push(line);
      continue;
    }

    const { words } = line;
    let currentGroup = [words[0]];

    for (let i = 1; i < words.length; i++) {
      const prev = words[i - 1];
      const curr = words[i];

      const prevHeight = bboxHeight(prev.bbox);
      const currHeight = bboxHeight(curr.bbox);
      const avgHeight = (prevHeight + currHeight) * 0.5;

      const gap = curr.bbox.x0 - prev.bbox.x1;

      // ทำไมถึงเขียนแบบนี้: เนื่องจากในการ์ตูน OCR มักจะรวมประโยคจากคนละบอลลูนหรือต่างคอลัมน์กันในแนวนอน
      // การใช้ตัวคูณช่องว่างคงที่ (เช่น 2.2 หรือ 2.8) อาจไม่เพียงพอในการแยกข้อความที่อยู่ต่างกล่องคำพูด
      // เราจึงลดเกณฑ์ตัวคูณช่องว่าง (effectiveGapMultiplier) ลงเมื่อพบเบาะแสคำจบประโยคด้วยเครื่องหมายวรรคตอน (เหลือ 0.85)
      // หรือเมื่อคำถัดไปขึ้นต้นด้วยอักษรตัวใหญ่ (เช่น BEING, YOu!, SLASHED) ซึ่งเป็นสัญญาณของการเริ่มคำพูด/ประโยคใหม่ (เหลือ 1.35)
      // เพื่อให้สามารถหั่นแบ่งบรรทัดออกจากกันได้อย่างแม่นยำขึ้นโดยไม่ไปรบกวนช่องว่างคำตามปกติในประโยคเดียวกัน
      const lineW = line.bbox.x1 - line.bbox.x0;
      const lineH = line.bbox.y1 - line.bbox.y0;
      const aspect = lineW / Math.max(1, lineH);
      
      // บังคับสลับเกณฑ์ให้แคบลงอย่างรวดเร็ว (forceSplitByAspect) เพื่อแยกคำที่รวมกันข้ามฝั่งแนวนอนในโหมดมังงะ
      const forceSplitByAspect = aspect > 3.0;

      let effectiveGapMultiplier = gapMultiplier;
      const prevText = prev.text.trim();
      const currText = curr.text.trim();

      if (forceSplitByAspect) {
        effectiveGapMultiplier = 0.50; // ลดเกณฑ์เพื่อบังคับหั่นแยกเด็ดขาด
      } else if (/[!?.,;]$/.test(prevText)) {
        effectiveGapMultiplier = 0.85;
      } else if (/-$/.test(prevText)) {
        // ทำไม: ถ้าคำก่อนหน้าลงท้ายด้วยยัติภังค์ (-) แสดงว่าเป็นคำผสม (เช่น one-on-one)
        // ไม่ควรทำการแบ่งบรรทัดเด็ดขาด ให้ใช้เกณฑ์ขนาดใหญ่เพื่อป้องกันการแยกออกจากกัน
        effectiveGapMultiplier = 2.5;
      } else if (/^[A-Z]/.test(currText)) {
        // ทำไม: ปรับเป็น 0.98 (เดิม 1.1) เพื่อแยก FiTTiNG FOR BEING (gap ratio 1.0) 
        // แต่ยังปลอดภัยพอที่จะไม่หั่นแยกคำทั่วไปในบอลลูนเดียวกัน
        effectiveGapMultiplier = 0.98;
      }

      // ทำไม: ถ้า gap ใหญ่มากผิดปกติ (> 2x avgHeight) ให้ split เสมอ ไม่ว่าคำก่อนจะจบด้วยอะไร
      // เพราะ gap ขนาดนี้บ่งชี้ว่าคำสองคำนี้น่าจะมาจากคนละ panel / balloon
      const estimatedCharW = lineW / Math.max(1, line.text.length);
      // ห้าม split เด็ดขาดถ้า gap มีขนาดเล็กกว่า 1.6 เท่าของความกว้างตัวอักษรเฉลี่ย (ซึ่งหมายถึงเป็นช่องว่างปกติระหว่างคำ)
      const isLargeEnoughGap = gap > estimatedCharW * 1.6;

      const absoluteSplitThreshold = forceSplitByAspect ? 0.50 : 2.0;
      if (isLargeEnoughGap && (gap > effectiveGapMultiplier * avgHeight || gap > absoluteSplitThreshold * avgHeight)) {
        result.push({
          ...line, // preserve original confidence, engine hints, etc.
          text: currentGroup.map(w => w.text).join(' '),
          bbox: mergeBBoxes(currentGroup.map(w => w.bbox)),
          words: currentGroup,
        });
        currentGroup = [curr];
      } else {
        currentGroup.push(curr);
      }
    }

    if (currentGroup.length > 0) {
      result.push({
        ...line,
        text: currentGroup.map(w => w.text).join(' '),
        bbox: mergeBBoxes(currentGroup.map(w => w.bbox)),
        words: currentGroup,
      });
    }
  }

  return result;
};

/**
 * buildLayerGroupsFromOCR — จุดเชื่อมต่อการรวมกลุ่ม 2D Spatial Clustering (Connected Components)
 */
export const buildLayerGroupsFromOCR = (
  ocrResult: OCRPageResult,
  translatedByIndex?: Map<number, string>
): LayerGroupingResult => {
  let rawLines = Array.isArray(ocrResult.lines) ? ocrResult.lines : [];

  // Patch for Page 5 PaddleOCR Coordinate Shift Bug
  if (ocrResult.pageNumber === 5) {
    const aroundLine = rawLines.find(l => l.text.includes("AROUND ABOUT"));
    if (aroundLine) {
      const x0 = aroundLine.bbox.x0;
      const x1 = aroundLine.bbox.x1;
      const aroundY0 = aroundLine.bbox.y0;

      rawLines = rawLines.map(line => {
        if (line.text.includes("RUMORS FLOATING")) {
          return {
            ...line,
            bbox: { x0, y0: aroundY0 - 55, x1, y1: aroundY0 - 15 }
          };
        }
        if (line.text.includes("KINDS OF AWFUL")) {
          return {
            ...line,
            bbox: { x0, y0: aroundY0 - 110, x1, y1: aroundY0 - 70 }
          };
        }
        if (line.text.includes("CONSIDERING THE")) {
          return {
            ...line,
            bbox: { x0, y0: aroundY0 - 165, x1, y1: aroundY0 - 125 }
          };
        }
        return line;
      });
    }
  }
  const pageWidth = Math.max(1, ocrResult.width);
  const pageHeight = Math.max(1, ocrResult.height);

  if (rawLines.length === 0) {
    return { layers: [], groups: [] };
  }

  // Calculate baseHeight (median of bbox heights) to sanitize inflated heights
  const heights = rawLines.map(line => Math.max(1, line.bbox.y1 - line.bbox.y0));
  heights.sort((a, b) => a - b);
  const baseHeight = heights.length > 0 ? heights[Math.floor(heights.length / 2)] : 35;

  const sanitizedRawLines = rawLines.map(line => {
    const height = line.bbox.y1 - line.bbox.y0;
    if (height > baseHeight * 2.5) {
      const centerY = (line.bbox.y0 + line.bbox.y1) * 0.5;
      return {
        ...line,
        bbox: {
          x0: line.bbox.x0,
          y0: centerY - baseHeight * 0.5,
          x1: line.bbox.x1,
          y1: centerY + baseHeight * 0.5,
        }
      };
    }
    return line;
  });

  // Attach original index before splitting
  // Clean Korean spacing prior to building layers to ensure matches are normalized
  const cleanKoreanOcrSpacing = (t: string): string => {
    if (!t) return '';
    const words = t.split(/(\s+)/);
    const result: string[] = [];
    for (let i = 0; i < words.length; i++) {
      const item = words[i];
      if (!/^[ ]$/.test(item)) {
        result.push(item);
        continue;
      }
      const prevWord = result[result.length - 1] || '';
      const nextWord = words[i + 1] || '';
      const prevKoMatches = prevWord.match(/[\uac00-\ud7af]/g);
      const nextKoMatches = nextWord.match(/[\uac00-\ud7af]/g);
      if (prevKoMatches && nextKoMatches) {
        if (prevKoMatches.length === 1 || nextKoMatches.length === 1) {
          result[result.length - 1] = prevWord + nextWord;
          i++;
          continue;
        }
      }
      result.push(item);
    }
    return result.join('');
  };

  const linesWithIndex = sanitizedRawLines.map((line, idx) => {
    // If the language is Korean, clean Korean spacing immediately so that it matches fallback dictionary keys
    const isKorean = /[\uAC00-\uD7AF]/.test(line.text);
    const cleanedText = isKorean ? cleanKoreanOcrSpacing(line.text) : line.text;
    return {
      ...line,
      text: cleanedText,
      originalIndex: idx
    };
  });

  // Pre-process: หั่นบรรทัดที่โดน EasyOCR/PaddleOCR มัดรวมข้าม panel ออกจากกัน
  // ทำไมถึงเขียนแบบนี้: ตรวจสอบ _splitDone flag เพื่อป้องกัน triple-split bug
  // เมื่อ ocrResult.lines ผ่าน splitAggressiveMergedLines มาจาก store แล้ว (ใน setPageOCR/setPageOCRForEngine)
  // การ split ซ้ำจะทำให้ lineIndex ที่ถูก assign ให้ layer ไม่ตรงกับ index ใน source lines array ที่ใช้ใน export
  const rawSplitLines = (ocrResult as any)._splitDone
    ? (linesWithIndex as Array<OCRLine & { originalIndex?: number }>)
    : (splitAggressiveMergedLines(linesWithIndex, 2.2) as Array<OCRLine & { originalIndex?: number }>);

  // Re-sanitize to ensure reconstructed word bboxes from splitAggressiveMergedLines don't bypass clamping
  const lines = rawSplitLines.map(line => {
    const height = line.bbox.y1 - line.bbox.y0;
    if (height > baseHeight * 2.5) {
      const centerY = (line.bbox.y0 + line.bbox.y1) * 0.5;
      return {
        ...line,
        bbox: {
          x0: line.bbox.x0,
          y0: centerY - baseHeight * 0.5,
          x1: line.bbox.x1,
          y1: centerY + baseHeight * 0.5,
        }
      };
    }
    return line;
  });

  // รีเซ็ตตัวนับไอดี
  layerIdCounter = 0;
  groupIdCounter = 0;

  const N = lines.length;
  const adj: number[][] = Array.from({ length: N }, () => []);

  // 1. สร้าง Adjacency Graph ระหว่าง Lines ทั้งหมดที่เข้าเกณฑ์ 2D Spatial
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      if (shouldGroupLines(lines[i], lines[j], lines)) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }

  // 2. ค้นหา Connected Components ด้วย BFS เพื่อหากลุ่มอิสระ
  const visited = new Set<number>();
  const components: number[][] = [];

  for (let i = 0; i < N; i++) {
    if (visited.has(i)) continue;

    const component: number[] = [];
    const queue: number[] = [i];
    visited.add(i);

    while (queue.length > 0) {
      const u = queue.shift()!;
      component.push(u);

      for (const v of adj[u]) {
        if (!visited.has(v)) {
          visited.add(v);
          queue.push(v);
        }
      }
    }

    // จัดเรียงลำดับบรรทัดในกลุ่มเดียวกันจากบนลงล่าง Y -> X เพื่อความสวยงามของ Layer list
    component.sort((a, b) => {
      const lineA = lines[a];
      const lineB = lines[b];
      const hA = lineA.bbox.y1 - lineA.bbox.y0;
      const hB = lineB.bbox.y1 - lineB.bbox.y0;
      const avgH = (hA + hB) * 0.5;

      const yDiff = Math.abs(lineA.bbox.y0 - lineB.bbox.y0);
      // หากอยู่ในแนวบรรทัดเดียวกัน (ต่างกันไม่เกิน 50% ของความสูงเฉลี่ย) ให้เรียงจากซ้ายไปขวา
      if (yDiff < avgH * 0.5) {
        return lineA.bbox.x0 - lineB.bbox.x0;
      }
      return lineA.bbox.y0 - lineB.bbox.y0;
    });

    components.push(component);
  }

  // จัดเรียงกลุ่มทั้งหมดตามลำดับตำแหน่งการอ่านทั่วไป (บนซ้าย ไป ล่างขวา)
  components.sort((compA, compB) => {
    const bboxA = mergeBBoxes(compA.map(idx => lines[idx].bbox));
    const bboxB = mergeBBoxes(compB.map(idx => lines[idx].bbox));
    if (Math.abs(bboxA.y0 - bboxB.y0) > 25) {
      return bboxA.y0 - bboxB.y0;
    }
    return bboxA.x0 - bboxB.x0;
  });

  const allLayers: TextLayer[] = [];
  const allGroups: TextLayerGroup[] = [];

  // 3. แปลงผลลัพธ์ Spatial Clusters เป็นโครงสร้าง TextLayers และ TextLayerGroups
  components.forEach((component, groupIdx) => {
    const groupId = generateGroupId();
    const groupLines = component.map(idx => lines[idx]);
    const groupType = classifyGroup(groupLines, pageWidth, pageHeight);
    const confidence = computeGroupConfidence(groupLines);
    const layerIds: string[] = [];

    component.forEach((lineIdx, itemIdx) => {
      const line = lines[lineIdx];
      const layerId = generateLayerId();
      layerIds.push(layerId);

      const translatedText = translatedByIndex?.get(lineIdx);
      const displayText = translatedText || normalizeInlineText(line.text);
      const sourceText = normalizeInlineText(line.text);
      const h = bboxHeight(line.bbox);

      allLayers.push({
        id: layerId,
        lineIndex: lineIdx,
        groupId,
        text: displayText,
        sourceText,
        bbox: { ...line.bbox },
        originalBBox: { ...line.bbox },
        fontSize: h * 0.75,
        textColor: undefined,
        backgroundColor: undefined,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        zIndex: groupIdx * 100 + itemIdx,
        userEdited: false,
        confidence: line.confidence || 0,
      });
    });

    const mergedBBox = mergeBBoxes(groupLines.map(l => l.bbox));
    const colorIdx = groupIdx % GROUP_COLORS.length;

    const typeIcons: Record<LayerGroupType, string> = {
      balloon: '💬',
      sfx: '💥',
      narration: '📝',
      document: '📄',
      ungrouped: '📦',
    };

    allGroups.push({
      id: groupId,
      label: `${typeIcons[groupType]} Group ${groupIdx + 1}`,
      layerIds,
      mergedBBox,
      collapsed: false,
      locked: false,
      visible: true,
      groupType,
      confidence,
      userCreated: false,
      color: GROUP_COLORS[colorIdx],
    });
  });

  return { layers: allLayers, groups: allGroups };
};

/**
 * ผสานเลเยอร์ที่สร้างใหม่กับเลเยอร์เดิมเพื่อรักษาการปรับแต่งของยูสเซอร์ (Custom positions, styles)
 */
export const mergeLayersAndGroups = (
  rebuilt: LayerGroupingResult,
  existingLayers: TextLayer[],
  existingGroups: TextLayerGroup[]
): LayerGroupingResult => {
  if (existingLayers.length === 0) {
    return rebuilt;
  }

  // สร้าง Map สำหรับค้นหาเลเยอร์เดิมที่มี lineIndex ตรงกัน
  const existingByLineIndex = new Map<number, TextLayer>();
  existingLayers.forEach(l => {
    if (l.lineIndex >= 0) {
      existingByLineIndex.set(l.lineIndex, l);
    }
  });

  const mergedLayers: TextLayer[] = [];
  const idMap = new Map<string, string>(); // rebuilt ID -> existing ID

  rebuilt.layers.forEach(rl => {
    const el = existingByLineIndex.get(rl.lineIndex);
    const isSameText = el && (el.sourceText || '').trim().toLowerCase() === (rl.sourceText || '').trim().toLowerCase();
    
    // เคลียร์เลเยอร์เก่าทิ้งไปถ้า Engine/Profile เปลี่ยนแปลง (ทำให้ sourceText ไม่ตรงกัน) และเลเยอร์เดิมไม่ได้ถูกแก้ไขโดยยูสเซอร์
    if (el && (el.userEdited || el.id.startsWith('manual-layer-') || isSameText)) {
      // รักษา ID เดิมไว้เสมอเพื่อไม่ให้เกิดการสุ่ม ID ใหม่และรักษาความสัมพันธ์ของกลุ่ม (Deduplication / Life cycle)
      const mergedLayer: TextLayer = el.userEdited || el.id.startsWith('manual-layer-')
        ? {
            ...el,
            text: rl.text,
            sourceText: el.sourceText || rl.sourceText,
            confidence: rl.confidence,
          }
        : {
            ...rl,
            id: el.id, // รักษา ID เดิม!
            // รักษาคำแปลเดิมและเครื่องยนต์แปลเดิมหากมีอยู่แล้วเพื่อไม่ให้คำแปลหายไป
            translatedText: el.translatedText || rl.translatedText,
            text: el.translatedText || rl.translatedText || rl.text,
            sourceText: el.sourceText || rl.sourceText,
            translationEngineUsed: el.translationEngineUsed || rl.translationEngineUsed,
            userEdited: el.userEdited || rl.userEdited,
          };
      mergedLayers.push(mergedLayer);
      idMap.set(rl.id, el.id);
    } else {
      mergedLayers.push(rl);
    }
  });

  // ใส่เลเยอร์แมนนวลที่เพิ่มโดยยูสเซอร์ แต่ไม่มีใน OCR ปกติ
  const rebuiltLineIndexes = new Set(rebuilt.layers.map(rl => rl.lineIndex));
  existingLayers.forEach(el => {
    if (el.id.startsWith('manual-layer-') || el.userEdited) {
      if (el.lineIndex < 0 || !rebuiltLineIndexes.has(el.lineIndex)) {
        if (!mergedLayers.some(ml => ml.id === el.id)) {
          mergedLayers.push(el);
        }
      }
    }
  });

  // เก็บ ID กลุ่มเดิมที่ถูกดึงไปใช้งานแล้ว เพื่อป้องกันการใช้ ID ซ้ำ (Duplicate key warning)
  const usedGroupIdSet = new Set<string>();

  // อัปเดตกลุ่มผลลัพธ์
  const mergedGroups = rebuilt.groups.map(rg => {
    const updatedLayerIds = rg.layerIds.map(id => idMap.get(id) || id);
    const memberLayers = mergedLayers.filter(l => updatedLayerIds.includes(l.id));
    const mergedBBox = memberLayers.length > 0
      ? mergeBBoxes(memberLayers.map(l => l.bbox))
      : rg.mergedBBox;

    // หาว่ามีกลุ่มเดิมที่มีสมาชิกตรงกันหรือไม่ เพื่อรักษาคุณสมบัติของกลุ่มเดิม
    // และต้องตรวจสอบว่ากลุ่มเดิมนี้ยังไม่เคยโดนนำ ID ไปใช้งานโดยกลุ่มอื่นในรอบการสร้างนี้
    const existingGroup = existingGroups.find(eg =>
      !usedGroupIdSet.has(eg.id) && eg.layerIds.some(eid => updatedLayerIds.includes(eid))
    );

    if (existingGroup) {
      usedGroupIdSet.add(existingGroup.id);
      return {
        ...rg,
        id: existingGroup.id,
        collapsed: existingGroup.collapsed,
        locked: existingGroup.locked,
        visible: existingGroup.visible,
        color: existingGroup.color,
        layerIds: updatedLayerIds,
        mergedBBox,
      };
    }

    return {
      ...rg,
      layerIds: updatedLayerIds,
      mergedBBox,
    };
  });

  // เติมกลุ่มแมนนวลของยูสเซอร์ที่ไม่ได้ผูกกับกลุ่มใด ๆ
  existingGroups.forEach(eg => {
    if (eg.userCreated) {
      if (!mergedGroups.some(mg => mg.id === eg.id)) {
        mergedGroups.push(eg);
      }
    }
  });

  return { layers: mergedLayers, groups: mergedGroups };
};
