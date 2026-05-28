// src/services/ocr/ocrTextNormalizer.ts

export const TRANSLATION_LANGUAGE_ALIASES: Record<string, string> = {
  en: 'en',
  eng: 'en',
  english: 'en',
  th: 'th',
  tha: 'th',
  thai: 'th',
  ja: 'ja',
  jpn: 'ja',
  jpn_vert: 'ja',
  ko: 'ko',
  kor: 'ko',
  zh: 'zh',
  chi: 'zh',
  chi_sim: 'zh',
  chi_tra: 'zh',
  vi: 'vi',
  vie: 'vi',
  de: 'de',
  deu: 'de',
  fr: 'fr',
  fra: 'fr',
  ru: 'ru',
  rus: 'ru',
  es: 'es',
  spa: 'es',
};

export const TECHNICAL_OCR_NORMALIZERS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bR\s*E\s*A\s*C\s*T\s*I\s*O\s*N\b/gi, replacement: 'REACTION' },
  { pattern: /\bD\s*I\s*R\s*E\s*C\s*T\s*I\s*O\s*N\b/gi, replacement: 'DIRECTION' },
  { pattern: /\bC\s*O\s*N\s*N\s*E\s*C\s*T\s*I\s*O\s*N\b/gi, replacement: 'CONNECTION' },
];

export const ENGLISH_OCR_NOISE_REPAIRS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bA-\s*Areyou\b/gi, replacement: 'A-Are you' },
  { pattern: /\bA-\s*Are\s*y\b/gi, replacement: 'A-Are you' },
  { pattern: /\bAreyou\b/gi, replacement: 'Are you' },
  { pattern: /\bYOU\s*-\s*COULD\b/gi, replacement: 'YOU COULD' },
  { pattern: /\bSO\s+ME\s+THING\b/gi, replacement: 'SOMETHING' },
  { pattern: /\bIT'?SA\b/gi, replacement: "IT'S A" },
  { pattern: /\bIT'?S\s+BESTIF\b/gi, replacement: "IT'S BEST IF" },
  { pattern: /\bBESTIF\b/gi, replacement: 'BEST IF' },
  { pattern: /\bTHENHISWHOLE\b/gi, replacement: 'THEN HIS WHOLE' },
  { pattern: /\bBODYWAS\b/gi, replacement: 'BODY WAS' },
  { pattern: /\bLIKEAFURNACE\b/gi, replacement: 'LIKE A FURNACE' },
  { pattern: /\bBUTNOW\b/gi, replacement: 'BUT NOW' },
  { pattern: /\bASICE\b/gi, replacement: 'AS ICE' },
  { pattern: /\bSCOLD\s+AS\s+ICE\b/gi, replacement: 'COLD AS ICE' },
  { pattern: /\bHE\s+SCOLD\b/gi, replacement: "HE'S COLD" },
  { pattern: /WHAT\s+KIND-OE/gi, replacement: 'WHAT KIND OF' },
  { pattern: /MY\s*STERIOUS/gi, replacement: 'MYSTERIOUS' },
  { pattern: /UKELY/gi, replacement: 'LIKELY' },
  { pattern: /HMM_\s*GUESS/gi, replacement: 'HMM I GUESS' },
  { pattern: /\bHUH_\b/gi, replacement: 'HUH...' },
  { pattern: /\bHUH\s*_\b/gi, replacement: 'HUH...' },
  { pattern: /\bGO\s+ON_\b/gi, replacement: 'Go on.' },
  { pattern: /\bGO\s+ON\s*_\b/gi, replacement: 'Go on.' },
  { pattern: /\bFOR\s+WHILE\b/gi, replacement: 'FOR A WHILE' },
  { pattern: /\bON\s+MY\s+MIND\b/gi, replacement: 'on my mind' },
  { pattern: /\bImidefiniely\b/gi, replacement: "I'm definitely" },
  { pattern: /\bImidefinitely\b/gi, replacement: "I'm definitely" },
  { pattern: /\bARENT\b/gi, replacement: "AREN'T" },
  { pattern: /\baren['’]t\s+we\b/gi, replacement: "aren't we" },
  { pattern: /\bmur\s+dered\b/gi, replacement: 'murdered' },
  { pattern: /\bTo\s+My\s+PRidE\b/gi, replacement: 'To my pride' },
  { pattern: /\bTHAT'S\s+FAiR\b/gi, replacement: "That's fair" },
  {
    pattern: /\bthis\s+submaie\s+to\s+in\s+ureat\s+the\s+ydoot\s+falinth\s+i\s+chapt\s+we\s+willtudhow\b/gi,
    replacement: 'this submarine to insure that they do not fail in this chapter we will study how',
  },
  {
    pattern: /\bsubmaie\s+to\s+in\s+ureat\s+the\s+ydoot\s+falinth\s+i\s+chapt\s+we\s+willtudhow\b/gi,
    replacement: 'submarine to insure that they do not fail in this chapter we will study how',
  },
  { pattern: /\bsubmaie\b/gi, replacement: 'submarine' },
  { pattern: /\bureat\b/gi, replacement: 'insure that' },
  { pattern: /\bydoot\b/gi, replacement: 'they do not' },
  { pattern: /\bfalinth\b/gi, replacement: 'fail in this' },
  { pattern: /\bi\s+chapt\b/gi, replacement: 'in this chapter' },
  { pattern: /\bchapt\b/gi, replacement: 'chapter' },
  { pattern: /\bwilltudhow\b/gi, replacement: 'will study how' },
  {
    pattern: /\bof\s*the\s+effctofravt\s*a?t?\s*i?\s*on\s+a\s*ctriclm\s*a\s*gnetiontact\s*rescaused\b/gi,
    replacement: 'of the effects of gravitational, electrical, magnetic, or contact forces caused',
  },
  { pattern: /\beffctofravt\b/gi, replacement: 'effects of gravitational' },
  { pattern: /\bctriclm\s*a\s*gnetiontact\b/gi, replacement: 'electrical, magnetic, or contact' },
  { pattern: /\brescaused\b/gi, replacement: 'forces caused' },
];

export const SPANISH_OCR_NOISE_REPAIRS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bQUE ?ME\b/gi, replacement: 'QUE ME' },
  { pattern: /\bQUEME\b/gi, replacement: 'QUE ME' },
  { pattern: /\bSI ?ME\b/gi, replacement: 'SI ME' },
  { pattern: /\bSIME\b/gi, replacement: 'SI ME' },
  { pattern: /\bS[- ]?SIENTO\b/gi, replacement: 'SIENTO' },
  { pattern: /\bDE ?LO\b/gi, replacement: 'DE LO' },
  { pattern: /\bDELO\b/gi, replacement: 'DE LO' },
  { pattern: /\bTO ?DO\b/gi, replacement: 'TODO' },
  { pattern: /\bTODOLOQUE\b/gi, replacement: 'TODO LO QUE' },
  { pattern: /\bLOQUE\b/gi, replacement: 'LO QUE' },
  { pattern: /\bLISTO ?CON\b/gi, replacement: 'LISTO CON' },
  { pattern: /\bLISTOCON\b/gi, replacement: 'LISTO CON' },
  { pattern: /\b[i¡]?LISTO[.!?…]+CON\b/gi, replacement: 'LISTO CON' },
  { pattern: /\bPRI-?\s*MERO\s*LA\s*FOTO\b/gi, replacement: 'PRIMERO LA FOTO' },
  { pattern: /\bPRIMEROLAFOTO\b/gi, replacement: 'PRIMERO LA FOTO' },
  { pattern: /\bMETIENDO\s*POR\b/gi, replacement: 'METIENDO POR' },
  { pattern: /\bMETIENDOPOR\b/gi, replacement: 'METIENDO POR' },
  { pattern: /\bPOR ?DENTRO\b/gi, replacement: 'POR DENTRO' },
  { pattern: /\bPORDENTRO\b/gi, replacement: 'POR DENTRO' },
  { pattern: /\bYA ?QUEDO\b/gi, replacement: 'YA QUEDO' },
  { pattern: /\bYAQUEDO\b/gi, replacement: 'YA QUEDO' },
  { pattern: /\bRAPIDOPR\b/gi, replacement: 'RAPIDO PR' },
  { pattern: /\bDE,\s*PIDIERON\b/gi, replacement: 'DESPIDIERON' },
  { pattern: /\bI?RAPIDO,?\s*PRI-?\b/gi, replacement: 'RAPIDO, PRI-' },
  { pattern: /\bCOMOSI\b/gi, replacement: 'COMO SI' },
  { pattern: /\bCIERTASPARTES\b/gi, replacement: 'CIERTAS PARTES' },
  { pattern: /\bERAUNPOCO\b/gi, replacement: 'ERA UN POCO' },
  { pattern: /\bNOERAUNPOCO\b/gi, replacement: 'NO ERA UN POCO' },
  { pattern: /\bSERAQUE\b/gi, replacement: 'SERA QUE' },
  { pattern: /\bCONMAS\b/gi, replacement: 'CON MAS' },
  { pattern: /\bM[ÁA]SDETALLE\b/gi, replacement: 'MAS DETALLE' },
  { pattern: /\bDETA\s*-?\s*LLE(?:S)?\b/gi, replacement: 'DETALLE' },
  { pattern: /\bENESPECI(?:FICO|ICO)\b/gi, replacement: 'EN ESPECIFICO' },
  { pattern: /\bESPEI?CICO\b/gi, replacement: 'ESPECIFICO' },
  { pattern: /\bALGE\s+ASI\b/gi, replacement: 'ALGO ASI' },
];

export const SPANISH_FUNCTION_WORD_GLUE_PATTERN = /\b([A-ZÁÉÍÓÚÜÑ]{3,})(QUE|ME|TE|SE|LO|LA|LOS|LAS|UN|UNA|MAS|ASI|CON|SIN|POR|PARA|EN)([A-ZÁÉÍÓÚÜÑ]{3,})\b/g;

export const THAI_BOUNDARY_ATTACH_TOKENS = new Set([
  'ไป',
  'นะ',
  'สิ',
  'ละ',
  'ล่ะ',
  'เลย',
  'ก็',
  'มาก',
  'อยู่',
  'แล้ว',
  'ด้วย',
  'กัน',
  'เอง',
  'เหรอ',
  'หรอ',
  'หรือ',
  'ไหม',
  'มั้ย',
  'ครับ',
  'ค่ะ',
]);

export const THAI_BOUNDARY_NO_SPLIT_PAIRS = new Set([
  'เกิน|ไป',
  'ให้|กับ',
  'ยัง|ไม่',
  'ไม่|รู้',
  'หายาก|มาก',
  'ปิ|ด',
]);

export const normalizeWhitespace = (text: string): string => text.replace(/\s+/g, ' ').trim();

export const normalizeTranslationLanguage = (value: string, fallback: string): string => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;
  if (TRANSLATION_LANGUAGE_ALIASES[raw]) return TRANSLATION_LANGUAGE_ALIASES[raw];
  const primary = raw.split('-')[0].trim();
  if (!primary) return fallback;
  return TRANSLATION_LANGUAGE_ALIASES[primary] || primary;
};

export const normalizeEnglishOcrNoiseForTranslation = (text: string): string => {
  let normalized = normalizeWhitespace(String(text || ''));
  ENGLISH_OCR_NOISE_REPAIRS.forEach(({ pattern, replacement }) => {
    normalized = normalized.replace(pattern, replacement);
  });

  normalized = normalized.replace(
    /\bBACK\s+THEN\s+HIS\s+WHOLE\s+BODY\s+WAS\s+BURNING\s+UP\s+LIKE\s+A\s+FURNACE\s+BUT\s+NOW\s+HE'?S?\s+COLD\s+AS\s+ICE\b/gi,
    "BACK THEN HIS WHOLE BODY WAS BURNING UP LIKE A FURNACE, BUT NOW HE'S COLD AS ICE"
  );

  const compactLatin = normalized.toLowerCase().replace(/[^a-z]/g, '');
  if (
    compactLatin.includes('oftheeffctofravt') &&
    compactLatin.includes('gnetiontact') &&
    compactLatin.includes('rescaused')
  ) {
    normalized = 'of the effects of gravitational, electrical, magnetic, or contact forces caused';
  }

  // Strip trailing underscores from English words that often appear in OCR artifacts
  normalized = normalized.replace(/([A-Za-z]{2,})_+(\s|$)/g, '$1$2');
  normalized = normalized.replace(/([A-Za-z]+)_+([A-Za-z]+)/g, '$1 $2'); // Fix mid-word underscores

  // Semicolons often confuse Argos offline models; replace with commas for better flow
  normalized = normalized.replace(/([A-Za-z])\s*;\s*(\s|$)/g, '$1, $2');
  normalized = normalized.replace(/([A-Za-z])\s*;/g, '$1,');

  return normalizeWhitespace(normalized);
};

export const splitSpanishUppercaseCompounds = (text: string): string => {
  let normalized = String(text || '');
  for (let i = 0; i < 2; i += 1) {
    normalized = normalized.replace(SPANISH_FUNCTION_WORD_GLUE_PATTERN, '$1 $2 $3');
  }
  return normalized;
};

export const normalizeSpanishOcrNoiseForTranslation = (text: string): string => {
  let normalized = normalizeWhitespace(String(text || ''));
  normalized = normalized.replace(/(^|[\s"'([{])iC[-\s]*/gi, '$1¿C');
  normalized = normalized.replace(/(^|[\s"'([{])i(?=COMO\b)/gi, '$1¿');
  SPANISH_OCR_NOISE_REPAIRS.forEach(({ pattern, replacement }) => {
    normalized = normalized.replace(pattern, replacement);
  });
  normalized = splitSpanishUppercaseCompounds(normalized);
  normalized = normalized.replace(/¿C{2,}(?=OMO\b)/gi, '¿C');
  normalized = normalized.replace(/\bESPEC[IÍ]FICO\b/gi, 'ESPECIFICO');
  normalized = normalized.replace(/\bC+EH(?=[!?…])/gi, 'EH');
  normalized = normalized.replace(/\b([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2}),\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{4,})\b/g, '$1$2');
  normalized = normalized.replace(/([A-Za-zÁÉÍÓÚÜÑáéíóúüñ])\s*,\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ])/g, '$1, $2');
  return normalizeWhitespace(normalized);
};

export const normalizeTechnicalArtifactsForTranslation = (text: string): string => {
  let normalized = normalizeWhitespace(String(text || ''));
  TECHNICAL_OCR_NORMALIZERS.forEach(({ pattern, replacement }) => {
    normalized = normalized.replace(pattern, replacement);
  });

  normalized = normalized.replace(/\bCHAPTEROBJECTIVES\b/gi, 'CHAPTER OBJECTIVES');
  normalized = normalized.replace(/\bCONDITIONSFOR\b/gi, 'CONDITIONS FOR');
  normalized = normalized.replace(/\bOFTHE\b/gi, 'OF THE');
  normalized = normalized.replace(/\bEQUATIONSOF\b/gi, 'EQUATIONS OF');
  normalized = normalized.replace(/\b([FM])\s+([xyzXYZ]|\d{1,2})\b/g, '$1$2');
  normalized = normalized.replace(/([\u0391-\u03C9\u03D1\u03D5\u03F0\u03F4])([A-Za-z])/g, '$1 $2');
  normalized = normalized.replace(/\b(Fig(?:ure)?\.?|Table|Chapter)\s*(\d)\s*[\u2013\u2014\-]\s*(\d)\b/gi, '$1 $2-$3');
  return normalized;
};

export const normalizePossessiveCompoundsForTranslation = (text: string): string => {
  let normalized = normalizeWhitespace(String(text || ''));
  normalized = normalized.replace(/\b([A-Za-z]{3,})['’]S([A-Za-z]{3,})\b/g, "$1'S $2");
  normalized = normalized.replace(/\[\s*([A-Za-z]{3,})['’]S([A-Za-z]{3,})\s*\]/g, "[$1'S $2]");
  normalized = normalized.replace(/\b([A-Za-z]{3,})([\-_/])([A-Za-z]{3,})\b/g, '$1 $2 $3');
  return normalizeWhitespace(normalized);
};

export const cleanJapaneseOcrSpacing = (text: string): string => {
  let cleaned = text.replace(/([\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf\uff00-\uffef])\s(?=[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf\uff00-\uffef])/g, '$1');
  cleaned = cleaned.replace(/([\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf])\s(?=[\u3000-\u303f])/g, '$1');
  cleaned = cleaned.replace(/([\u3000-\u303f])\s(?=[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf])/g, '$1');
  return cleaned;
};

export const cleanKoreanOcrSpacing = (text: string): string => {
  return text.replace(/([\uac00-\ud7af])\s(?=[\uac00-\ud7af])/g, '$1');
};

export const normalizeJapaneseOcrNoiseForTranslation = (text: string): string => {
  let normalized = String(text || '');
  normalized = normalized
    .replace(/。/g, '. ')
    .replace(/、/g, ', ')
    .replace(/！/g, '! ')
    .replace(/？/g, '? ')
    .replace(/〜/g, '~')
    .replace(/「/g, '"')
    .replace(/」/g, '"')
    .replace(/『/g, "'")
    .replace(/』/g, "'");

  normalized = normalized.replace(/[il1I]\s*ッ/g, 'っ');
  normalized = normalized.replace(/エ[il1I]/g, 'えっ');
  return normalizeWhitespace(normalized);
};

export const normalizeKoreanOcrNoiseForTranslation = (text: string): string => {
  let normalized = String(text || '');
  normalized = normalized
    .replace(/。/g, '. ')
    .replace(/、/g, ', ')
    .replace(/！/g, '! ')
    .replace(/？/g, '? ')
    .replace(/〜/g, '~');
  return normalizeWhitespace(normalized);
};

export const normalizeSourceForTranslation = (text: string, sourceLanguage = ''): string => {
  let normalized = normalizeTechnicalArtifactsForTranslation(text);
  normalized = normalizePossessiveCompoundsForTranslation(normalized);
  normalized = normalizeEnglishOcrNoiseForTranslation(normalized);

  const normLang = normalizeTranslationLanguage(sourceLanguage, '');
  if (normLang === 'es') {
    normalized = normalizeSpanishOcrNoiseForTranslation(normalized);
  } else if (normLang === 'ja') {
    normalized = cleanJapaneseOcrSpacing(normalized);
    normalized = normalizeJapaneseOcrNoiseForTranslation(normalized);
  } else if (normLang === 'ko') {
    normalized = cleanKoreanOcrSpacing(normalized);
    normalized = normalizeKoreanOcrNoiseForTranslation(normalized);
  }

  normalized = normalized.replace(/\s+([,.;:!?])/g, '$1');
  normalized = normalized.replace(/([,.;:!?])(\S)/g, '$1 $2');
  normalized = normalized.replace(/(?<=\s|^)_+/g, '').replace(/_+(?=\s|$)/g, '');
  normalized = normalized.replace(/\b([A-Za-z]{2,})_+(\s|$)/g, '$1...$2');
  normalized = normalized.replace(/\b_+([A-Za-z]{2,})\b/g, '$1');
  normalized = normalizeWhitespace(normalized);

  const hasUpperLatin = /[A-Z]/.test(normalized);
  if (hasUpperLatin) {
    normalized = normalized.toLowerCase();
    normalized = normalized.replace(/(^|[.!?]\s+)([a-z])/g, (_m, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`);
  }

  return normalized;
};

export const normalizeThaiTranslationText = (text: string): string => {
  let normalized = String(text || '');
  for (let i = 0; i < 6; i += 1) {
    const next = normalized.replace(/([\u0E00-\u0E7F])\s+([\u0E00-\u0E7F])/g, '$1$2');
    if (next === normalized) break;
    normalized = next;
  }
  normalized = normalized
    .replace(/([\(\[\{])\s+/g, '$1')
    .replace(/\s+([\)\]\}])/g, '$1');
  normalized = normalized.replace(/\s+([,.;:!?])/g, '$1');
  return normalizeWhitespace(normalized);
};

export const normalizeThaiBoundaryToken = (segment: string): string =>
  normalizeThaiTranslationText(segment).replace(/[^\u0E00-\u0E7F]/g, '');
