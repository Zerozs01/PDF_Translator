const { deriveBalloonAwareLayoutGrouping } = require('../src/services/layout/balloonAwareGroupingService');

const lines = [
  { index: 0, text: '16 MiLLION', left: 370, top: 206, right: 858, bottom: 308 },
  { index: 1, text: 'STONES_', left: 420, top: 312, right: 786, bottom: 414 },
  { index: 2, text: "WE HAvEN'T", left: 671, top: 696, right: 1210, bottom: 800 },
  { index: 3, text: 'CHECKED WHAT', left: 595, top: 799, right: 1282, bottom: 909 },
  { index: 4, text: 'KinD it IS YET; So', left: 525, top: 907, right: 1355, bottom: 1017 },
  { index: 5, text: 'NEGOTIATE Down', left: 537, top: 1011, right: 1344, bottom: 1116 },
  { index: 6, text: 'A Little, YEAH?', left: 585, top: 1111, right: 1295, bottom: 1228 },
  { index: 7, text: '16 MITON...', left: 533, top: 4990, right: 1203, bottom: 5153 },
  { index: 8, text: 'HMM', left: 355, top: 6507, right: 680, bottom: 6727 },
  { index: 9, text: 'I Think', left: 666, top: 6750, right: 1024, bottom: 6853 },
  { index: 10, text: "THAT'S TOO", left: 564, top: 6851, right: 1123, bottom: 6961 },
  { index: 11, text: 'LOW:', left: 726, top: 6964, right: 966, bottom: 7066 },
  { index: 12, text: "IT'S", left: 486, top: 7232, right: 690, bottom: 7332 },
  { index: 13, text: 'A', left: 715, top: 7239, right: 775, bottom: 7325 },
  { index: 14, text: 'MONSTER SO', left: 342, top: 7332, right: 932, bottom: 7441 },
  { index: 15, text: 'RARE, EVEN I', left: 338, top: 7427, right: 932, bottom: 7547 },
  { index: 16, text: "Didn't Know", left: 340, top: 7544, right: 931, bottom: 7640 },
  { index: 17, text: 'ABOUT IT.', left: 420, top: 7644, right: 856, bottom: 7742 },
  { index: 18, text: 'I Would BE', left: 716, top: 9802, right: 1226, bottom: 9898 },
  { index: 19, text: 'GEttinG 40% OF', left: 620, top: 9896, right: 1322, bottom: 9992 },
  { index: 20, text: 'THE Profits HAD', left: 618, top: 9990, right: 1326, bottom: 10086 },
  { index: 21, text: 'I SOLD It.', left: 758, top: 10081, right: 1176, bottom: 10181 },
  { index: 22, text: 'ILL LET You', left: 478, top: 11626, right: 1058, bottom: 11730 },
  { index: 23, text: 'ExpERiMENT With', left: 374, top: 11730, right: 1162, bottom: 11834 },
  { index: 24, text: 'Her', left: 422, top: 11838, right: 600, bottom: 11936 },
  { index: 25, text: 'A-Are Vou', left: 315.07, top: 12218.65, right: 595.79, bottom: 12319.25 },
  { index: 26, text: 'selling mg Off to', left: 220, top: 12278, right: 699, bottom: 12416 },
  { index: 27, text: 'magezu', left: 407.8377223398316, top: 12360.325028634112, right: 647.1622776601683, bottom: 12479.674971365888 },
  { index: 28, text: 'the', left: 300, top: 12402, right: 414, bottom: 12476 }
];

const input = {
  pageNumber: 2,
  imageWidth: 1590,
  imageHeight: 23858,
  mode: 'balloon-aware',
  readingMode: 'ltr',
  lines: lines.map(l => ({ ...l, sourceLength: l.text.length }))
};

const result = deriveBalloonAwareLayoutGrouping(input);
console.log("=== DIAGNOSTICS ===");
console.log(`Avg Confidence: ${result.diagnostics.avgConfidence}`);
console.log(`Warnings: ${JSON.stringify(result.diagnostics.warnings)}`);

console.log("=== GROUPS ===");
result.groups.forEach(g => {
  console.log(`Group ID: ${g.id}`);
  console.log(`  Confidence: ${g.confidence}`);
  console.log(`  Type: ${g.groupType}`);
  console.log(`  Lines: ${JSON.stringify(g.orderedLineIndexes)}`);
  console.log(`  Texts: ${JSON.stringify(g.orderedLineIndexes.map(idx => lines[idx].text))}`);
});

console.log("=== UNGROUPED ===");
console.log(result.ungroupedLineIndexes.map(idx => `${idx}: "${lines[idx].text}"`));

