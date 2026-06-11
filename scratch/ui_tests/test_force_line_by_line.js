const lines = [
  { index: 0, text: '16 MiLLION' },
  { index: 1, text: 'STONES_' },
  { index: 2, text: "WE HAvEN'T" },
  { index: 3, text: 'CHECKED WHAT' },
  { index: 4, text: 'KinD it IS YET; So' },
  { index: 5, text: 'NEGOTIATE Down' },
  { index: 6, text: 'A Little, YEAH?' },
  { index: 7, text: '16 MITON...' },
  { index: 8, text: 'HMM' },
  { index: 9, text: 'I Think' },
  { index: 10, text: "THAT'S TOO" },
  { index: 11, text: 'LOW:' },
  { index: 12, text: "IT'S" },
  { index: 13, text: 'A' },
  { index: 14, text: 'MONSTER SO' },
  { index: 15, text: 'RARE, EVEN I' },
  { index: 16, text: "Didn't Know" },
  { index: 17, text: 'ABOUT IT.' },
  { index: 18, text: 'I Would BE' },
  { index: 19, text: 'GEttinG 40% OF' },
  { index: 20, text: 'THE Profits HAD' },
  { index: 21, text: 'I SOLD It.' },
  { index: 22, text: 'ILL LET You' },
  { index: 23, text: 'ExpERiMENT With' },
  { index: 24, text: 'Her' },
  { index: 25, text: 'A-Are Vou' },
  { index: 26, text: 'selling mg Off to' },
  { index: 27, text: 'magezu' },
  { index: 28, text: 'the' }
];

const TECHNICAL_SOURCE_HINT_REGEX = /\b(chapter|table|fig(?:ure)?\.?|conditions?|equilibrium|rigid|body|reaction|moment|force|free[-\s]?body|unknowns?|support|collinear|diagram|objectives?)\b/i;

const normalizeWhitespace = (text) => text.replace(/\s+/g, ' ').trim();

const shouldForceLineByLineForOfflinePanel = (lines) => {
  if (lines.length < 3) return false;

  const normalizedLines = lines.map((line) => normalizeWhitespace(String(line.text || ''))).filter(Boolean);
  if (normalizedLines.length < 3) return false;

  const avgLength = normalizedLines.reduce((sum, text) => sum + text.length, 0) / normalizedLines.length;
  const technicalHits = normalizedLines.filter((text) => TECHNICAL_SOURCE_HINT_REGEX.test(text)).length;
  const shortLineCount = normalizedLines.filter((text) => text.length <= 34).length;
  const uppercaseDominantCount = normalizedLines.filter((text) => {
    const letters = text.replace(/[^A-Za-z]/g, '');
    if (letters.length < 5) return false;
    return letters === letters.toUpperCase();
  }).length;
  const hasBracketNarration = normalizedLines.some((text) => /\[[^\]]{4,}\]/.test(text));
  const hasPossessiveCompound = normalizedLines.some((text) => /\b[A-Za-z]{3,}['’]S[A-Za-z]{3,}\b/.test(text));

  const mostlyShort = shortLineCount >= Math.ceil(normalizedLines.length * 0.7);
  const mostlyUppercase = uppercaseDominantCount >= Math.ceil(normalizedLines.length * 0.5);

  console.log({
    length: normalizedLines.length,
    avgLength,
    technicalHits,
    shortLineCount,
    mostlyShort,
    uppercaseDominantCount,
    mostlyUppercase,
    hasBracketNarration,
    hasPossessiveCompound
  });

  if (normalizedLines.length >= 5 && mostlyShort && avgLength >= 18 && avgLength <= 38 && technicalHits >= 4) {
    return true;
  }

  return mostlyShort && mostlyUppercase && (hasBracketNarration || hasPossessiveCompound);
};

console.log("Result:", shouldForceLineByLineForOfflinePanel(lines));
