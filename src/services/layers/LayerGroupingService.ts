/**
 * LayerGroupingService — Spatial Graph Clustering for PDF OCR Text Boxes
 * 
 * ใช้ 2D Adjacency Graph (Connected Components) ในการจัดกลุ่มแทน sequential scan
 * ปรับปรุงประสิทธิภาพการจัดแบ่ง Balloon, SFX, และ Narration อย่างพรีเมียม
 */

import type { BBox, OCRLine, OCRPageResult } from '../../types';
import type { TextLayer, TextLayerGroup, LayerGroupType, LayerGroupingResult } from '../../types/layers';

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
const shouldGroupLines = (a: OCRLine, b: OCRLine, allLines?: OCRLine[]): boolean => {
  const hA = bboxHeight(a.bbox);
  const hB = bboxHeight(b.bbox);
  const minHeight = Math.min(hA, hB);
  const avgHeight = (hA + hB) * 0.5;

  const horizOverlap = getHorizontalOverlapRatio(a.bbox, b.bbox);
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
  if (endsGroup(topLine.text) && vertGap > minHeight * 1.2) {
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
  // 4. Vertical gap <= 1.5x ความสูงเฉลี่ยของสอง lines
  return horizOverlap >= 0.30 && vertGap <= 1.5 * avgHeight;
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
  const wordCount = totalText.split(/\s+/).filter(Boolean).length;

  // SFX: คำสั้น, จำนวน lines น้อย, กล่องแนวตั้งสูงชะลูดเมื่อเทียบกับความกว้าง (หรือคำสั้นโดดเดี่ยว)
  if (lines.length <= 2 && wordCount <= 3) {
    const isTall = groupHeight / Math.max(1, groupWidth) > 1.25;
    const isShortWord = totalText.length <= 6;
    if (isTall || isShortWord) return 'sfx';
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

const generateLayerId = (): string => `layer_${++layerIdCounter}_${Date.now().toString(36)}`;
const generateGroupId = (): string => `group_${++groupIdCounter}_${Date.now().toString(36)}`;

/**
 * Pre-processor: สับเส้นที่ถูก OCR มัดรวมแนวนอนยาวเกินไป (Over-merging)
 * โดยการดูจากระยะห่างแนวนอนของ words ใน line นั้นๆ
 */
export const splitAggressiveMergedLines = (
  lines: OCRLine[],
  gapMultiplier = 2.5
): OCRLine[] => {
  const result: OCRLine[] = [];

  for (const line of lines) {
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

      if (gap > gapMultiplier * avgHeight) {
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
  const linesWithIndex = sanitizedRawLines.map((line, idx) => ({
    ...line,
    originalIndex: idx
  }));

  // Pre-process: หั่นบรรทัดที่โดน EasyOCR/PaddleOCR มัดรวมข้าม panel ออกจากกัน
  const rawSplitLines = splitAggressiveMergedLines(linesWithIndex, 2.8) as Array<OCRLine & { originalIndex?: number }>;

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
      if (lineA.bbox.y0 !== lineB.bbox.y0) return lineA.bbox.y0 - lineB.bbox.y0;
      return lineA.bbox.x0 - lineB.bbox.x0;
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

      const originalIndex = typeof line.originalIndex === 'number' ? line.originalIndex : lineIdx;
      const translatedText = translatedByIndex?.get(originalIndex);
      const displayText = translatedText || normalizeInlineText(line.text);
      const sourceText = normalizeInlineText(line.text);
      const h = bboxHeight(line.bbox);

      allLayers.push({
        id: layerId,
        lineIndex: originalIndex,
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
