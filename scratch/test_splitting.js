// Scratch test for splitTranslatedTextBySourceWeights algorithms (Ludmer text)

const target1 = "เนื่องจากมีความเป็นปฏิปักษ์กันระหว่างพวกขุนนาง อาณาจักรจึงไม่สามารถระดมพลทั้งกองทัพได้และภูมิภาคทางเหนือก็ถูกพวกป่าเถื่อนยึดไป.";
const sourceLines1 = [
  { text: "Because of" },
  { text: "rivalries between" },
  { text: "aristocrats," },
  { text: "the Kingdom" },
  { text: "was unable to" },
  { text: "mobilize its entire" },
  { text: "army,and the" },
  { text: "northern region" },
  { text: "was captured by" },
  { text: "the barbarians." }
];

const target2 = "เป็นเวลาสิบปีนับตั้งแต่ชาวลูดเมอร์พวกป่าเถื่อนจากทางเหนือเริ่มบุกรุกอาณาจักรแห่งความเกลียดชังเพื่อเสาะหาที่ดินอันอุดมสมบูรณ์...";
const sourceLines2 = [
  { text: "It was ten" },
  { text: "years since the" },
  { text: "Ludmer people," },
  { text: "the barbarians" },
  { text: "from the north," },
  { text: "began invading" },
  { text: "the Kingdom of" },
  { text: "Hateria in search" },
  { text: "for fertile land..." }
];

// Proposed cumulative-budget-based implementation
function splitProposed(target, sourceLines) {
  const segmenter = new Intl.Segmenter('th', { granularity: 'word' });
  const segments = Array.from(segmenter.segment(target)).map((item) => item.segment);
  
  const totalSourceChars = sourceLines.reduce((sum, l) => sum + (l.text || '').length, 0) || 1;
  
  // Calculate cumulative character weights of source lines
  const cumulativeSourceWeights = [];
  let currentSum = 0;
  for (let i = 0; i < sourceLines.length; i++) {
    currentSum += (sourceLines[i].text || '').length;
    cumulativeSourceWeights.push(currentSum);
  }

  // Calculate cumulative char budgets in target string
  const cumulativeTargetBudgets = cumulativeSourceWeights.map((w) =>
    Math.round((w / totalSourceChars) * target.length)
  );

  // Compute segment lengths and cumulative lengths
  const segmentLengths = segments.map((s) => s.length);
  const cumulativeSegmentLengths = [];
  let segSum = 0;
  for (let i = 0; i < segments.length; i++) {
    segSum += segmentLengths[i];
    cumulativeSegmentLengths.push(segSum);
  }

  const thaiParts = [];
  let currentSegStart = 0;

  for (let slot = 0; slot < sourceLines.length; slot++) {
    const isLast = slot === sourceLines.length - 1;
    if (isLast) {
      thaiParts.push(segments.slice(currentSegStart).join('').trim());
      break;
    }

    const targetCumulativeEnd = cumulativeTargetBudgets[slot];

    // Find the segment index that gets closest to targetCumulativeEnd
    let bestSegEnd = currentSegStart;
    let minDifference = Infinity;

    for (let idx = currentSegStart; idx < segments.length; idx++) {
      const cumLen = cumulativeSegmentLengths[idx];
      const diff = Math.abs(cumLen - targetCumulativeEnd);
      
      const remainingSlots = sourceLines.length - 1 - slot;
      if (segments.length - 1 - idx < remainingSlots) {
        break;
      }

      if (diff <= minDifference) {
        minDifference = diff;
        bestSegEnd = idx + 1;
      } else {
        break;
      }
    }

    if (bestSegEnd <= currentSegStart && currentSegStart < segments.length) {
      bestSegEnd = currentSegStart + 1;
    }

    const part = segments.slice(currentSegStart, bestSegEnd).join('').trim();
    thaiParts.push(part);
    currentSegStart = bestSegEnd;
  }

  return thaiParts;
}

// Current implementation
function splitCurrent(target, sourceLines) {
  const segmenter = new Intl.Segmenter('th', { granularity: 'word' });
  const segments = Array.from(segmenter.segment(target)).map((item) => item.segment);
  
  const totalSourceChars = sourceLines.reduce((sum, l) => sum + (l.text || '').length, 0) || 1;
  const budgets = sourceLines.map((l) =>
    Math.max(1, Math.round(((l.text || '').length / totalSourceChars) * target.length))
  );

  const thaiParts = [];
  let segIdx = 0;

  for (let slot = 0; slot < sourceLines.length; slot++) {
    const isLast = slot === sourceLines.length - 1;
    if (isLast) {
      thaiParts.push(segments.slice(segIdx).join('').trim());
      break;
    }

    let accumulated = '';
    const budget = budgets[slot];

    while (segIdx < segments.length) {
      const currentSeg = segments[segIdx];
      
      const isPunct = /^\p{P}+$/u.test(currentSeg);
      const isSpace = /^\s+$/.test(currentSeg);
      
      if (isPunct || isSpace) {
        accumulated += currentSeg;
        segIdx++;
        continue;
      }

      const next = accumulated + currentSeg;
      if (next.length > budget && accumulated.length > 0) break;
      accumulated = next;
      segIdx++;
    }

    thaiParts.push(accumulated.trim());
  }

  return thaiParts;
}

console.log('================ TEST 1: LEFT BOX ================');
console.log('CURRENT:');
splitCurrent(target1, sourceLines1).forEach((p, idx) => console.log(`Slot ${idx} (len ${p.length}): "${p}"`));
console.log('\nPROPOSED:');
splitProposed(target1, sourceLines1).forEach((p, idx) => console.log(`Slot ${idx} (len ${p.length}): "${p}"`));

console.log('\n================ TEST 2: RIGHT BOX ================');
console.log('CURRENT:');
splitCurrent(target2, sourceLines2).forEach((p, idx) => console.log(`Slot ${idx} (len ${p.length}): "${p}"`));
console.log('\nPROPOSED:');
splitProposed(target2, sourceLines2).forEach((p, idx) => console.log(`Slot ${idx} (len ${p.length}): "${p}"`));
