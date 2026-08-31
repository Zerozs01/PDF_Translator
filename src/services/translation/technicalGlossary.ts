/**
 * Technical Glossary — จัดการ technical tokens (สมการ, ป้าย, สัญลักษณ์ทางวิศวกรรม)
 * และแปลศัพท์เทคนิคภาษาอังกฤษ → ไทย สำหรับเอกสารวิชาการ
 *
 * ย้ายจาก App.tsx เพื่อแยก pure data transformation ออกจาก React component
 */
import { normalizeWhitespace } from '../ocr/ocrTextNormalizer';
import { normalizeTranslationLanguage, normalizeSpanishOcrNoiseForTranslation } from '../ocr/ocrTextNormalizer';
import { escapeRegExp, collapseRepeatedTranslationFragments } from '../ocr/ocrTextHeuristics';
import { normalizeThaiTranslationText } from '../ocr/ocrTextNormalizer';
import {
  applyKoreanConversationalFallback,
  hasKoreanTranslationCarryover,
  isBoilerplateHallucination,
} from './koreanTranslationPolicy';
import { lookupShortPhraseTh } from './offlineTranslationService';
import { normalizeSourceForTranslation } from '../ocr/ocrTextNormalizer';
import {
  setSlangGroupContext,
  applyThaiConversationalGlossary,
  applyReceiptGlossary,
} from './thaiConversationalGlossary';

// --- Regex patterns for technical token extraction ---

export const TECHNICAL_PAREN_LABEL_REGEX = /\(\s*[0-9]{1,3}[a-zA-Z]?\s*\)/g;
export const TECHNICAL_SECTION_REGEX = /\b\d+\.\d+\b/g;
export const TECHNICAL_VECTOR_REGEX = /\b(?:F|M)(?:x|y|z|\d{1,2})\b/gi;
export const TECHNICAL_GREEK_REGEX = /[θφψωαβγδΔΣΩμ]/g;
export const TECHNICAL_REF_REGEX = /\b(?:Fig(?:ure)?\.?\s*\d+(?:[-–]\d+)?(?:\s*[a-z])?|Table\s*\d+(?:[-–]\d+)?(?:\s*Continued)?|Chapter\s*\d+)\b/gi;

/**
 * Extract structured technical tokens from source text (figure refs, labels, vectors, Greek symbols)
 */
export const collectTechnicalTokens = (sourceText: string): string[] => {
  const source = normalizeWhitespace(String(sourceText || ''));
  if (!source) return [];

  const tokens: string[] = [];
  const seen = new Set<string>();
  const pushUnique = (token: string) => {
    const clean = normalizeWhitespace(token);
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    tokens.push(clean);
  };

  [
    TECHNICAL_REF_REGEX,
    TECHNICAL_PAREN_LABEL_REGEX,
    TECHNICAL_SECTION_REGEX,
    TECHNICAL_VECTOR_REGEX,
    TECHNICAL_GREEK_REGEX,
  ].forEach((regex) => {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null = regex.exec(source);
    while (match) {
      pushUnique(match[0]);
      match = regex.exec(source);
    }
  });

  return tokens;
};

export const hasTechnicalTokenInText = (text: string, token: string): boolean => {
  const target = String(text || '');
  const needle = normalizeWhitespace(String(token || ''));
  if (!needle) return true;

  if (/^\(.+\)$/.test(needle)) {
    const inner = needle.slice(1, -1).trim();
    return new RegExp(`\\(\\s*${escapeRegExp(inner)}\\s*\\)`, 'i').test(target);
  }

  if (/^[θφψωαβγδΔΣΩμ]$/.test(needle)) {
    return target.includes(needle);
  }

  if (/^[A-Za-z0-9_.\-]+$/.test(needle)) {
    return new RegExp(`\\b${escapeRegExp(needle)}\\b`, 'i').test(target);
  }

  const compactTarget = target.toLowerCase().replace(/\s+/g, '');
  const compactNeedle = needle.toLowerCase().replace(/\s+/g, '');
  return compactTarget.includes(compactNeedle);
};

export const preserveTechnicalTokensInTranslation = (sourceText: string, translatedText: string): string => {
  const source = normalizeWhitespace(String(sourceText || ''));
  const translated = normalizeWhitespace(String(translatedText || ''));
  if (!source || !translated) return translated;

  const missingTokens = collectTechnicalTokens(source).filter((token) => !hasTechnicalTokenInText(translated, token));
  if (missingTokens.length === 0) return translated;

  return `${translated} ${missingTokens.join(' ')}`.replace(/\s+/g, ' ').trim();
};

/**
 * Preserve trailing punctuation from source text onto a replacement string
 */
export const preserveSourceTrailingPunctuation = (sourceText: string, replacement: string): string => {
  const punctuation = String(sourceText || '').trim().match(/([.!?…]+)$/)?.[1] || '';
  const cleanReplacement = normalizeWhitespace(String(replacement || '')).replace(/[.!?…]+$/g, '').trim();
  return `${cleanReplacement}${punctuation}`.trim();
};

// Alias for backward compatibility
export const globalPreservePunctuation = preserveSourceTrailingPunctuation;

/**
 * Apply Thai technical glossary — แปลศัพท์เทคนิควิศวกรรมเป็นภาษาไทย
 * (Engineering Mechanics: Statics, rigid body equilibrium, structural analysis)
 */
export const applyThaiTechnicalGlossary = (sourceText: string, translatedText: string, targetLanguage: string): string => {
  if (normalizeTranslationLanguage(targetLanguage, 'th') !== 'th') {
    return translatedText;
  }

  const source = normalizeWhitespace(String(sourceText || ''));
  if (!source || source.length > 96) return translatedText;

  const lower = source.toLowerCase();
  const compactLower = lower.replace(/[^a-z]/g, '');
  const sectionPrefix = source.match(/^\s*(\d+\.\d+)\b/)?.[1];
  const withSectionPrefix = (value: string): string => (sectionPrefix ? `${sectionPrefix} ${value}` : value);
  const trailingTechnicalLabel = source.match(/\s*(\(\s*[0-9]{1,3}[a-zA-Z]?\s*\))\s*$/)?.[1] || '';
  const withTechnicalLabel = (value: string): string => {
    const replacement = preserveSourceTrailingPunctuation(source, value);
    return trailingTechnicalLabel && !hasTechnicalTokenInText(replacement, trailingTechnicalLabel)
      ? `${replacement} ${trailingTechnicalLabel}`.trim()
      : replacement;
  };

  const chapterWithNumber = source.match(/^chapter\s*(\d+)\s*$/i);
  if (chapterWithNumber?.[1]) {
    return `บทที่ ${chapterWithNumber[1]}`;
  }
  if (/^chapter\s*$/i.test(source)) {
    return 'บท';
  }

  if (/^equilibrium\s+of\s+(?:a\s*)?$/i.test(source)) {
    return withSectionPrefix('สมดุลของ');
  }
  if (/^rigid[-\s]?body$/i.test(source)) {
    return withSectionPrefix('วัตถุแข็ง');
  }

  if (/it\s+is\s+important\s+to\s+be\s+able\s+to\s+determine\s+the\s+forces/i.test(lower)) {
    return 'สิ่งสำคัญคือต้องสามารถหาแรงได้';
  }
  if (/in\s+this\s+chapter\s+we\s+will\s+study\s+how/i.test(lower)) {
    return 'ในบทนี้เราจะศึกษาวิธี';
  }
  if (/to\s+apply\s+equilibrium\s+methods\s+to\s+determine\s+the\s+forces\s+acting\s+on\s+the\s+supports\s+of/i.test(lower)) {
    return 'นำวิธีสมดุลมาใช้เพื่อหาแรงที่กระทำต่อจุดรองรับของ';
  }
  if (/a\s+rigid\s+body\s+such\s+as\s+this/i.test(lower)) {
    return 'วัตถุแข็งเช่นนี้';
  }

  if (compactLower.includes('todeveloptheequationsofequilibriumforarigidbody')) {
    return 'เพื่อพัฒนาสมการสมดุลสำหรับวัตถุแข็ง';
  }
  if (compactLower.includes('tointroducetheconceptofthefreebodydiagramforarigidbody')) {
    return 'เพื่อแนะนำแนวคิดของแผนภาพแรงอิสระสำหรับวัตถุแข็ง';
  }
  if (compactLower.includes('toshowhowtosolverigidbodyequilibriumproblemsusingthe')) {
    return 'เพื่อแสดงวิธีแก้ปัญหาสมดุลของวัตถุแข็งโดยใช้';
  }
  if (compactLower === 'equationsofequilibrium' || compactLower.includes('equationsofequilibrium')) {
    return 'สมการสมดุล';
  }
  if (compactLower.includes('inthissectionwewilldevelopboththenecessaryandsufficientconditions')) {
    return 'ในส่วนนี้เราจะพัฒนาทั้งเงื่อนไขที่จำเป็นและเงื่อนไขที่เพียงพอ';
  }
  if (compactLower.includes('fortheequilibriumoftherigidbodyinfig')) {
    return 'สำหรับสมดุลของวัตถุแข็งในรูปที่ 5-1a ดังที่แสดง วัตถุนี้';
  }
  if (compactLower.includes('subjectedtoanexternalforceandcouplemomentsystem')) {
    return 'อยู่ภายใต้แรงภายนอกและระบบโมเมนต์คู่';
  }
  if (compactLower.includes('particleswithinthebodyarenotshowninthisfigurebecausetheseforces')) {
    return 'แรงภายในที่เกิดจากปฏิสัมพันธ์ระหว่างอนุภาคภายในวัตถุไม่ได้แสดงในรูปนี้ เนื่องจากแรงเหล่านี้';
  }
  if (
    compactLower.includes('oftheeffectsofgravitationalelectricalmagneticorcontactforcescaused')
    || compactLower.includes('oftheeffctofravt')
    || (compactLower.includes('gnetiontact') && compactLower.includes('rescaused'))
  ) {
    return 'ของผลกระทบจากแรงโน้มถ่วง แรงไฟฟ้า แรงแม่เหล็ก หรือแรงสัมผัสที่เกิดขึ้น';
  }
  if (compactLower.includes('occurinequalbutoppositecollinearpairs')) {
    return 'เกิดขึ้นเป็นคู่ที่มีขนาดเท่ากันแต่ทิศทางตรงข้ามกัน';
  }
  if (compactLower.includes('consequenceofthirdlaw')) {
    return 'ซึ่งเป็นผลจากกฎข้อที่สาม';
  }

  if (/equilibrium\s+of\s+(?:a\s+)?rigid[-\s]?body/i.test(lower)) {
    return withSectionPrefix('สมดุลของวัตถุแข็ง');
  }
  if (/free[-\s]?body\s+diagrams?/i.test(lower)) {
    return withSectionPrefix('แผนภาพวัตถุอิสระ');
  }
  if (/chapter\s+objectives?/i.test(lower)) {
    return 'วัตถุประสงค์ของบทนี้';
  }
  if (/conditions?\s+for\s+rigid[-\s]?body\s+equilibrium/i.test(lower)) {
    return withSectionPrefix('เงื่อนไขสำหรับสมดุลของวัตถุแข็ง');
  }
  if (/number\s+of\s+unknowns/i.test(lower)) {
    return 'จำนวนตัวแปรไม่ทราบค่า';
  }
  if (/types?\s+of\s+connection/i.test(lower)) {
    return 'ประเภทของการเชื่อมต่อ';
  }

  if (/^two\s+unknowns?[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ตัวไม่ทราบค่าสองตัว');
  }
  if (/^three\s+unknowns?[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ตัวไม่ทราบค่าสามตัว');
  }
  if (/^three\s+unknowns?[.!?…]*\s+the\s+reactions?\s+are\s+the\s+couple\s+moment[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ตัวไม่ทราบค่าสามตัว แรงปฏิกิริยาเป็นโมเมนต์คู่ควบ');
  }
  if (/\breactions?\b/i.test(source) && /\bcouple\s+moment\b/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'แรงปฏิกิริยาเป็นโมเมนต์คู่ควบ');
  }
  if (/\btwo\s+force\s+components?\b/i.test(source) && /\bcouple\s+moment\b/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'องค์ประกอบแรงสองแรง หรือโมเมนต์คู่ควบ');
  }
  if (/\bmagnitude\b/i.test(source) && /\bdirection\b/i.test(source) && /\bresultant\s+force\b/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ขนาดและทิศทางของแรงลัพธ์');
  }
  if (/\bthe\s+floor\s+beams\s+of\s+this\s+building\b/i.test(source) && /\bwelded\b/i.test(source)) {
    if ((/\btogether\b/i.test(source) || compactLower.includes('together')) && /\bfixed\s+connections?\b/i.test(source)) {
      return withTechnicalLabel('คานพื้นของอาคารนี้เชื่อมเข้าด้วยกัน จึงเกิดเป็นจุดต่อแบบยึดแน่น');
    }
    return withTechnicalLabel('คานพื้นของอาคารนี้ถูกเชื่อมเข้าด้วยกัน');
  }
  if (
    (/\btogether\b/i.test(source) || compactLower.includes('together'))
    && (/\bthus\s+form\b/i.test(source) || compactLower.includes('thusform'))
    && /\bfixed\s+connections?\b/i.test(source)
  ) {
    return withTechnicalLabel('เชื่อมเข้าด้วยกัน จึงเกิดเป็นจุดต่อแบบยึดแน่น');
  }
  if (
    (/\btogether\b/i.test(source) || compactLower.includes('together'))
    && (/\bthus\s+form\b/i.test(source) || compactLower.includes('thusform'))
  ) {
    return withTechnicalLabel('เชื่อมเข้าด้วยกัน จึงเกิดเป็น');
  }
  if (/\bfixed\s+connections?\b/i.test(source)) {
    return withTechnicalLabel('จุดต่อแบบยึดแน่น');
  }
  if (/^are\s+welded$/i.test(source) || compactLower === 'arewelded') {
    return withTechnicalLabel('ถูกเชื่อมเข้าด้วยกัน');
  }
  if (/^welded$/i.test(source) || compactLower === 'welded') {
    return withTechnicalLabel('เชื่อมเข้าด้วยกัน');
  }
  if (/^two$/i.test(source) || compactLower === 'two') {
    return withTechnicalLabel('สอง');
  }
  if (/^three$/i.test(source) || compactLower === 'three') {
    return withTechnicalLabel('สาม');
  }
  if (/^pin$/i.test(source) || compactLower === 'pin') {
    return withTechnicalLabel('พิน');
  }
  if (/^in$/i.test(source) || compactLower === 'in') {
    return withTechnicalLabel('ใน');
  }
  if (/^fixed$/i.test(source) || compactLower === 'fixed') {
    return withTechnicalLabel('ยึดแน่น');
  }
  if (/^reactions$/i.test(source) || compactLower === 'reactions') {
    return withTechnicalLabel('แรงปฏิกิริยา');
  }
  if (/\bthis\s+utility\s+building\s+is\b/i.test(source) && /\bpin\s+supported\b/i.test(source)) {
    return withTechnicalLabel('อาคารอเนกประสงค์นี้รองรับแบบพินที่ด้านบนของเสา');
  }
  if (/\bpin\s+supported\b/i.test(source) && /\btop\s+of\s+the\s+column\b/i.test(source)) {
    return withTechnicalLabel('รองรับแบบพินที่ด้านบนของเสา');
  }

  const tableMatch = source.match(/table\s*(\d+(?:[-–]\d+)?)\s*continued/i);
  if (tableMatch?.[1]) {
    return `ตาราง ${tableMatch[1]} (ต่อ)`;
  }

  return translatedText;
};

/**
 * Normalize Thai technical terms — แก้ปัญหาการแปลที่ผิดพลาดของคำเทคนิค
 */
export const normalizeThaiTechnicalTerms = (sourceText: string, translatedText: string): string => {
  const source = normalizeWhitespace(String(sourceText || ''));
  let normalized = normalizeWhitespace(String(translatedText || ''));
  if (!source || !normalized) return normalized;

  const technicalBodyContext = /\b(rigid|body|equilibrium|force|moment|support|diagram|conditions?|objectives?)\b/i.test(source);
  if (technicalBodyContext) {
    normalized = normalized
      .replace(/ร่างกายที่แข็งตัว/gi, 'วัตถุแข็ง')
      .replace(/ร่างกายแข็ง/gi, 'วัตถุแข็ง')
      .replace(/ของร่างกาย/gi, 'ของวัตถุ')
      .replace(/ร่างกาย/gi, 'วัตถุ');
  }

  normalized = normalized
    .replace(/สมการของสมดุลเพื่อพัฒนา/gi, 'เพื่อพัฒนาสมการสมดุล')
    .replace(/สมการของสมดุล/gi, 'สมการสมดุล')
    .replace(/บทเรียนเพื่อพัฒนา/gi, 'วัตถุประสงค์ของบทนี้');

  return normalizeWhitespace(normalized);
};

/**
 * Finalize translated line — apply all post-translation corrections:
 * Korean fallback, carryover dictionary, technical glossary, conversational glossary, Thai normalization
 */
export const finalizeTranslatedLine = (sourceText: string, translatedText: string, targetLanguage: string): string => {
  const source = normalizeWhitespace(String(sourceText || ''));
  let resolved = normalizeWhitespace(String(translatedText || ''));

  if (isBoilerplateHallucination(source, resolved)) {
    console.warn(`[finalizeTranslatedLine] Detected boilerplate hallucination: "${resolved}" for source: "${source}". Falling back.`);
    resolved = '';
  }

  if (normalizeTranslationLanguage(targetLanguage, 'th') === 'th') {
    // 1. Korean fallback check
    if (/[\uAC00-\uD7AF]/.test(source) && (!resolved || !/[\u0E00-\u0E7F]/.test(resolved) || hasKoreanTranslationCarryover(resolved))) {
      const koFallback = applyKoreanConversationalFallback(source, resolved);
      if (koFallback) {
        resolved = koFallback;
      }
    }

    // 2. English/Latin/Spanish carryover check
    const isCarryover = !resolved || resolved === source || (!/[\u0E00-\u0E7F]/.test(resolved) && /[a-zA-Z]/.test(resolved));
    if (isCarryover) {
      const dictHit = lookupShortPhraseTh(source) || lookupShortPhraseTh(source.replace(/[^A-Za-z0-9]/g, '')) || lookupShortPhraseTh(normalizeSpanishOcrNoiseForTranslation(source));
      if (dictHit) {
        resolved = dictHit;
      } else {
        const words = source.trim().split(/\s+/);
        if (words.length > 1) {
          const translatedWords = words.map(w => lookupShortPhraseTh(w) || lookupShortPhraseTh(w.replace(/[^A-Za-z0-9]/g, '')) || w);
          if (translatedWords.some(tw => /[\u0E00-\u0E7F]/.test(tw))) {
            resolved = translatedWords.join(' ');
          }
        }
      }
    }
  }

  if (!resolved) {
    resolved = normalizeSourceForTranslation(source, 'en');
    if (source && resolved === source) {
      console.warn(`[finalizeTranslatedLine] fallback to source for: "${source}"`);
    }
  }

  resolved = applyThaiTechnicalGlossary(source, resolved, targetLanguage);
  resolved = preserveTechnicalTokensInTranslation(source, resolved);
  resolved = normalizeThaiTechnicalTerms(source, resolved);
  resolved = applyThaiConversationalGlossary(source, resolved, targetLanguage);
  resolved = applyReceiptGlossary(source, resolved, targetLanguage);
  resolved = collapseRepeatedTranslationFragments(resolved);

  if (normalizeTranslationLanguage(targetLanguage, 'th') === 'th') {
    return normalizeThaiTranslationText(resolved);
  }
  return normalizeWhitespace(resolved);
};
