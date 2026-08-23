import {
  normalizeWhitespace,
  normalizeTranslationLanguage,
  normalizeSpanishOcrNoiseForTranslation,
  normalizeEnglishOcrNoiseForTranslation,
  normalizeSourceForTranslation
} from '../ocr/ocrTextNormalizer';

import {
  THAI_REGEX,
  buildTranslationComparisonKey
} from '../ocr/ocrTextHeuristics';

import { useOCRTextLayerStore } from '../../stores/useOCRTextLayerStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { applyKoreanConversationalFallback } from './koreanTranslationPolicy';
import { lookupShortPhraseTh } from './offlineTranslationService';

const preserveSourceTrailingPunctuation = (sourceText: string, replacement: string): string => {
  const punctuation = String(sourceText || '').trim().match(/([.!?…]+)$/)?.[1] || '';
  const cleanReplacement = normalizeWhitespace(String(replacement || '')).replace(/[.!?…]+$/g, '').trim();
  return `${cleanReplacement}${punctuation}`.trim();
};

const globalPreservePunctuation = preserveSourceTrailingPunctuation;

/**
 * Module-level slang group context: set by the translation pipeline before processing
 * each group's per-line translations. Used in applyThaiConversationalGlossary to detect
 * multi-line balloon patterns (e.g. "DiE BY MY COCK! COME ON!!") without relying on
 * Zustand store timing which is unreliable during async translation.
 */
let _slangGroupContext = '';
export const setSlangGroupContext = (groupLinesText: string): void => {
  _slangGroupContext = groupLinesText;
};

export const applyThaiConversationalGlossary = (
  sourceText: string,
  translatedText: string,
  targetLanguage: string
): string => {
  let finalResult = applyThaiConversationalGlossaryInternal(sourceText, translatedText, targetLanguage);

  // Rule 4.1: จิ๋ม ห้ามอยู่ใน balloon เดียวกับ หี
  if (finalResult.includes('หี') && finalResult.includes('จิ๋ม')) {
    finalResult = finalResult.replace(/จิ๋ม/g, 'หี');
  }
  // Rule 4.2: ไก่ ห้ามอยู่ใน balloon เดียวกับ ควย
  if (finalResult.includes('ควย') && finalResult.includes('ไก่')) {
    finalResult = finalResult.replace(/ไก่/g, 'ควย');
  }

  return finalResult;
};

const applyThaiConversationalGlossaryInternal = (
  sourceText: string,
  translatedText: string,
  targetLanguage: string
): string => {
  if (normalizeTranslationLanguage(targetLanguage, 'th') !== 'th') {
    return translatedText;
  }

  const rawLang = useOCRTextLayerStore.getState().options.language || useProjectStore.getState().sourceLanguage || 'en';
  const sourceLang = normalizeTranslationLanguage(rawLang, 'en');

  const sourceOriginal = normalizeWhitespace(String(sourceText || ''));
  const preserveSourceTrailingPunctuation = (dummy: string, replacement: string): string => {
    return globalPreservePunctuation(sourceOriginal, replacement);
  };

  let source = normalizeEnglishOcrNoiseForTranslation(sourceOriginal);
  const translated = normalizeWhitespace(String(translatedText || ''));
  if (!source) return translated;
  const normalizedSpanishSource = normalizeSpanishOcrNoiseForTranslation(source);

  // Dispatch localized slang tables
  if (sourceLang === 'es') {
    let esResult = translated;
    const compactES = sourceOriginal.toLowerCase().replace(/[^a-z¡!¿?]/g, '');
    
    if (compactES.includes('joder')) {
      const isAngry = sourceOriginal.includes('!') || sourceOriginal.includes('¡') || esResult.includes('โกรธ') || esResult.includes('ตาย');
      esResult = isAngry ? 'เชี่ยเอ๊ย!' : 'เวรเอ๊ย!';
    } else if (compactES.includes('coño') || compactES.includes('cono')) {
      esResult = 'บ้าเอ๊ย!';
    } else if (compactES.includes('maldicion') || compactES.includes('maldición')) {
      esResult = sourceOriginal.includes('!') ? 'แม่งเอ๊ย!' : 'ซวยแล้ว!';
    } else if (compactES.includes('mierda')) {
      esResult = sourceOriginal.includes('!') ? 'ฉิบหาย!' : 'แย่แล้ว';
    } else if (compactES.includes('ay')) {
      esResult = sourceOriginal.includes('!') || sourceOriginal.includes('¡') ? 'โอ๊ย!' : 'เอ๊ะ!';
    }
    
    if (esResult !== translated) {
      return preserveSourceTrailingPunctuation(sourceOriginal, esResult);
    }

    const esShortPhrase = lookupShortPhraseTh(normalizedSpanishSource) || lookupShortPhraseTh(sourceOriginal);
    if (esShortPhrase) {
      return preserveSourceTrailingPunctuation(sourceOriginal, esShortPhrase);
    }
  }

  if (sourceLang === 'ja') {
    let jaResult = translated;
    const compactJA = sourceOriginal.trim();
    
    if (compactJA === 'えっ' || compactJA === 'エッ' || compactJA === 'えっ!?' || compactJA === 'エッ!?') {
      jaResult = 'เอ๊ะ!?';
    } else if (compactJA === 'えっ!' || compactJA === 'エッ!') {
      jaResult = 'เอ๊ะ!';
    } else if (compactJA === 'はあ' || compactJA === 'はぁ') {
      jaResult = 'เฮ้อ...';
    } else if (compactJA === 'はあ...' || compactJA === 'はぁ...') {
      jaResult = 'เฮ้อ...';
    } else if (compactJA === 'うう' || compactJA === 'うぅ') {
      jaResult = 'อึ้ก...';
    } else if (compactJA === 'うう...' || compactJA === 'うぅ...') {
      jaResult = 'อึ้ก...';
    }
    
    if (jaResult !== translated) {
      return preserveSourceTrailingPunctuation(sourceOriginal, jaResult);
    }
  }

  if (sourceLang === 'ko') {
    let koResult = translated;
    const compactKO = sourceOriginal.trim();
    
    if (compactKO.includes('씨발')) {
      koResult = 'เชี่ยเอ๊ย!';
    } else if (compactKO === '헐' || compactKO === '헐!') {
      koResult = 'เห้ย!';
    } else if (compactKO === '아저씨') {
      koResult = 'คุณลุง';
    } else if (compactKO === '아줌มา') {
      koResult = 'คุณป้า';
    }
    
    if (koResult !== translated) {
      return preserveSourceTrailingPunctuation(sourceOriginal, koResult);
    }
  }

  // A version of source that is repaired for OCR noise but not collapsed for vocal elongations.
  const sourceUncollapsed = normalizeWhitespace(String(sourceOriginal || ''))
    .replace(/\b7OCKS\b/gi, 'COCKS')
    .replace(/\b70CKS\b/gi, 'COCKS')
    .replace(/\bC0CKS?\b/gi, 'COCKS')
    .replace(/\bC0CK\b/gi, 'COCK')
    .replace(/,?KN[iI]+GHT\b/gi, 'KNIGHT');

  const compactSource = sourceUncollapsed.toLowerCase().replace(/[^a-z]/g, '');
  const compactSourceUpper = sourceUncollapsed.toUpperCase().replace(/[^A-Z]/g, '');
  const compactSourceAlnumUpper = sourceUncollapsed.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const compactSourceAsciiUpper = sourceUncollapsed
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

  const koreanFallback = applyKoreanConversationalFallback(source, translated);
  if (koreanFallback) {
    return koreanFallback;
  }

  // Context-based multi-line slang bubble checks
  // Primary: use module-level group context set by translation pipeline (reliable, per-group)
  // Fallback: use Zustand OCR store (may be stale/empty during async All-Pages translation)
  let compactPageTexts = _slangGroupContext;
  if (!compactPageTexts) {
    try {
      const ocrStore = useOCRTextLayerStore.getState();
      if (ocrStore) {
        if (ocrStore.currentPageOCR && ocrStore.currentPageOCR.lines) {
          compactPageTexts += ' ' + ocrStore.currentPageOCR.lines.map(l => l.text || '').join(' ');
        }
        if (ocrStore.ocrByPageEngine) {
          for (const engineMap of ocrStore.ocrByPageEngine.values()) {
            if (engineMap) {
              for (const pageResult of engineMap.values()) {
                if (pageResult && pageResult.lines) {
                  compactPageTexts += ' ' + pageResult.lines.map(l => l.text || '').join(' ');
                }
              }
            }
          }
        }
      }
    } catch (err) {}
  }
  const compactPageTextsUpper = compactPageTexts.toUpperCase().replace(/[^A-Z0-9]/g, '');

  if (compactPageTextsUpper.includes('DIEBYMYCOCK')) {
    if (compactSourceAlnumUpper === 'DIE') {
      return preserveSourceTrailingPunctuation(source, 'ตายซะ');
    }
    if (compactSourceAlnumUpper === 'BYMY') {
      return preserveSourceTrailingPunctuation(source, 'ด้วย');
    }
    if (compactSourceAlnumUpper === 'COCK') {
      return preserveSourceTrailingPunctuation(source, 'ไอ้จู๋ของฉัน');
    }
    if (compactSourceAlnumUpper === 'COME') {
      return preserveSourceTrailingPunctuation(source, 'เร็วๆ');
    }
    if (compactSourceAlnumUpper === 'ON') {
      return preserveSourceTrailingPunctuation(source, 'เข้า');
    }
  }

  if (compactPageTextsUpper.includes('HOWDOTHEYKEEP') || (compactPageTextsUpper.includes('THEYKEEP') && compactPageTextsUpper.includes('CUUUUM'))) {
    if (compactSourceAlnumUpper === 'HOW') {
      return preserveSourceTrailingPunctuation(source, 'ได้อย่างไร');
    }
    if (compactSourceAlnumUpper === 'HOWDO') {
      return preserveSourceTrailingPunctuation(source, 'ทำไม');
    }
    if (compactSourceAlnumUpper === 'THEYKEEP') {
      return preserveSourceTrailingPunctuation(source, 'พวกเขายัง');
    }
    if (compactSourceAlnumUpper === 'MAKEINGME' || compactSourceAlnumUpper === 'MAKINGME') {
      return preserveSourceTrailingPunctuation(source, 'ทำให้ฉัน');
    }
    if (/^CU+M+$/i.test(compactSourceAlnumUpper)) {
      return preserveSourceTrailingPunctuation(source, 'น้ำแตกกกกได้อีก');
    }
  }

  if (compactPageTextsUpper.includes('MYHEARTSBEINGTORNBYTHEIRCOCKS') || compactPageTextsUpper.includes('MYHEARTBEINGTORNBYTHEIRCOCKS')) {
    if (compactSourceAlnumUpper === 'MY') {
      return preserveSourceTrailingPunctuation(source, 'หัวใจของฉัน');
    }
    if (compactSourceAlnumUpper === 'HEARTS' || compactSourceAlnumUpper === 'HEART') {
      return preserveSourceTrailingPunctuation(source, 'กำลัง');
    }
    if (compactSourceAlnumUpper === 'BEING') {
      return preserveSourceTrailingPunctuation(source, 'ถูก');
    }
    if (compactSourceAlnumUpper === 'TORNBY') {
      return preserveSourceTrailingPunctuation(source, 'ฉีกกระชาก');
    }
    if (compactSourceAlnumUpper === 'THEIR') {
      return preserveSourceTrailingPunctuation(source, 'ด้วย');
    }
    if (compactSourceAlnumUpper === 'COCKS' || compactSourceAlnumUpper === 'COCK') {
      return preserveSourceTrailingPunctuation(source, 'ควยของพวกมัน');
    }
  }

  if (compactPageTextsUpper.includes('SUCKINGCOCK') && (compactPageTextsUpper.includes('REALPIG') || compactPageTextsUpper.includes('PIG'))) {
    if (compactSourceAlnumUpper === 'IM' || compactSourceAlnumUpper === 'IIM') {
      return preserveSourceTrailingPunctuation(source, 'ฉัน');
    }
    if (compactSourceAlnumUpper === 'SUCKING') {
      return preserveSourceTrailingPunctuation(source, 'กำลังดูด');
    }
    if (compactSourceAlnumUpper === 'COCKAND') {
      return preserveSourceTrailingPunctuation(source, 'อวัยวะเพศชายและ');
    }
    if (compactSourceAlnumUpper === 'GRUNTING') {
      return preserveSourceTrailingPunctuation(source, 'คราง');
    }
    if (compactSourceAlnumUpper === 'LIKEA') {
      return preserveSourceTrailingPunctuation(source, 'เหมือน');
    }
    if (compactSourceAlnumUpper === 'REALPIG') {
      return preserveSourceTrailingPunctuation(source, 'หมูตัวจริง');
    }
  }

  if (compactPageTextsUpper.includes('SHUPUPWE') || (compactPageTextsUpper.includes('SHUP') && (compactPageTextsUpper.includes('PRINCESS') || compactPageTextsUpper.includes('PRIN') || compactPageTextsUpper.includes('CESS')))) {
    if (compactSourceAlnumUpper === 'SHUP') {
      return preserveSourceTrailingPunctuation(source, 'หุบปาก');
    }
    if (compactSourceAlnumUpper === 'UP') {
      return preserveSourceTrailingPunctuation(source, 'ซะ');
    }
    if (compactSourceAlnumUpper === 'WEVE') {
      return preserveSourceTrailingPunctuation(source, 'ฉัน');
    }
    if (compactSourceAlnumUpper === 'ALWAYS') {
      return preserveSourceTrailingPunctuation(source, 'มาตลอดเลยนะ');
    }
    if (compactSourceAlnumUpper === 'WANTED') {
      return preserveSourceTrailingPunctuation(source, 'อยากจะ');
    }
    if (compactSourceAlnumUpper === 'TOFUCK') {
      return preserveSourceTrailingPunctuation(source, 'เย็ด');
    }
    if (compactSourceAlnumUpper === 'THESHIT') {
      return preserveSourceTrailingPunctuation(source, 'ให้เละเทะ');
    }
    if (compactSourceAlnumUpper === 'OUTTA') {
      return preserveSourceTrailingPunctuation(source, 'เธอ');
    }
    if (compactSourceAlnumUpper === 'YOU') {
      return preserveSourceTrailingPunctuation(source, 'แก');
    }
    if (compactSourceAlnumUpper === 'DUMB') {
      return preserveSourceTrailingPunctuation(source, 'อี');
    }
    if (compactSourceAlnumUpper === 'PRIN') {
      return preserveSourceTrailingPunctuation(source, 'เจ้าหญิง');
    }
    if (compactSourceAlnumUpper === 'CESS') {
      return preserveSourceTrailingPunctuation(source, 'โง่');
    }
  }

  // ─── UGH, HAA! HER PUSSY'S SO STiNKY ───
  if (compactPageTextsUpper.includes('HERPUSSY') && (compactPageTextsUpper.includes('STINKY') || compactPageTextsUpper.includes('STiNKY') || compactPageTextsUpper.includes('UGH'))) {
    if (compactSourceAlnumUpper === 'UGH' || compactSourceAlnumUpper === 'UGH,') {
      return preserveSourceTrailingPunctuation(source, 'อึก..');
    }
    if (compactSourceAlnumUpper === 'HAA' || compactSourceAlnumUpper === 'HAA!') {
      return preserveSourceTrailingPunctuation(source, 'ฮาห์!');
    }
    if (compactSourceAlnumUpper === 'HER') {
      return preserveSourceTrailingPunctuation(source, 'ของเธอ');
    }
    if (compactSourceAlnumUpper === 'PUSSY' || compactSourceAlnumUpper === 'PUSSY\'S' || compactSourceAlnumUpper === 'PUSSYS') {
      return preserveSourceTrailingPunctuation(source, 'หี');
    }
    if (compactSourceAlnumUpper === 'SO' || compactSourceAlnumUpper === '6O' || compactSourceAlnumUpper === '60' || compactSourceAlnumUpper === 'S0') {
      return preserveSourceTrailingPunctuation(source, 'มัน');
    }
    if (compactSourceAlnumUpper === 'STINKY' || compactSourceAlnumUpper === 'STiNKY') {
      return preserveSourceTrailingPunctuation(source, 'ตุๆ');
    }
  }

  // ─── HEHEHE! YOUR PUSSY'S REAL TIGHT BECAUSE OF YOUR TRAINING! ───
  if ((compactPageTextsUpper.includes('YOURPUSSY') || compactPageTextsUpper.includes('REALTIGHT')) && compactPageTextsUpper.includes('TRAINING')) {
    if (compactSourceAlnumUpper === 'HEHEHE' || compactSourceAlnumUpper === 'HEHEHE!') {
      return preserveSourceTrailingPunctuation(source, 'ฮิ ฮิ ฮิ!');
    }
    if (compactSourceAlnumUpper === 'YOURPUSSY' || compactSourceAlnumUpper === 'YOURPUSSY\'S' || compactSourceAlnumUpper === 'YOURPUSSYS') {
      return preserveSourceTrailingPunctuation(source, 'หีของเธอ');
    }
    if (compactSourceAlnumUpper === 'REALTIGHT') {
      return preserveSourceTrailingPunctuation(source, 'แน่นจริงๆ');
    }
    if (compactSourceAlnumUpper === 'BECAUSEOF' || compactSourceAlnumUpper === 'BECAUSE') {
      return preserveSourceTrailingPunctuation(source, 'เพราะ');
    }
    if (compactSourceAlnumUpper === 'OF') {
      return preserveSourceTrailingPunctuation(source, 'ของ');
    }
    if (compactSourceAlnumUpper === 'YOURTRAINING' || compactSourceAlnumUpper === 'TRAINING') {
      return preserveSourceTrailingPunctuation(source, 'การฝึกของเธอ!');
    }
    if (compactSourceAlnumUpper === 'ITSTHEFIRST' || compactSourceAlnumUpper === 'ITSTHE' || compactSourceAlnumUpper === 'FIRST') {
      return preserveSourceTrailingPunctuation(source, 'นี่เป็นครั้งแรก');
    }
    if (compactSourceAlnumUpper === 'HIGHQUALITY') {
      return preserveSourceTrailingPunctuation(source, 'คุณภาพยอดเยี่ยม');
    }
    if (compactSourceAlnumUpper === 'PUSSYWEVE' || compactSourceAlnumUpper === 'WEVE') {
      return preserveSourceTrailingPunctuation(source, 'หีที่เรามี');
    }
    if (compactSourceAlnumUpper === 'HADINA' || compactSourceAlnumUpper === 'HADIN') {
      return preserveSourceTrailingPunctuation(source, 'ในรอบ');
    }
    if (compactSourceAlnumUpper === 'WHILE' || compactSourceAlnumUpper === 'WHILE!') {
      return preserveSourceTrailingPunctuation(source, 'หลายวัน!');
    }
  }

  // ─── OF ALL OF US! ───
  if (compactPageTextsUpper.includes('OFALLOFUS') || (compactPageTextsUpper.includes('ALLOFUS') && compactPageTextsUpper.includes('OF'))) {
    if (compactSourceAlnumUpper === 'OF') {
      return preserveSourceTrailingPunctuation(source, 'ของ');
    }
    if (compactSourceAlnumUpper === 'ALL') {
      return preserveSourceTrailingPunctuation(source, 'ทุกคน');
    }
    if (compactSourceAlnumUpper === 'US' || compactSourceAlnumUpper === 'US!') {
      return preserveSourceTrailingPunctuation(source, 'พวกเรา!');
    }
  }

  // ─── Page-context word-order fix: YOU FOUND A DISEASE? ─────────────────────
  // When each line of the balloon is translated separately, we need context to
  // reassemble the correct Thai sentence order.
  if (
    compactPageTextsUpper.includes('YOUFOUNDADISEASE') ||
    (compactPageTextsUpper.includes('FOUNDA') && compactPageTextsUpper.includes('DISEASE'))
  ) {
    if (compactSourceAlnumUpper === 'YOU' || compactSourceAlnumUpper === 'NOU') {
      return preserveSourceTrailingPunctuation(source, 'คุณ');
    }
    if (compactSourceAlnumUpper === 'FOUNDA' || compactSourceAlnumUpper === 'FOUND') {
      return preserveSourceTrailingPunctuation(source, 'พบ');
    }
    if (compactSourceAlnumUpper === 'A') {
      return preserveSourceTrailingPunctuation(source, '');
    }
    if (compactSourceAlnumUpper === 'DISEASE') {
      return preserveSourceTrailingPunctuation(source, 'โรคเหรอ');
    }
  }

  // ─── Page-context word-order fix: HEAD NURSE multi-line balloon ─────────────
  if (
    compactPageTextsUpper.includes('HEADNURS') ||
    (compactPageTextsUpper.includes('HEAD') && compactPageTextsUpper.includes('NURSE'))
  ) {
    if (compactSourceAlnumUpper.includes('FORSOME')) {
      return preserveSourceTrailingPunctuation(source, 'สำหรับเหตุผลบางอย่าง');
    }
    if (compactSourceAlnumUpper.includes('HEAD')) {
      return preserveSourceTrailingPunctuation(source, 'หัวหน้า');
    }
    if (compactSourceAlnumUpper.includes('NURSE') || (compactSourceAlnumUpper.includes('NUR') && compactSourceAlnumUpper.includes('SE'))) {
      return preserveSourceTrailingPunctuation(source, 'พยาบาล');
    }
    if (compactSourceAlnumUpper.includes('RIGHTNOW')) {
      return preserveSourceTrailingPunctuation(source, 'ในตอนนี้');
    }
  }

  // ─── HAHAHA! YOU'VE GOT A NICELY PLOWED WET PUSSY, DON'T YOU? HOW MUCH DID YOU DO IT WITH THE BARBARIANS ───
  if (compactPageTextsUpper.includes('BARBARIANS') || (compactPageTextsUpper.includes('PLOWED') && compactPageTextsUpper.includes('WETPUSSY'))) {
    if (compactSourceAlnumUpper === 'HAHAHA' || compactSourceAlnumUpper === 'HAHAHA!') {
      return preserveSourceTrailingPunctuation(source, 'ฮ่าฮ่าฮ่า!');
    }
    if (compactSourceAlnumUpper === 'YOUVEGOTA' || compactSourceAlnumUpper === 'YOUVEGOT' || compactSourceAlnumUpper === 'YOUVE') {
      return preserveSourceTrailingPunctuation(source, 'เธอมี');
    }
    if (compactSourceAlnumUpper === 'NICELYPLOWED' || compactSourceAlnumUpper === 'NICELY' || compactSourceAlnumUpper === 'PLOWED') {
      return preserveSourceTrailingPunctuation(source, 'ที่ถูกไถอย่างดีแล้ว');
    }
    if (compactSourceAlnumUpper === 'WETPUSSY' || compactSourceAlnumUpper === 'WET' || compactSourceAlnumUpper === 'PUSSY') {
      return preserveSourceTrailingPunctuation(source, 'ช่องคลอดเปียกๆ');
    }
    if (compactSourceAlnumUpper === 'DONTYOU' || compactSourceAlnumUpper === 'DONTYOU?') {
      return preserveSourceTrailingPunctuation(source, 'ใช่ไหม?');
    }
    if (compactSourceAlnumUpper === 'HOWMUCH' || compactSourceAlnumUpper === 'HOW' || compactSourceAlnumUpper === 'MUCH') {
      return preserveSourceTrailingPunctuation(source, 'เธอทำไปเท่าไหร่');
    }
    if (compactSourceAlnumUpper === 'DIDYOUDO' || compactSourceAlnumUpper === 'DIDYOU' || compactSourceAlnumUpper === 'YOUDO') {
      return preserveSourceTrailingPunctuation(source, 'กับพวก');
    }
    if (compactSourceAlnumUpper === 'ITWITHTHE' || compactSourceAlnumUpper === 'WITHTHE' || compactSourceAlnumUpper === 'WITH') {
      return preserveSourceTrailingPunctuation(source, 'กับพวก');
    }
    if (compactSourceAlnumUpper === 'BARBARIANS' || compactSourceAlnumUpper === 'BARBARIANS?' || compactSourceAlnumUpper === 'BARBARIAN') {
      return preserveSourceTrailingPunctuation(source, 'คนป่าเถื่อน');
    }
  }

  // Sex/Conversational slang & H-manga adjustments (exact / short matches)

  const cleanDialogueText = source.trim().toLowerCase();
  if (compactSource === 'strumpet' || compactSourceAlnumUpper === 'STRUMPET') {
    return preserveSourceTrailingPunctuation(source, 'อีกระหรี่');
  }
  if (compactSource === 'cock' || compactSource === 'cocks') {
    return preserveSourceTrailingPunctuation(source, 'ควย');
  }
  if (compactSource === 'pussy' || compactSource === 'pussies' || compactSource === 'pussys') {
    return preserveSourceTrailingPunctuation(source, 'หี');
  }
  if (compactSource === 'cum' || compactSource === 'cums' || compactSource === 'cuuuum' || compactSource === 'cuuuuum') {
    return preserveSourceTrailingPunctuation(source, 'น้ำแตก');
  }
  if (compactSource === 'cumming') {
    return preserveSourceTrailingPunctuation(source, 'ต-แตกแล้ว');
  }
  if (compactSource === 'wanna') {
    return preserveSourceTrailingPunctuation(source, 'อยาก');
  }
  if (/^me+$/i.test(compactSource)) {
    const eCount = (compactSource.match(/e/g) || []).length;
    if (eCount > 1) {
      const totalNs = 'น'.repeat(eCount + 1);
      return preserveSourceTrailingPunctuation(source, `ฉั${totalNs}`);
    } else {
      return preserveSourceTrailingPunctuation(source, 'ฉัน');
    }
  }
  if (/^me+a+n+$/i.test(compactSource)) {
    const eCount = (compactSource.match(/e/gi) || []).length;
    if (eCount > 1) {
      const totalMs = 'ม'.repeat(Math.max(1, eCount - 1));
      return preserveSourceTrailingPunctuation(source, `เลวทรา${totalMs}`);
    } else {
      return preserveSourceTrailingPunctuation(source, 'ใจร้าย');
    }
  }
  // Specific short word mappings
  if (cleanDialogueText === "i'm" || cleanDialogueText === "i’m" || compactSourceAlnumUpper === 'IM') {
    return preserveSourceTrailingPunctuation(source, 'ฉัน');
  }
  if (cleanDialogueText === 'it' || compactSourceAlnumUpper === 'IT') {
    return preserveSourceTrailingPunctuation(source, 'มัน');
  }
  if (cleanDialogueText === 'by' || compactSourceAlnumUpper === 'BY') {
    return preserveSourceTrailingPunctuation(source, 'โดย');
  }
  if (cleanDialogueText === 'he' || compactSourceAlnumUpper === 'HE') {
    return preserveSourceTrailingPunctuation(source, 'เขา');
  }
  if (compactSourceAlnumUpper === 'ALLRIGHT') {
    return preserveSourceTrailingPunctuation(source, '(เอา ล่ะ)');
  }
  if (compactSourceAlnumUpper === 'STOMACHS' || compactSourceAlnumUpper === 'STOMACH') {
    return preserveSourceTrailingPunctuation(source, 'กระเพาะอาหาร');
  }
  if (compactSourceAlnumUpper === 'CAMEAGAIN') {
    return preserveSourceTrailingPunctuation(source, 'แตกอีกแล้ว!');
  }
  if (compactSourceAlnumUpper === 'SEMEN') {
    return preserveSourceTrailingPunctuation(source, 'น้ำกาม');
  }
  if (compactSourceAlnumUpper === 'SPURT' || compactSourceAlnumUpper === 'SPUT') {
    return preserveSourceTrailingPunctuation(source, 'ปรื๊ดด');
  }
  if (compactSourceAlnumUpper === 'SPURTING' || compactSourceAlnumUpper === 'PURTING') {
    return preserveSourceTrailingPunctuation(source, 'ปรื๊ดดด!');
  }
  if (compactSourceAlnumUpper === 'HIGHSCHOOLER' || compactSourceAlnumUpper === 'HIGHSCHOOLERS') {
    return preserveSourceTrailingPunctuation(source, 'นักเรียนมัธยมปลาย');
  }
  if (compactSourceAlnumUpper.includes('ARRESTFORSERIAL') || compactSourceAlnumUpper.includes('ARRESTEDFORSERIAL')) {
    return preserveSourceTrailingPunctuation(source, 'จับกุมผู้ต้องหาคดีต่อเนื่อง');
  }
  if (compactSourceAlnumUpper === 'INSEMINATION') {
    return preserveSourceTrailingPunctuation(source, 'การหว่านเชื้อ');
  }
  if (compactSourceAlnumUpper === 'DISTRIBUTION') {
    return preserveSourceTrailingPunctuation(source, 'การกระจาย');
  }
  if (compactSourceAlnumUpper === 'APHRODISIAC' || compactSourceAlnumUpper === 'APHRODISIACS') {
    return preserveSourceTrailingPunctuation(source, 'ยาปลุกเซ็กซ์');
  }
  if (compactSourceAlnumUpper === 'PREGNAN' || compactSourceAlnumUpper === 'PREGNANT') {
    return preserveSourceTrailingPunctuation(source, 'ตั้งครรภ์');
  }
  if (compactSourceAlnumUpper === 'STUTTER' || compactSourceAlnumUpper === 'STUTTER-') {
    return preserveSourceTrailingPunctuation(source, 'พูดติดอ่าง');
  }
  if (compactSourceAlnumUpper.includes('SHOVEITINSIDE')) {
    return preserveSourceTrailingPunctuation(source, 'ยัดเข้าไปข้างใน');
  }
  if (compactSourceAlnumUpper.includes('JJUSHTCAAME') || compactSourceAlnumUpper.includes('JJUSTCAME')) {
    return preserveSourceTrailingPunctuation(source, 'ต-แตก ออกมาแล้วว!');
  }
  if (compactSourceAlnumUpper === 'MASOCHIST' || compactSourceAlnumUpper === 'MASOCHISTS') {
    return preserveSourceTrailingPunctuation(source, 'มาโซคิสต์');
  }
  if (compactSourceAlnumUpper === 'BITCHPUSSY') {
    return preserveSourceTrailingPunctuation(source, 'หีร่านๆ');
  }
  if (compactSourceAlnumUpper === 'CUMAGAIN' || compactSourceAlnumUpper === 'CUMAGAIN!') {
    return preserveSourceTrailingPunctuation(source, 'แตก อีกแล้วว!!');
  }
  if (compactSourceAlnumUpper === 'THESEMENS' || compactSourceAlnumUpper === 'THESEMEN') {
    return preserveSourceTrailingPunctuation(source, 'น้ำกามมัน');
  }
  if (compactSourceAlnumUpper === 'FLAVORED' || compactSourceAlnumUpper === 'FLAVOURED') {
    return preserveSourceTrailingPunctuation(source, 'ปรุงแต่งรสชาติ');
  }
  if (/^cha+n+$/i.test(compactSource)) {
    const aCount = (compactSource.match(/a/gi) || []).length;
    const ngCount = Math.max(1, aCount);
    return preserveSourceTrailingPunctuation(source, `จัง${'ง'.repeat(ngCount)}ห์!`);
  }
  if (/^sque+ze$/i.test(compactSource)) {
    const eCount = (compactSource.match(/e/gi) || []).length;
    if (eCount >= 3) {
      const extraNs = 'น'.repeat(Math.max(1, eCount - 2));
      return preserveSourceTrailingPunctuation(source, `บีบแน่น${extraNs}`);
    }
    return preserveSourceTrailingPunctuation(source, 'บีบเค้น');
  }
  if (compactSourceAlnumUpper.includes('TEANDOLE') || compactSourceAlnumUpper.includes('TENTANDOLE')) {
    return preserveSourceTrailingPunctuation(source, 'เย้ายวนเขาเหรอ?');
  }
  if (compactSourceAlnumUpper.includes('TENTARLO')) {
    return preserveSourceTrailingPunctuation(source, 'ลองดูไหม?');
  }
  if (compactSourceAlnumUpper === 'BROS' || compactSourceAlnumUpper === 'BRO') {
    return preserveSourceTrailingPunctuation(source, 'พวกพ้อง');
  }
  if (compactSourceAlnumUpper.includes('TREVISTARON') || compactSourceAlnumUpper.includes('ENTREVISTARON')) {
    return preserveSourceTrailingPunctuation(source, 'สัมภาษณ์แล้ว');
  }
  if (compactSourceAlnumUpper.includes('SOLACION') || compactSourceAlnumUpper.includes('DESOLACION')) {
    return preserveSourceTrailingPunctuation(source, 'ความสิ้นหวัง');
  }
  if (compactSourceAlnumUpper.includes('CREIBLESIUNIESE') || compactSourceAlnumUpper.includes('CREIBLESIUNNIESE')) {
    return preserveSourceTrailingPunctuation(source, 'น่าเชื่อถือ ถ้าหากรวมตัวกัน');
  }
  if (compactSourceAlnumUpper.includes('CANSANDO')) {
    return preserveSourceTrailingPunctuation(source, 'เหนื่อยล้า');
  }
  if (compactSourceAlnumUpper === 'RRR') {
    return preserveSourceTrailingPunctuation(source, 'RRR');
  }

  // User-requested slang fixes & conversions
  if (compactSourceAlnumUpper.includes('BLOWJOB') || compactSourceAlnumUpper.includes('BLOWTOB')) {
    if (compactSourceAlnumUpper.includes('MEABLOWJOB') || compactSourceAlnumUpper.includes('MEABLOWTOB')) {
      return preserveSourceTrailingPunctuation(source, 'อมควยให้ฉัน');
    }
    return preserveSourceTrailingPunctuation(source, 'อมควย');
  }
  if (compactSourceAlnumUpper === 'SQUEEZING') {
    return preserveSourceTrailingPunctuation(source, 'บีบ');
  }
  if (compactSourceAlnumUpper === 'APRETTYTHICKLOAD') {
    return preserveSourceTrailingPunctuation(source, 'ค่อนข้างเยอะทีเดียว');
  }
  if (compactSourceAlnumUpper.includes('YOULETOUTAPRETTYTHICKLOAD') || compactSourceAlnumUpper.includes('LETOUTAPRETTYTHICKLOAD')) {
    return preserveSourceTrailingPunctuation(source, 'คุณปล่อยน้ำอสุจิออกมาค่อนข้างเยอะทีเดียว');
  }
  if (compactSourceAlnumUpper === 'MYPUSSY') {
    return preserveSourceTrailingPunctuation(source, 'หีของฉัน');
  }
  if (compactSourceAlnumUpper === 'COCKSLEEVE') {
    return preserveSourceTrailingPunctuation(source, 'ปลอกหุ้มควย');
  }
  if (compactSourceAlnumUpper === 'SSHIT') {
    return preserveSourceTrailingPunctuation(source, 'ช-เชี่ยเอ้ย');
  }
  if (compactSourceAlnumUpper === 'ITANYMORE') {
    return preserveSourceTrailingPunctuation(source, 'มันอีกต่อไป');
  }
  if (compactSourceAlnumUpper.includes('ICANTHOLDITANYMORE')) {
    return preserveSourceTrailingPunctuation(source, 'ฉันทนมันไม่ไหวอีกต่อไปแล้ว');
  }
  if (compactSourceAlnumUpper === 'CUMINSIDE') {
    return preserveSourceTrailingPunctuation(source, 'แตกข้างใน');
  }
  if (compactSourceAlnumUpper === 'MYWOMB') {
    return preserveSourceTrailingPunctuation(source, 'มดลูกของฉัน');
  }
  if (
    compactSourceAlnumUpper === 'CUMMING' ||
    compactSource.includes('cumming') ||
    source.toLowerCase().includes('cum-ming') ||
    source.toLowerCase().includes('cumming') ||
    (compactPageTextsUpper.includes('CUMMING') && (compactSourceAlnumUpper === 'CUM' || compactSourceAlnumUpper === 'CUM-' || compactSourceAlnumUpper === 'MING'))
  ) {
    if (compactSourceAlnumUpper === 'CUM' || compactSourceAlnumUpper === 'CUM-') {
      return preserveSourceTrailingPunctuation(source, 'ทะ-');
    }
    if (compactSourceAlnumUpper === 'MING') {
      return preserveSourceTrailingPunctuation(source, 'ทะลักออกมาแล้ววว!');
    }
    return preserveSourceTrailingPunctuation(source, 'ทะ-ทะลักออกมาแล้ววว!');
  }
  if (
    compactSourceAlnumUpper === 'ITFELTWAYTOOGOOD' ||
    compactSourceAlnumUpper.includes('ITFELTWAYTOOGOOD') ||
    (compactPageTextsUpper.includes('ITFELTWAYTOOGOOD') && (compactSourceAlnumUpper.includes('ITFELT') || compactSourceAlnumUpper.includes('WAYTOO') || compactSourceAlnumUpper === 'GOOD'))
  ) {
    if (compactSourceAlnumUpper.includes('ITFELT')) {
      return preserveSourceTrailingPunctuation(source, 'ดีเกินไป');
    }
    if (compactSourceAlnumUpper.includes('WAYTOO') || compactSourceAlnumUpper === 'GOOD') {
      return preserveSourceTrailingPunctuation(source, '');
    }
    return preserveSourceTrailingPunctuation(source, 'ดีเกินไป');
  }
  if (compactSourceAlnumUpper.includes('TOMAKETHREADS')) {
    return preserveSourceTrailingPunctuation(source, 'ที่จะสร้างของเหลวข้นหนืดยืดเป็นสาย');
  }
  if (compactSourceAlnumUpper === 'MYCUM') {
    return preserveSourceTrailingPunctuation(source, 'น้ำว่าวของฉัน');
  }
  if (compactSourceAlnumUpper === 'THATS') {
    return preserveSourceTrailingPunctuation(source, 'นั่นมัน');
  }
  if (
    compactSourceAlnumUpper === 'NOTNECESSARY' ||
    compactSourceAlnumUpper === 'NOTNEC' ||
    compactSourceAlnumUpper === 'ESSARY'
  ) {
    if (compactSourceAlnumUpper === 'ESSARY') {
      return preserveSourceTrailingPunctuation(source, '');
    }
    return preserveSourceTrailingPunctuation(source, 'ไม่สำคัญ');
  }
  if (compactSourceAlnumUpper === 'ADYDO') {
    return preserveSourceTrailingPunctuation(source, '..ร้อม”ที่จะทำ');
  }
  if (compactSourceAlnumUpper === 'UMEAN') {
    return preserveSourceTrailingPunctuation(source, '..มายถึงอะไร');
  }
  if (compactSourceAlnumUpper === 'WERE') {
    return preserveSourceTrailingPunctuation(source, 'คือ');
  }
  if (compactSourceAlnumUpper.includes('PLEASECUMALOTJUSTLIKETHAT')) {
    return preserveSourceTrailingPunctuation(source, 'ได้โปรด แตกเข้ามา เยอะ อย่างนั้น แหله');
  }
  if (compactSourceAlnumUpper === 'DISEASE') {
    return preserveSourceTrailingPunctuation(source, 'โรค');
  }
  if (compactSourceAlnumUpper.includes('YOUFOUNDADISEASE')) {
    return preserveSourceTrailingPunctuation(source, 'คุณพบโรคเหรอ');
  }
  if (compactSourceAlnumUpper === 'RESTRAINT') {
    return preserveSourceTrailingPunctuation(source, 'การยับยั้งชั่งใจ');
  }
  if (compactSourceAlnumUpper === 'GOOD') {
    return preserveSourceTrailingPunctuation(source, 'ดี');
  }
  if (compactSourceAlnumUpper === 'ALOT') {
    return preserveSourceTrailingPunctuation(source, 'เยอะมาก');
  }
  // HEAD NUR-SEEE!! / HEAD NURSE variants — OCR often splits hyphenated exclamations
  if (
    compactSourceAlnumUpper === 'HEADNURSEEE' ||
    compactSourceAlnumUpper === 'HEADNURSEEEE' ||
    compactSourceAlnumUpper === 'HEADNURSE' ||
    /^HEADNURS/.test(compactSourceAlnumUpper)
  ) {
    return preserveSourceTrailingPunctuation(source, 'หัวหน้า พยา-บาลลล!!');
  }
  if (compactSourceAlnumUpper === 'SHES') {
    return preserveSourceTrailingPunctuation(source, 'เธอคือ');
  }
  if (compactSourceAlnumUpper === 'INSIDE') {
    return preserveSourceTrailingPunctuation(source, 'ข้างใน');
  }
  if (compactSourceAlnumUpper === 'ITWITHOUT') {
    return preserveSourceTrailingPunctuation(source, 'มันโดยไม่มี');
  }
  if (compactSourceAlnumUpper === 'HUH') {
    return preserveSourceTrailingPunctuation(source, 'ฮะ');
  }
  if (compactSourceAlnumUpper === 'THIS' && source.includes('?')) {
    return 'นี่น่ะเหรอ?';
  }
  if (compactSourceAlnumUpper === 'WOW') {
    return preserveSourceTrailingPunctuation(source, 'ว้าว');
  }
  // I'LL DO (OCR reads as ILLDO) → ฉันจะทำ
  if (compactSourceAlnumUpper === 'ILLDO') {
    return preserveSourceTrailingPunctuation(source, 'ฉันจะทำ');
  }
  if (compactSourceAlnumUpper === 'DAYS') {
    return preserveSourceTrailingPunctuation(source, 'หลายวัน');
  }
  // ILL alone → ฉันจะ (in manga dialogue context, standalone "ILL" is always OCR noise for "I'LL")
  if (compactSourceAlnumUpper === 'ILL') {
    return preserveSourceTrailingPunctuation(source, 'ฉันจะ');
  }
  if (compactSourceAlnumUpper === 'BELIEVE') {
    return preserveSourceTrailingPunctuation(source, 'เชื่อ');
  }
  if (compactSourceAlnumUpper === 'WITHOUT') {
    return preserveSourceTrailingPunctuation(source, 'โดยไม่มี');
  }
  if (compactSourceAlnumUpper === 'HERPUSSY') {
    return preserveSourceTrailingPunctuation(source, 'หีของเธอ');
  }

  if (compactSourceAlnumUpper === 'TATED' || compactSourceAlnumUpper === 'IMPREGNATED' || compactSourceAlnumUpper === 'IMPREGNATE') {
    return preserveSourceTrailingPunctuation(source, 'ท้องแล้ว!');
  }
  if (compactSourceAlnumUpper === 'IMPREGNATEDPIG' || compactSourceAlnumUpper === 'IMPREGNATEDPIGS') {
    return preserveSourceTrailingPunctuation(source, 'หมูแม่พันธุ์ที่กำลังตั้งท้อง');
  }
  if (compactSourceAlnumUpper === 'WEIGHT') {
    return preserveSourceTrailingPunctuation(source, 'น้ำหนัก');
  }
  if (compactSourceAlnumUpper === 'BURSTING' || compactSourceAlnumUpper === 'BURST') {
    return preserveSourceTrailingPunctuation(source, 'จะระเบิดแล้ว');
  }
  if (/^SORRY+$/.test(compactSourceAlnumUpper)) {
    return preserveSourceTrailingPunctuation(source, 'ขอโทษษษ');
  }
  if (/^NO{3,}$/.test(compactSourceAlnumUpper)) {
    return preserveSourceTrailingPunctuation(source, 'ไม่นะะะะ');
  }
  if (compactSourceAlnumUpper === 'YOUVEGOTA' || compactSourceAlnumUpper === 'YOUVEGOT') {
    return preserveSourceTrailingPunctuation(source, 'เธอมี...');
  }
  if (compactSourceAlnumUpper === 'OHHHOH' || compactSourceAlnumUpper === 'OHOH' || compactSourceAlnumUpper === 'OHHHN' || compactSourceAlnumUpper === 'OHHH') {
    return preserveSourceTrailingPunctuation(source, 'โอ้! โอ้!');
  }
  if (compactSourceAlnumUpper === 'FIELD' || compactSourceAlnumUpper === 'FIELDS') {
    return preserveSourceTrailingPunctuation(source, 'สนาม');
  }
  if (compactSourceAlnumUpper === 'CACKQH' || compactSourceAlnumUpper === 'CACK') {
    return preserveSourceTrailingPunctuation(source, 'ควย... โอ้!');
  }
  if (compactSourceAlnumUpper === 'IDANT' || compactSourceAlnumUpper === 'IDONTWANNA') {
    return preserveSourceTrailingPunctuation(source, 'ฉันไม่อยาก');
  }
  if (compactSourceAlnumUpper === 'GANNA') {
    return preserveSourceTrailingPunctuation(source, 'กำลังจะ');
  }
  if (compactSourceAlnumUpper === 'DIFEEE' || compactSourceAlnumUpper === 'DIEEE') {
    return preserveSourceTrailingPunctuation(source, 'ตายยยย!');
  }
  if (/^H{2,}$/.test(compactSourceAlnumUpper)) {
    return preserveSourceTrailingPunctuation(source, 'ฮึก...');
  }
  if (/^OH+$/.test(compactSourceAlnumUpper)) {
    return preserveSourceTrailingPunctuation(source, 'โอ้!');
  }
  if (compactSourceAlnumUpper === 'MSMAKIMA' || compactSourceAlnumUpper === 'MSMAKIMA' || compactSourceAlnumUpper === 'MSMAKIMA') {
    return preserveSourceTrailingPunctuation(source, 'คุณมากิมะ');
  }
  if (compactSourceAlnumUpper === 'FLOWING') {
    return preserveSourceTrailingPunctuation(source, 'ไหลริน...');
  }
  if (compactSourceAlnumUpper === 'SWELL') {
    return preserveSourceTrailingPunctuation(source, 'บวมเป่ง');
  }
  if (compactSourceAlnumUpper === 'THINGTHE' || compactSourceAlnumUpper === 'THING') {
    return preserveSourceTrailingPunctuation(source, 'สิ่งนั้น');
  }
  if (compactSourceAlnumUpper === 'SEMEN') {
    return preserveSourceTrailingPunctuation(source, 'น้ำอสุจิ...');
  }
  if (compactSourceAlnumUpper === 'BREEDINGSACK' || compactSourceAlnumUpper === 'BREEDINGSACK') {
    return preserveSourceTrailingPunctuation(source, 'กระสอบแม่พันธุ์');
  }
  if (compactSourceAlnumUpper === 'THISBLACKMARKETAV') {
    return preserveSourceTrailingPunctuation(source, 'หนังโป๊ตลาดมืดเรื่องนี้');
  }
  if (compactSourceAlnumUpper === 'CRUSHWOMBLICK') {
    return preserveSourceTrailingPunctuation(source, 'กระแทกมดลูกแล้วเลีย');
  }
  if (compactSourceAlnumUpper === 'CUMMNGI' || compactSourceAlnumUpper === 'CUMMING') {
    return preserveSourceTrailingPunctuation(source, 'จะแตกแล้ว!');
  }
  if (compactSourceAlnumUpper === 'SOHECAN' || compactSourceAlnumUpper === 'SOCHACAN') {
    return preserveSourceTrailingPunctuation(source, 'เพื่อให้เขาสามารถ');
  }
  if (compactSourceAlnumUpper === 'MYCERVIX') {
    return preserveSourceTrailingPunctuation(source, 'มดลูกของฉัน');
  }
  if (compactSourceAlnumUpper === 'SLUTTIEST') {
    return preserveSourceTrailingPunctuation(source, 'อีตัวที่สุด');
  }
  if (compactSourceAlnumUpper === 'SUCHTHICK') {
    return preserveSourceTrailingPunctuation(source, 'ข้นขนาดนี้');
  }
  if (compactSourceAlnumUpper === 'CONSTRICT' || compactSourceAlnumUpper === 'NSTRICT') {
    return preserveSourceTrailingPunctuation(source, 'บีบรัด...');
  }
  if (compactSourceAlnumUpper === 'LMAO') {
    return preserveSourceTrailingPunctuation(source, 'ก๊ากๆ');
  }
  if (compactSourceAlnumUpper === 'AIGHT') {
    return preserveSourceTrailingPunctuation(source, 'โอเค๊');
  }
  if (compactSourceAlnumUpper === 'AMAZING' || compactSourceAlnumUpper === 'AMAZINGR') {
    return preserveSourceTrailingPunctuation(source, 'ยอดเยี่ยม');
  }
  if (compactSourceAlnumUpper === 'PISTONPOUNDED') {
    return preserveSourceTrailingPunctuation(source, 'ลูกสูบกระแทก!');
  }
  if (compactSourceAlnumUpper === 'NOWWELL') {
    return preserveSourceTrailingPunctuation(source, 'ต่อไปนี้ เราจะ');
  }
  if (compactSourceAlnumUpper === 'SOSTRANGE') {
    return preserveSourceTrailingPunctuation(source, 'แปลกจัง');
  }
  if (compactSourceAlnumUpper === 'NOMATTER') {
    return preserveSourceTrailingPunctuation(source, 'ไม่ว่าอย่างไรก็ตาม');
  }
  if (compactSourceAlnumUpper === 'HOWSZATHAVING') {
    return preserveSourceTrailingPunctuation(source, 'เป็นไงบ้าง');
  }
  if (compactSourceAlnumUpper === 'GOODGRIEF') {
    return preserveSourceTrailingPunctuation(source, 'โอ้ พระเจ้า...');
  }
  if (compactSourceAlnumUpper === 'INSIDEMYBODY') {
    return preserveSourceTrailingPunctuation(source, 'ไว้ในร่างกายของฉัน');
  }
  if (compactSourceAlnumUpper === 'MISSMAKIMASWOMB') {
    return preserveSourceTrailingPunctuation(source, 'มดลูกของคุณมากิมา');
  }
  if (compactSourceAlnumUpper === 'MOREHONESTWITHME') {
    return preserveSourceTrailingPunctuation(source, 'ซื่อสัตย์กับฉันมากกว่านี้หน่อย~!');
  }
  if (compactSourceAlnumUpper === 'JUSTFROMLICKINGHERNIPS') {
    return preserveSourceTrailingPunctuation(source, 'แค่เพียงเลียหัวนมของเธอเท่านั้น');
  }
  if (compactSourceAlnumUpper.includes('SHEDARESTOALSOSQUEEZEUPTHATPUSSY')) {
    return preserveSourceTrailingPunctuation(source, 'เธอกล้าที่จะบีบช่องคลอดของเธอให้แน่นขนาดนั้นเลยเหรอ!');
  }
  if (compactSourceAlnumUpper.includes('WEREMAKINGACOVERFORTHISBLACKMARKETAV')) {
    return preserveSourceTrailingPunctuation(source, 'เรากำลังทำปกAVให้กับตลาดมืดนี้');
  }
  if (compactSourceAlnumUpper === 'THISADULTVIDEO' || compactSourceAlnumUpper === 'THISADULTVIDEOS') {
    return preserveSourceTrailingPunctuation(source, 'วิดีโอสำหรับผู้ใหญ่นี้');
  }
  if (compactSourceAlnumUpper === 'CIRCULATEDALL') {
    return preserveSourceTrailingPunctuation(source, 'เผยแพร่ทั้งหมด');
  }
  if (compactSourceAlnumUpper === 'AROUNDTOKYO') {
    return preserveSourceTrailingPunctuation(source, 'รอบๆ โตเกียว');
  }
  if (compactSourceAlnumUpper === 'BAREFORALL') {
    return preserveSourceTrailingPunctuation(source, 'เปลือยเปล่าสำหรับทุกคน');
  }
  if (compactSourceAlnumUpper === 'WILLBELAID') {
    return preserveSourceTrailingPunctuation(source, 'จะถูกวาง');
  }
  if (compactSourceAlnumUpper === 'FOOLISHNESS') {
    return preserveSourceTrailingPunctuation(source, 'ความโง่เขลา');
  }

  // ─── Missing manga dialogue fragment translations ────────────────────────────
  // ทำไม: คำเหล่านี้อยู่ใน whitelist (ไม่โดน skip) แต่ไม่มี glossary rule แปลเป็นไทย
  // Argos มักจะ carry-over กลับมาเป็น English ทำให้ดูเหมือนไม่ได้แปล
  if (compactSourceAlnumUpper === 'OFME' || compactSourceAlnumUpper === 'OFMEEROMANGA' || compactSourceAlnumUpper === 'EROMANGA') {
    // "OF ME!!" หรือ "OF ME, ero-manga" ในบริบทของหัวเรื่องหรือชื่อตอน
    if (compactSourceAlnumUpper.includes('EROMANGA')) {
      return preserveSourceTrailingPunctuation(source, 'ของฉัน, อีโระมังงะ');
    }
    return preserveSourceTrailingPunctuation(source, 'ของฉัน');
  }
  if (compactSourceAlnumUpper === 'NURSE') {
    return preserveSourceTrailingPunctuation(source, 'พยาบาล');
  }
  if (compactSourceAlnumUpper === 'BEINGTOO') {
    return preserveSourceTrailingPunctuation(source, 'มันมากเกินไป');
  }
  if (compactSourceAlnumUpper === 'SUDDENLY') {
    return preserveSourceTrailingPunctuation(source, 'อยู่ดีๆ');
  }
  if (compactSourceAlnumUpper === 'RESTA') {
    return preserveSourceTrailingPunctuation(source, 'พัก...');
  }
  if (compactSourceAlnumUpper === 'THESEX') {
    return preserveSourceTrailingPunctuation(source, 'เซ็กส์นั้น');
  }
  if (compactSourceAlnumUpper === 'WELLSINCE') {
    return preserveSourceTrailingPunctuation(source, 'ก็... เนื่องจาก');
  }
  if (compactSourceAlnumUpper === 'JUST') {
    return preserveSourceTrailingPunctuation(source, 'แค่');
  }
  if (compactSourceAlnumUpper === 'ILLNESSBE') {
    return preserveSourceTrailingPunctuation(source, 'ความเจ็บป่วย');
  }
  if (compactSourceAlnumUpper === 'METHOD') {
    return preserveSourceTrailingPunctuation(source, 'วิธีการ');
  }
  if (compactSourceAlnumUpper === 'FROMTHE') {
    return preserveSourceTrailingPunctuation(source, 'จาก');
  }
  if (compactSourceAlnumUpper === 'ITFEELS') {
    return preserveSourceTrailingPunctuation(source, 'มันรู้สึก');
  }
  if (compactSourceAlnumUpper === 'OUTINSIDE') {
    return preserveSourceTrailingPunctuation(source, 'ออกมาข้างใน');
  }
  if (compactSourceAlnumUpper === 'STILLFULL') {
    return preserveSourceTrailingPunctuation(source, 'ยังเต็มอยู่');
  }
  if (compactSourceAlnumUpper === 'NOWI') {
    return preserveSourceTrailingPunctuation(source, 'ตอนนี้ฉัน');
  }
  if (compactSourceAlnumUpper === 'WOMB') {
    return preserveSourceTrailingPunctuation(source, 'มดลูก');
  }
  if (compactSourceAlnumUpper === 'WAYTOO') {
    return preserveSourceTrailingPunctuation(source, 'มากเกินไป');
  }

  if (compactSourceAlnumUpper.includes('WHATTHEHELLKINDOF') && (compactSourceAlnumUpper.includes('EROMANGA') || compactSourceAlnumUpper.includes('CONVENIENT') || compactSourceAlnumUpper.includes('CONYENIENT') || compactSourceAlnumUpper.includes('DISEASE'))) {
    return preserveSourceTrailingPunctuation(source, 'โรคอะไรวะเนี่ย โรคที่เหมือนหลุดออกมาจากมังงะอีโรติกเลย...!?');
  }
  if (compactSourceAlnumUpper.includes('SEXUALINTERCOURSEDEFICIENCY') || (compactSourceAlnumUpper.includes('GENITALS') && compactSourceAlnumUpper.includes('DISEASE'))) {
    return preserveSourceTrailingPunctuation(source, 'โรคความบกพร่องทางเพศของอวัยวะเพศ');
  }
  if (compactSourceAlnumUpper.includes('RELEASEALOTOFSPERM') || (compactSourceAlnumUpper.includes('SPERM') && compactSourceAlnumUpper.includes('FATAL'))) {
    return preserveSourceTrailingPunctuation(source, 'นี่เป็นโรคที่คุณต้องหลั่งอสุจิออกมาเป็นจำนวนมาก มิเช่นนั้นอาจถึงแก่ชีวิตได้');
  }
  if (compactSourceAlnumUpper.includes('MOREEFFICIENT') && compactSourceAlnumUpper.includes('SPERM')) {
    return preserveSourceTrailingPunctuation(source, 'วิธีนี้มีประสิทธิภาพมากกว่าและได้อสุจิคุณภาพสูง');
  }
  if (compactSourceAlnumUpper.includes('BYHAVINGSEXWITHAWOMAN') || compactSourceAlnumUpper.includes('HAVINGSEXWITHAWOMAN')) {
    return preserveSourceTrailingPunctuation(source, 'โดยการมีเพศสัมพันธ์กับผู้หญิง');
  }
  if (compactSourceAlnumUpper.includes('IMADEAFEWMODIFICATIONS') || compactSourceAlnumUpper.includes('MODIFICATIONSTOTHEROOM')) {
    return preserveSourceTrailingPunctuation(source, 'ฉันได้ทำการปรับเปลี่ยนห้องเล็กน้อย');
  }
  if (compactSourceAlnumUpper.includes('CONTINUETHETREATMENT') || compactSourceAlnumUpper.includes('CONTINUETHETHREATMENT')) {
    return preserveSourceTrailingPunctuation(source, 'ดำเนินการรักษาต่อไป');
  }
  if (compactSourceAlnumUpper === 'TREATMENT' || compactSourceAlnumUpper === 'THETREATMENT') {
    return preserveSourceTrailingPunctuation(source, 'การรักษา');
  }
  if (compactSourceAlnumUpper === 'SUCKING' || compactSourceAlnumUpper === 'SUCK') {
    return preserveSourceTrailingPunctuation(source, 'ดูด');
  }
  if (compactSourceAlnumUpper === 'DISCOURSE' || compactSourceAlnumUpper === 'DISCOUR') {
    return preserveSourceTrailingPunctuation(source, 'การสนทนา');
  }
  if (compactSourceAlnumUpper === 'METHERE' || compactSourceAlnumUpper === 'ME,THERE') {
    return preserveSourceTrailingPunctuation(source, 'ฉัน, ตรงนั้น');
  }
  if (compactSourceAlnumUpper === 'THENWESHOULD' || compactSourceAlnumUpper === 'THENWE') {
    return preserveSourceTrailingPunctuation(source, 'ถ้าอย่างนั้นเราควรจะ');
  }
  if (compactSourceAlnumUpper === 'AALRIGHT' || compactSourceAlnumUpper === 'AALRIGHT' || compactSourceAlnumUpper === 'AALRIGHT!') {
    return preserveSourceTrailingPunctuation(source, 'ช-ชะ ใช่แล้ว!');
  }
  if (compactSourceAlnumUpper === 'BOYFRIEND') {
    return preserveSourceTrailingPunctuation(source, 'แฟนหนุ่ม');
  }
  if (compactSourceAlnumUpper === 'BIG') {
    return preserveSourceTrailingPunctuation(source, 'ใหญ่มาก');
  }
  if (compactSourceAlnumUpper === 'INTERESTING') {
    return preserveSourceTrailingPunctuation(source, 'น่าสนใจ');
  }
  if (compactSourceAlnumUpper === 'SATISFY') {
    return preserveSourceTrailingPunctuation(source, 'ทำให้พึงพอใจ');
  }
  if (compactSourceAlnumUpper.includes('MIKIYUKA28') || compactSourceAlnumUpper.includes('MIKIYUKA')) {
    return preserveSourceTrailingPunctuation(source, 'มิกิ ยูกะ (28)');
  }
  if (compactSourceAlnumUpper === 'LETITOUT') {
    return preserveSourceTrailingPunctuation(source, 'ปล่อยมันออกมา');
  }
  if (compactSourceAlnumUpper === 'LOOSE') {
    return preserveSourceTrailingPunctuation(source, 'โหลยโท่ย');
  }
  if (compactSourceAlnumUpper === 'AIRBATH') {
    return preserveSourceTrailingPunctuation(source, 'อ่างตากอากาศ');
  }
  if (compactSourceAlnumUpper.includes('YUKACHAN') && compactSourceAlnumUpper.includes('ILL')) {
    return preserveSourceTrailingPunctuation(source, 'ยูกะ-จัง ฉันจะ');
  }
  if (compactSourceAlnumUpper.includes('CHANILL')) {
    return preserveSourceTrailingPunctuation(source, 'จัง ฉันจะ');
  }
  if (compactSourceAlnumUpper === 'LIMIT') {
    return preserveSourceTrailingPunctuation(source, 'ขีดจำกัด');
  }
  if (compactSourceAlnumUpper === 'LOLSOLEWD') {
    return preserveSourceTrailingPunctuation(source, 'ฮ่าๆๆ ลามกจังเลย');
  }
  if (/^W+H+A+T+$/i.test(compactSourceAlnumUpper) || compactSourceAlnumUpper === 'WHAAAT') {
    return preserveSourceTrailingPunctuation(source, 'อ..อะไร');
  }
  if (compactSourceAlnumUpper === 'YYES') {
    return preserveSourceTrailingPunctuation(source, 'ช-ใช่');
  }
  if (compactSourceAlnumUpper === 'PAINFUL') {
    return preserveSourceTrailingPunctuation(source, 'เจ็บปวด');
  }
  if (compactSourceAlnumUpper === 'THICK') {
    return preserveSourceTrailingPunctuation(source, 'หนา');
  }
  if (compactSourceAlnumUpper.includes('SOMETHINGISAID')) {
    return preserveSourceTrailingPunctuation(source, 'บางสิ่ง ที่ฉัน พูด-');
  }
  if (compactSourceAlnumUpper === 'THENWHY') {
    return preserveSourceTrailingPunctuation(source, 'แล้วทำไม');
  }
  if (compactSourceAlnumUpper === 'ITFELT') {
    return preserveSourceTrailingPunctuation(source, 'มันรู้สึก');
  }
  if (compactSourceAlnumUpper === 'MOVING') {
    return preserveSourceTrailingPunctuation(source, 'ขยับเขยื้อน!');
  }
  if (compactSourceAlnumUpper === 'CENTRED' || compactSourceAlnumUpper === 'CENTERED') {
    return preserveSourceTrailingPunctuation(source, 'ตรงกลาง');
  }
  if (compactSourceAlnumUpper === 'THECASHIER' || compactSourceAlnumUpper === 'CASHIER') {
    return preserveSourceTrailingPunctuation(source, 'พนักงานคิดเงิน');
  }
  if (compactSourceAlnumUpper === 'WORK') {
    return preserveSourceTrailingPunctuation(source, 'ทำงาน');
  }
  if (compactSourceAlnumUpper === 'SUREIS') {
    return preserveSourceTrailingPunctuation(source, 'ใช่จริงๆ ด้วย');
  }
  if (compactSourceAlnumUpper === 'THINK') {
    return preserveSourceTrailingPunctuation(source, 'คิด');
  }
  if (compactSourceAlnumUpper === 'WONT') {
    return preserveSourceTrailingPunctuation(source, 'จะไม่');
  }
  if (compactSourceAlnumUpper === 'ANTEIT' || compactSourceAlnumUpper === 'GUARANTEEIT') {
    return preserveSourceTrailingPunctuation(source, 'รับรองได้เลย');
  }
  if (compactSourceAlnumUpper === 'LEAGUE') {
    return preserveSourceTrailingPunctuation(source, 'ลีก');
  }
  if (compactSourceAlnumUpper === 'QUARTERS' || compactSourceAlnumUpper === 'QUARTER') {
    return preserveSourceTrailingPunctuation(source, 'เหรียญ');
  }
  if (compactSourceAlnumUpper === 'SIDES' || compactSourceAlnumUpper === 'SIDE') {
    return preserveSourceTrailingPunctuation(source, 'ด้านข้าง');
  }
  if (compactSourceAlnumUpper === 'MELEDFOR') {
    return preserveSourceTrailingPunctuation(source, 'เรียกหา');
  }
  if (compactSourceAlnumUpper === 'MOTIVATED') {
    return preserveSourceTrailingPunctuation(source, 'มีแรงฮึด');
  }
  if (compactSourceAlnumUpper === 'RELUCTANT') {
    return preserveSourceTrailingPunctuation(source, 'ลังเล');
  }
  if (compactSourceAlnumUpper.startsWith('SANSNOT') || compactSourceAlnumUpper.startsWith('SANISNOT')) {
    return preserveSourceTrailingPunctuation(source, 'ซังไม่อยู่');
  }
  if (compactSourceAlnumUpper === 'LIEVED' || compactSourceAlnumUpper === 'RELIEVED') {
    return preserveSourceTrailingPunctuation(source, 'โล่งอกไปที!');
  }
  if (compactSourceAlnumUpper === 'PLACEAND') {
    return preserveSourceTrailingPunctuation(source, '(สถานที่ และ...)');
  }
  if (compactSourceAlnumUpper === 'COLLAR') {
    return preserveSourceTrailingPunctuation(source, 'ปลอกคอ');
  }
  if (compactSourceAlnumUpper === 'MAN') {
    return preserveSourceTrailingPunctuation(source, 'ผู้ชาย');
  }
  if (/^S+A+N+$/i.test(compactSourceAlnumUpper) || /^S+A+A+N+$/i.test(compactSourceAlnumUpper)) {
    return preserveSourceTrailingPunctuation(source, 'ซังงง.');
  }
  if (compactSourceAlnumUpper === 'ACHOKER' || compactSourceAlnumUpper === 'CHOKER') {
    return preserveSourceTrailingPunctuation(source, 'สร้อยคอโชกเกอร์');
  }
  if (compactSourceAlnumUpper === 'TERRIFIC') {
    return preserveSourceTrailingPunctuation(source, 'ยอดเยี่ยม~');
  }
  if (compactSourceAlnumUpper === 'REJECTED') {
    return preserveSourceTrailingPunctuation(source, 'ถูกปฏิเสธ');
  }
  if (compactSourceAlnumUpper === 'SMIRK' || compactSourceAlnumUpper === 'SMINK') {
    return preserveSourceTrailingPunctuation(source, 'แสยะยิ้ม');
  }
  if (compactSourceAlnumUpper === 'CAT') {
    return preserveSourceTrailingPunctuation(source, 'แมว');
  }
  if (compactSourceAlnumUpper === 'CLOSED') {
    return preserveSourceTrailingPunctuation(source, 'ปิดแล้ว');
  }
  if (compactSourceAlnumUpper === 'COUNT') {
    return preserveSourceTrailingPunctuation(source, 'นับ');
  }
  if (compactSourceAlnumUpper === 'TRANCE') {
    return preserveSourceTrailingPunctuation(source, 'ภวังค์');
  }
  if (compactSourceAlnumUpper === 'LEAGUES') {
    return preserveSourceTrailingPunctuation(source, 'ลีก');
  }
  if (compactSourceAlnumUpper === 'DENCE') {
    return preserveSourceTrailingPunctuation(source, 'ความมั่นใจ');
  }
  if (compactSourceAlnumUpper === 'DROPPER') {
    return preserveSourceTrailingPunctuation(source, 'ที่หยด');
  }
  if (compactSourceAlnumUpper === 'HELLO' && (source.includes('...') || source.includes('~') || source.includes('..'))) {
    return preserveSourceTrailingPunctuation(source, 'สวัสดี');
  }
  if (compactSourceAlnumUpper === 'WRACKING') {
    return preserveSourceTrailingPunctuation(source, 'ปวดหัวแทบแตก');
  }
  if (compactSourceAlnumUpper === 'GOROUSAN' || compactSourceAlnumUpper === 'GOROLSAN') {
    return preserveSourceTrailingPunctuation(source, 'คุณโกโร่');
  }
  if (compactSourceAlnumUpper === 'PERVSAKI') {
    return preserveSourceTrailingPunctuation(source, 'ตาโรคจิตซากิ');
  }
  if (compactSourceAlnumUpper === 'BEYBLADE' || compactSourceAlnumUpper === 'MYBEYBLADE') {
    return preserveSourceTrailingPunctuation(source, 'เบย์เบลด');
  }
  if (compactSourceAlnumUpper === 'IAM') {
    return preserveSourceTrailingPunctuation(source, 'ฉันเอง');
  }
  if (compactSourceAlnumUpper === 'HUH') {
    return preserveSourceTrailingPunctuation(source, 'หะ');
  }
  if (compactSourceAlnumUpper === 'ILLLEAVE' || compactSourceAlnumUpper === 'ILEAVE') {
    return preserveSourceTrailingPunctuation(source, 'ฉันขอตัว');
  }
  if (compactSourceAlnumUpper === 'SCIOUSLY') {
    return preserveSourceTrailingPunctuation(source, 'อย่างมีสติ');
  }
  if (compactSourceAlnumUpper === 'MINISCING') {
    return preserveSourceTrailingPunctuation(source, 'รำลึกความหลัง');
  }
  if (compactSourceAlnumUpper === 'FWINE') {
    return preserveSourceTrailingPunctuation(source, 'ส-สบายดี๊');
  }
  if (compactSourceAlnumUpper === 'BRINGHER') {
    return preserveSourceTrailingPunctuation(source, 'พาเธอมา');
  }
  if (compactSourceAlnumUpper === 'DOESNTGET') {
    return preserveSourceTrailingPunctuation(source, 'ไม่เข้าใจ');
  }
  if (compactSourceAlnumUpper === 'TTAYAMA') {
    return preserveSourceTrailingPunctuation(source, 'ท-ทายามะ');
  }
  if (compactSourceAlnumUpper === 'AMAZING') {
    return preserveSourceTrailingPunctuation(source, 'สุดยอดเลย');
  }
  if (compactSourceAlnumUpper === 'FORTUNATEHEAR') {
    return preserveSourceTrailingPunctuation(source, 'โชคดีที่ได้ยิน');
  }
  if (compactSourceAlnumUpper === 'OLDSENPAI') {
    return preserveSourceTrailingPunctuation(source, 'รุ่นพี่ที่เคยรู้จัก');
  }
  if (compactSourceAlnumUpper === 'NONEXISTENTWELL') {
    return preserveSourceTrailingPunctuation(source, 'ไม่มีอยู่จริง...');
  }
  if (compactSourceAlnumUpper === 'NOWAMARRIED') {
    return preserveSourceTrailingPunctuation(source, 'ตอนนี้แต่งงานแล้ว');
  }
  if (compactSourceAlnumUpper === 'ISSUCHANICE') {
    return preserveSourceTrailingPunctuation(source, 'ช่างเป็นคนที่แสนดี');
  }
  if (compactSourceAlnumUpper === 'GOODMOOD') {
    return preserveSourceTrailingPunctuation(source, 'อารมณ์ดี');
  }
  if (compactSourceAlnumUpper === 'THANKSFOR') {
    return preserveSourceTrailingPunctuation(source, 'ขอบคุณสำหรับ');
  }
  if (compactSourceAlnumUpper === 'ONEESAN') {
    return preserveSourceTrailingPunctuation(source, 'พี่สาว');
  }
  if (compactSourceAlnumUpper === 'WELLGO') {
    return preserveSourceTrailingPunctuation(source, 'พวกเราจะไป');
  }
  if (compactSourceAlnumUpper === 'SENPAI') {
    return preserveSourceTrailingPunctuation(source, 'รุ่นพี่');
  }
  if (compactSourceAlnumUpper === 'GRATITUDEI') {
    return preserveSourceTrailingPunctuation(source, 'ความขอบคุณ ฉัน');
  }
  if (compactSourceAlnumUpper === 'ALLTHETIME') {
    return preserveSourceTrailingPunctuation(source, 'ตลอดเวลา');
  }
  if (compactSourceAlnumUpper === 'BADUM') {
    return preserveSourceTrailingPunctuation(source, 'ตึก-ตัก');
  }
  if (compactSourceAlnumUpper === 'YOUPRETTY') {
    return preserveSourceTrailingPunctuation(source, 'คุณสวย');
  }
  if (compactSourceAlnumUpper === 'MARRIED') {
    return preserveSourceTrailingPunctuation(source, 'แต่งงาน');
  }
  if (compactSourceAlnumUpper === 'EVENTHOUGH') {
    return preserveSourceTrailingPunctuation(source, 'ถึงแม้ว่า');
  }
  if (compactSourceAlnumUpper === 'IDIDNT') {
    return preserveSourceTrailingPunctuation(source, 'ฉันไม่ได้ทำ');
  }
  if (compactSourceAlnumUpper === 'IWASIN') {
    return preserveSourceTrailingPunctuation(source, 'ฉันอยู่ใน');
  }
  if (compactSourceAlnumUpper === 'RUMBLE' || compactSourceAlnumUpper === 'RUMEL' || compactSourceAlnumUpper === 'GUMBC') {
    return preserveSourceTrailingPunctuation(source, 'ครืน');
  }
  if (compactSourceAlnumUpper === 'TAYAMA') {
    return preserveSourceTrailingPunctuation(source, 'ทายามะ');
  }
  if (compactSourceAlnumUpper === 'SENPAL') {
    return preserveSourceTrailingPunctuation(source, 'รุ่นพี่');
  }
  if (compactSourceAlnumUpper === 'BLOCKHEAD') {
    return preserveSourceTrailingPunctuation(source, 'คนทึ่ม');
  }
  if (compactSourceAlnumUpper === 'GOODYOU') {
    return preserveSourceTrailingPunctuation(source, '(ดี, คุณ)');
  }
  if (compactSourceAlnumUpper === 'ALSOTHE') {
    return preserveSourceTrailingPunctuation(source, '(ด้วยเหมือนกัน, สิ่งนั้น)');
  }
  if (compactSourceAlnumUpper === 'TOBUYSTUFF') {
    return preserveSourceTrailingPunctuation(source, 'เพื่อซื้อของ');
  }
  if (compactSourceAlnumUpper === 'DECORATIONS') {
    return preserveSourceTrailingPunctuation(source, 'ของตกแต่ง');
  }
  if (compactSourceAlnumUpper === 'GRATEFUL' || compactSourceAlnumUpper === 'GRATEFLL') {
    return preserveSourceTrailingPunctuation(source, 'รู้สึกขอบคุณ');
  }
  if (compactSourceAlnumUpper === 'DOINGP') {
    return preserveSourceTrailingPunctuation(source, 'กำลังทำอะไรอยู่?');
  }
  if (compactSourceAlnumUpper === 'SASAKISAN' || compactSourceAlnumUpper === 'SASAKISANP') {
    return preserveSourceTrailingPunctuation(source, 'ซาซากิซัง');
  }
  if (compactSourceAlnumUpper === 'RESOLUTE') {
    return preserveSourceTrailingPunctuation(source, 'เด็ดเดี่ยว');
  }
  if (compactSourceAlnumUpper === 'FILRTING') {
    return preserveSourceTrailingPunctuation(source, 'กำลังจีบ');
  }
  if (compactSourceAlnumUpper === 'TOMUSIC') {
    return preserveSourceTrailingPunctuation(source, 'กับเสียงเพลง');
  }
  if (compactSourceAlnumUpper === 'TOSONGS') {
    return preserveSourceTrailingPunctuation(source, 'กับบทเพลง');
  }
  if (compactSourceAlnumUpper === 'WAYWHY') {
    return preserveSourceTrailingPunctuation(source, '(ทาง, ทำไม)');
  }
  if (compactSourceAlnumUpper === 'SHOULDI') {
    return preserveSourceTrailingPunctuation(source, 'ฉันควรจะ');
  }
  if (compactSourceAlnumUpper === 'CORDIS') {
    return preserveSourceTrailingPunctuation(source, 'สายคือ');
  }
  if (compactSourceAlnumUpper === 'MYSELFTHEN') {
    return preserveSourceTrailingPunctuation(source, 'ตัวเอง" จากนั้น');
  }
  if (compactSourceAlnumUpper === 'ANDSTARTED') {
    return preserveSourceTrailingPunctuation(source, 'และเริ่ม');
  }
  if (compactSourceAlnumUpper === 'TOCOMPLETE') {
    return preserveSourceTrailingPunctuation(source, 'เพื่อให้เสร็จสิ้น');
  }
  if (compactSourceAlnumUpper === 'NEXTMONTHS') {
    return preserveSourceTrailingPunctuation(source, 'ของเดือนหน้า');
  }
  if (compactSourceAlnumUpper === 'HASMADE') {
    return preserveSourceTrailingPunctuation(source, 'ได้ทำ');
  }
  if (compactSourceAlnumUpper === 'EARTHIS') {
    return preserveSourceTrailingPunctuation(source, 'โลกคือ');
  }
  if (compactSourceAlnumUpper === 'ROOMWAS') {
    return preserveSourceTrailingPunctuation(source, '(ห้อง, เคยเป็น)');
  }
  if (compactSourceAlnumUpper === 'TERESTING') {
    return preserveSourceTrailingPunctuation(source, 'น่าสนใจ');
  }
  if (compactSourceAlnumUpper === 'ITSFASTER') {
    return preserveSourceTrailingPunctuation(source, '"มันเร็วกว่า');
  }

  // H-Manga Slang Conversational Override Group
  if (compactSourceAlnumUpper.includes('SHUPUPWE') && compactSourceAlnumUpper.includes('FUCK') && (compactSourceAlnumUpper.includes('PRINCESS') || compactSourceAlnumUpper.includes('PRIN') || compactSourceAlnumUpper.includes('CESS'))) {
    return preserveSourceTrailingPunctuation(source, 'หุบปากซะ! ฉันอยากจะเย็ดเธอให้เละเทะมาตลอดเลยนะ อีเจ้าหญิงโง่!!');
  }
  if (compactSourceAlnumUpper.includes('SUCKINGCOCK') && (compactSourceAlnumUpper.includes('PIG') || compactSourceAlnumUpper.includes('GRUNTING'))) {
    return preserveSourceTrailingPunctuation(source, 'ฉันกำลังดูดอวัยวะเพศชายและครางเหมือนหมูตัวจริง');
  }
  if (compactSourceAlnumUpper.includes('HOWDOTHEYKEEP') || (compactSourceAlnumUpper.includes('THEYKEEP') && compactSourceAlnumUpper.includes('CUUUUM'))) {
    return preserveSourceTrailingPunctuation(source, 'ได้อย่างไร..? ทำไมพวกเขายังทำให้ฉันน้ำแตกกกกได้อีก?');
  }
  if (compactSourceAlnumUpper.includes('DIEBYMYCOCK')) {
    return preserveSourceTrailingPunctuation(source, 'ตายซะด้วยไอ้จู๋ของฉัน! เร็วๆเข้า!!');
  }
  if (/^dy+i+n+g+$/i.test(compactSource) && compactSource.length >= 6) {
    return preserveSourceTrailingPunctuation(source, 'ตาาาายยยแล้วววว');
  }
  if (compactSourceAlnumUpper === 'NOMORECOCK') {
    return preserveSourceTrailingPunctuation(source, 'ไม่เอา ควยแล้ว!');
  }
  if (compactSourceAlnumUpper.startsWith('NOMOREOH') || compactSourceAlnumUpper === 'NOMOREOHH') {
    return preserveSourceTrailingPunctuation(source, 'ไม่เอาแล้วว!อ๊าาาห์!');
  }

  const cleanStutter = sourceOriginal.replace(/[.!?…\s_]+/g, '');
  if (
    /^i(?:-i)+$/i.test(cleanStutter) ||
    /^i-i+$/i.test(cleanStutter) ||
    /^i-i*[-'’]*i+$/i.test(sourceOriginal.trim()) ||
    compactSource === 'ii' ||
    compactSource === 'iii' ||
    compactSourceAlnumUpper === 'II' ||
    /^i-i*[-'’]*i*m$/i.test(source.trim()) ||
    compactSourceAlnumUpper === 'IIM' ||
    compactSourceAlnumUpper === 'IIIM'
  ) {
    return preserveSourceTrailingPunctuation(source, 'ฉ-ฉัน');
  }
  if (/^sto[oa]+p*[!?…]*$/i.test(cleanDialogueText) || compactSourceAlnumUpper === 'STOOOOP' || compactSourceAlnumUpper === 'STOAOOP' || compactSourceAlnumUpper === 'STOAAOP') {
    return preserveSourceTrailingPunctuation(source, 'หยุดดดดด');
  }
  if (cleanDialogueText === "you're" || cleanDialogueText === "you’re" || compactSourceAlnumUpper === 'YOURE') {
    return preserveSourceTrailingPunctuation(source, 'เธอ');
  }
  if (cleanDialogueText === 'raping-my' || cleanDialogueText === 'raping my' || compactSourceAlnumUpper === 'RAPINGMY') {
    return preserveSourceTrailingPunctuation(source, 'ข่มขืน-ฉัน');
  }
  if (/^cu+u+m+[!?…]*$/i.test(cleanDialogueText) || /^cu+u+m+$/i.test(cleanDialogueText) || compactSourceAlnumUpper.startsWith('CUUUUM')) {
    return preserveSourceTrailingPunctuation(source, 'แตกกกกก');
  }
  if (compactSourceAlnumUpper.includes('MYHEARTSBEINGTORNBYTHEIRCOCKS') || compactSourceAlnumUpper.includes('MYHEARTBEINGTORNBYTHEIRCOCKS')) {
    return preserveSourceTrailingPunctuation(source, 'หัวใจของฉันกำลังถูกฉีกกระชากด้วยควยของพวกมัน!');
  }
  if (cleanDialogueText === 'n-no') {
    return preserveSourceTrailingPunctuation(source, 'ม-ไม่');
  }
  if (cleanDialogueText === 'ima' || cleanDialogueText === "i'ma" || cleanDialogueText === "i’ma") {
    return preserveSourceTrailingPunctuation(source, 'ฉันเป็น');
  }
  if (cleanDialogueText === 'wet pussy' || cleanDialogueText === 'wet pussies' || cleanDialogueText === "wet pussy's" || cleanDialogueText === 'wet pussys') {
    return preserveSourceTrailingPunctuation(source, 'หีแฉะ');
  }
  if (cleanDialogueText === 'cervix') {
    return preserveSourceTrailingPunctuation(source, 'มดลูก');
  }
  if (cleanDialogueText === 'this') {
    return preserveSourceTrailingPunctuation(source, 'นี่');
  }
  if (cleanDialogueText === 'my') {
    return preserveSourceTrailingPunctuation(source, 'ของฉัน');
  }
  if (cleanDialogueText === 'not my') {
    return preserveSourceTrailingPunctuation(source, 'ไม่ใช่ของฉัน');
  }
  if (cleanDialogueText === 'ass-' || cleanDialogueText === 'ass') {
    return preserveSourceTrailingPunctuation(source, 'ตูด');
  }
  if (cleanDialogueText === 'hole') {
    return preserveSourceTrailingPunctuation(source, 'รู');
  }
  if (cleanDialogueText === 'agaa' || cleanDialogueText === 'again') {
    return preserveSourceTrailingPunctuation(source, 'อีกแล้ว');
  }
  if (cleanDialogueText === 'us the' || compactSourceAlnumUpper === 'USTHE') {
    return preserveSourceTrailingPunctuation(source, 'พวกเรา');
  }
  if (compactSource === 'butinanyage' || compactSourceAlnumUpper === 'BUTINANYAGE') {
    return preserveSourceTrailingPunctuation(source, 'แต่ไม่ว่าจะในยุคสมัยใด');
  }
  if (compactSource === 'awaywith' || compactSourceAlnumUpper === 'AWAYWITH') {
    return preserveSourceTrailingPunctuation(source, 'ไปให้พ้นกับ');
  }
  if (compactSource === 'getting' || compactSourceAlnumUpper === 'GETTING') {
    return preserveSourceTrailingPunctuation(source, 'ได้รับ');
  }
  if (cleanDialogueText === 'all' || compactSourceAlnumUpper === 'ALL') {
    return preserveSourceTrailingPunctuation(source, 'ทั้งหมด');
  }
  if (cleanDialogueText === 'of' || compactSourceAlnumUpper === 'OF') {
    return preserveSourceTrailingPunctuation(source, 'ของ');
  }
  if (cleanDialogueText === 'you') {
    return preserveSourceTrailingPunctuation(source, 'คุณ');
  }
  // "die" → ตายซะ (in emotional/manga context); fallback ตาย for neutral uses
  if (cleanDialogueText === 'die' || compactSourceAlnumUpper === 'DIE') {
    return preserveSourceTrailingPunctuation(source, 'ตายซะ');
  }
  // stinky → ตุๆ (H-manga slang, e.g. "HER PUSSY'S SO STINKY")
  if (compactSource === 'stinky') {
    return preserveSourceTrailingPunctuation(source, 'ตุๆ');
  }
  // HER PUSSY'S SO STINKY full-sentence (group or single balloon)
  if (compactSourceAlnumUpper.includes('HERPUSSYS') && compactSourceAlnumUpper.includes('STINKY')) {
    return preserveSourceTrailingPunctuation(source, 'หีของเธอเหม็นตุมากเลย');
  }
  if (cleanDialogueText === 'pig') {
    return preserveSourceTrailingPunctuation(source, 'หมู');
  }
  if (cleanDialogueText === 'more') {
    return preserveSourceTrailingPunctuation(source, 'อีก');
  }
  if (cleanDialogueText === 'was toyed' || compactSourceAlnumUpper === 'WASTOYED') {
    return preserveSourceTrailingPunctuation(source, 'ถูกเล่นสนุก');
  }
  if (cleanDialogueText === 'up looking' || cleanDialogueText === 'up looking' || compactSourceAlnumUpper === 'UPLOOKING') {
    return preserveSourceTrailingPunctuation(source, 'มองขึ้นไป');
  }
  if (cleanDialogueText === 'like this' || compactSourceAlnumUpper === 'LIKETHIS') {
    return preserveSourceTrailingPunctuation(source, 'แบบนี้');
  }
  if (cleanDialogueText === "heart's" || cleanDialogueText === 'heart' || compactSourceAlnumUpper === 'HEARTS' || compactSourceAlnumUpper === 'HEART') {
    return preserveSourceTrailingPunctuation(source, 'หัวใจ');
  }
  if (cleanDialogueText === 'so') {
    return preserveSourceTrailingPunctuation(source, 'ดังนั้น');
  }
  if (cleanDialogueText === 'of') {
    return preserveSourceTrailingPunctuation(source, 'ของ');
  }
  if (cleanDialogueText === 'all') {
    return preserveSourceTrailingPunctuation(source, 'ทั้งหมด');
  }
  // คำครางสะกดไม่มีสระภาษาอังกฤษ (เช่น NGG, HNNG, NGHH, GOHHH) ป้องกันการแปลมั่วเป็นอย่างอื่น
  if (/^[HNGD]*$/i.test(compactSource) && compactSource.length >= 2) {
    return preserveSourceTrailingPunctuation(source, source);
  }
  if (/^G[O]*H+$/i.test(compactSource)) {
    return preserveSourceTrailingPunctuation(source, 'โอ๊ย');
  }
  if (compactSourceAlnumUpper === 'WITHAN' || compactSourceAlnumUpper === 'WITHANHEIR') {
    return preserveSourceTrailingPunctuation(source, 'ด้วย');
  }
  if (compactSourceAlnumUpper === 'HEIRRR') {
    return preserveSourceTrailingPunctuation(source, 'รัชทายาททท');
  }
  if (compactSourceAlnumUpper === 'HEIRRRRRR') {
    return preserveSourceTrailingPunctuation(source, 'รัชทายาทททท');
  }
  if (compactSourceAlnumUpper === 'WITHANHEIRRRRRR' || compactSourceAlnumUpper === 'WITHANHEIRRR') {
    return preserveSourceTrailingPunctuation(source, 'ด้วยรัชทายาทททท');
  }
  if (compactSourceAlnumUpper === 'PREGNANTWITHANHEIRRRRRR' || compactSourceAlnumUpper.includes('PREGNANTWITHANHEIR')) {
    return preserveSourceTrailingPunctuation(source, 'ท้องรัชทายาทททท');
  }
  if (compactSourceAlnumUpper.includes('DONTSAYTHATWHILESQUIRTINGYOUSOW')) {
    return preserveSourceTrailingPunctuation(source, 'อย่าพูดแบบนั้นในขณะที่กำลังน้ำกระฉูด อีหมูตัวเมีย!');
  }

  const compactNormalizedSourceAsciiUpper = normalizedSpanishSource
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const hasVertarToken = /\bVERTAR\b/i.test(source) || compactSourceUpper.includes('VERTAR');
  const hasEssenceToken = /\bESSENCE\b/i.test(source)
    || /\bESSEN(?:CE|SE)\b/i.test(source)
    || /ESSENCE|ESENCE|ESSNCE|ESSEN[CS]E|ESSANCE/.test(compactSourceUpper);
  const translatedLower = translated.toLowerCase();
  const replaceNameToken = (input: string, token: string, replacement: string): string =>
    input.replace(new RegExp(`\\b${token}\\b`, 'ig'), replacement);

  if (/^C+EH[!?…]*$/i.test(source.replace(/\s+/g, '')) || compactSourceAsciiUpper === 'CEH') {
    return preserveSourceTrailingPunctuation(source, 'เอ๋');
  }

  if (compactSourceAsciiUpper.includes('ACTUALLYTHISHASBEENONMYMINDFORWHILE')) {
    return preserveSourceTrailingPunctuation(source, 'ที่จริงแล้ว เรื่องนี้อยู่ในใจฉันมาสักพักแล้ว');
  }

  if (/^ACTUALLY[,.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ที่จริงแล้ว');
  }

  if (/^GO\s+ON[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ไปต่อเลย');
  }

  if (/^SAY\s+THE\s+REST[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'พูดส่วนที่เหลือ');
  }

  if (/^MY[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ของฉัน');
  }

  if (
    /\bALG[OE]\s+A[S5][IÍ1]\b/i.test(source)
    || /\bALG[OE]\s+A[S5][IÍ1]\b/i.test(normalizedSpanishSource)
    || compactSourceAsciiUpper.includes('ALGOASI')
    || compactNormalizedSourceAsciiUpper.includes('ALGOASI')
    || compactSourceAsciiUpper.includes('ALGEASI')
  ) {
    return preserveSourceTrailingPunctuation(source, 'ประมาณนั้นแหละ');
  }

  const isConMasDetalle = (
    /(^|\s)CON\s+M[ÁA]S\s+DETAL+E(?:S)?([.!?…]+)?$/i.test(source)
    || /(^|\s)CON\s+M[ÁA]S\s+DETAL+E(?:S)?([.!?…]+)?$/i.test(normalizedSpanishSource)
    || compactSourceAsciiUpper.includes('CONMASDETALLE')
    || compactNormalizedSourceAsciiUpper.includes('CONMASDETALLE')
  );
  if (isConMasDetalle) {
    return preserveSourceTrailingPunctuation(source, 'ในรายละเอียดเพิ่มเติม');
  }

  const compactSpanishSourceAsciiUpper = normalizedSpanishSource
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  if (
    compactSpanishSourceAsciiUpper.includes('SIMEQUEDO')
    && compactSpanishSourceAsciiUpper.includes('AQUIMASTIEMPO')
    && compactSpanishSourceAsciiUpper.includes('SIENTOQUEME')
    && compactSpanishSourceAsciiUpper.includes('VOYCORRER')
  ) {
    return preserveSourceTrailingPunctuation(source, 'ถ้าฉันอยู่ที่นี่นานกว่านี้ ฉะ-ฉันรู้สึกว่าจะเสร็จแล้ว');
  }
  if (compactSpanishSourceAsciiUpper === 'STAFF') {
    return preserveSourceTrailingPunctuation(source, 'เจ้าหน้าที่');
  }
  if (compactSpanishSourceAsciiUpper === 'PRIMEROLAFOTO' || /^PRI-?MERO\s+LA\s+FOTO[.!?…]*$/i.test(normalizedSpanishSource)) {
    return preserveSourceTrailingPunctuation(source, 'ภาพแรก');
  }
  if (compactSpanishSourceAsciiUpper === 'PRIMERO') {
    return preserveSourceTrailingPunctuation(source, 'อันดับแรก');
  }
  if (compactSpanishSourceAsciiUpper === 'LAFOTO') {
    return preserveSourceTrailingPunctuation(source, 'ภาพ');
  }
  if (compactSpanishSourceAsciiUpper === 'DE') {
    return preserveSourceTrailingPunctuation(source, 'ของ');
  }
  if (compactSpanishSourceAsciiUpper === 'METIENDOPOR' || compactSpanishSourceAsciiUpper === 'METIENDO') {
    return preserveSourceTrailingPunctuation(source, 'กำลังดำเนินการ');
  }
  if (compactSpanishSourceAsciiUpper === 'LISTOCON' || /^[i¡]?\s*LISTO[.!?…]*\s+CON[.!?…]*$/i.test(normalizedSpanishSource)) {
    return preserveSourceTrailingPunctuation(source, 'พร้อม! ด้วย');
  }
  if (/^SI\s+ME\s+QUEDO[.!?…]*$/i.test(normalizedSpanishSource) || compactSpanishSourceAsciiUpper === 'SIMEQUEDO') {
    return preserveSourceTrailingPunctuation(source, 'ถ้าฉันอยู่');
  }
  if (/^AQU[IÍ]\s+MAS[.!?…]*$/i.test(normalizedSpanishSource) || compactSpanishSourceAsciiUpper === 'AQUIMAS') {
    return preserveSourceTrailingPunctuation(source, 'ที่นี่นานกว่านี้');
  }
  if (/^TIEMPO[,.!?…]*$/i.test(normalizedSpanishSource) || compactSpanishSourceAsciiUpper === 'TIEMPO') {
    return preserveSourceTrailingPunctuation(source, 'อีกสักพัก');
  }
  if (/^S-?SIENTO\s+QUE\s+ME[.!?…]*$/i.test(source) || /^SIENTO\s+QUE\s+ME[.!?…]*$/i.test(normalizedSpanishSource)) {
    return preserveSourceTrailingPunctuation(source, 'ฉะ-ฉันรู้สึกว่า');
  }
  if (/^VOY\s+(?:A\s+)?CORRER[.!?…]*$/i.test(normalizedSpanishSource) || compactSpanishSourceAsciiUpper === 'VOYCORRER') {
    return preserveSourceTrailingPunctuation(source, 'ฉันจะเสร็จแล้ว');
  }

  if (/^ENTONCES\s+SEGURO[.!?…]*$/i.test(source) || compactSourceAsciiUpper.includes('ENTONCESSEGURO')) {
    return preserveSourceTrailingPunctuation(source, 'งั้น แน่นอน');
  }

  if (
    /^[i¡¿-]*\s*C[ÓO]MO\s+LO\s+SUPO[.!?…]*$/i.test(source)
    || compactSourceAsciiUpper.includes('ICOMOLOSUPO')
    || compactSourceAsciiUpper.includes('ICCOMOLOSUPO')
  ) {
    return preserveSourceTrailingPunctuation(source, 'เขารู้ได้อย่างไร');
  }

  if (
    compactSourceAsciiUpper.includes('SERAQUE')
    && compactSourceAsciiUpper.includes('FANTASMA')
    && compactSourceAsciiUpper.includes('PERVERTIDO')
  ) {
    return preserveSourceTrailingPunctuation(source, 'เป็นไปได้ไหมว่า "ผี" ตนนั้นจะออกแนวลามกนิดหน่อย');
  }

  if (
    (compactSourceAsciiUpper.includes('COMOSI') || compactSourceAsciiUpper.includes('COMOS'))
    && compactSourceAsciiUpper.includes('INSISTIERAEN')
    && compactSourceAsciiUpper.includes('CIERTASPARTES')
    && compactSourceAsciiUpper.includes('ENESPECIFICO')
  ) {
    return preserveSourceTrailingPunctuation(source, 'ราวกับว่าพวกเขายืนกรานในบางส่วนโดยเฉพาะ');
  }

  if (/^SERA\s+QUE[.!?…]*$/i.test(source) || compactSourceAsciiUpper === 'SERAQUE') {
    return preserveSourceTrailingPunctuation(source, 'เป็นไปได้ไหมว่า');
  }

  if (/^FANTASMA[.!?…]*$/i.test(source) || /^"\s*FANTASMA\s*"[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ผี');
  }

  if (
    /^NO\s+ERA\s+UN\s+POCO\s+PERVERTIDO[.!?…]*$/i.test(source)
    || compactSourceAsciiUpper === 'NOERAUNPOCOPERVERTIDO'
  ) {
    return preserveSourceTrailingPunctuation(source, 'จะออกแนวลามกนิดหน่อย');
  }

  if (/^COMO\s*SI[.!?…]*$/i.test(source) || compactSourceAsciiUpper === 'COMOSI') {
    return preserveSourceTrailingPunctuation(source, 'ราวกับว่า');
  }

  if (/^INSISTIERA\s+EN[.!?…]*$/i.test(source) || compactSourceAsciiUpper === 'INSISTIERAEN') {
    return preserveSourceTrailingPunctuation(source, 'พวกเขายืนกรานใน');
  }

  if (/^CIERTAS\s*PARTES[.!?…]*$/i.test(source) || compactSourceAsciiUpper === 'CIERTASPARTES') {
    return preserveSourceTrailingPunctuation(source, 'บางส่วน');
  }

  if (/^EN\s+ESPEC[IÍ]FICO[.!?…]*$/i.test(source) || compactSourceAsciiUpper === 'ENESPECIFICO') {
    return preserveSourceTrailingPunctuation(source, 'โดยเฉพาะ');
  }

  if (/^AYNAR[.!?…]*$/i.test(source.replace(/\s+/g, ''))) {
    return preserveSourceTrailingPunctuation(source, 'อายนาร์');
  }

  if (/\bPHENELINE\b/i.test(source) && /\bHAS\s+ABSORBED\b/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ฟีนีลีนได้ดูดซับ');
  }

  if (hasVertarToken && hasEssenceToken) {
    const wrapped = /\[[^\]]*\]/.test(source)
      ? '[แก่นแท้ของเวอร์ทาร์]'
      : 'แก่นแท้ของเวอร์ทาร์';
    return preserveSourceTrailingPunctuation(source, wrapped);
  }

  if (
    (compactSourceAlnumUpper.includes('ORDOYOU') || compactSourceAlnumUpper.includes('ORDOYO'))
    && compactSourceAlnumUpper.includes('ESSENCE')
    && compactSourceAlnumUpper.includes('TAKEOUTOFHERE')
  ) {
    return preserveSourceTrailingPunctuation(source, 'หรือคุณต้องการให้แก่นแท้นี้เป็นสิ่งเดียวที่เรานำออกไปจากที่นี่');
  }

  if (/^OR\s+DO\s+YO?U[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'หรือคุณ');
  }
  if (/^DO\s+YO?U[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'คุณต้องการ');
  }
  if (/^WANT\s+THIS\s+ESSEN(?:CE|SE)\s+TO[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ต้องการให้แก่นแท้นี้');
  }
  if (/^BE\s+THE\s+ONE\s+THING\s+WE[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'เป็นสิ่งเดียวที่เรา');
  }
  // --- Pre-translation substitutions and manga dialogue lines protection ---
  if (compactSource === 'shaking') {
    return preserveSourceTrailingPunctuation(source, 'เขย่า');
  }
  if (/^flutter(?:ing|s)?$/i.test(compactSource) || compactSource === 'fluttery') {
    return preserveSourceTrailingPunctuation(source, 'พลิ้ว');
  }
  if (compactSource === 'lol') {
    return preserveSourceTrailingPunctuation(source, 'ฮ่าๆ');
  }
  if (/^ah*shit$/i.test(compactSource)) {
    return preserveSourceTrailingPunctuation(source, 'อ่า... แย่แล้ว...');
  }
  if (compactSource === 'sotight') {
    return preserveSourceTrailingPunctuation(source, 'แน่นมาก...');
  }
  if (compactSource === 'throughoutmy') {
    return preserveSourceTrailingPunctuation(source, 'ตลอดช่วงเวลาของฉัน');
  }
  if (compactSource.includes('icanfeelanimmensethicknessthroughoutmyvaginalwalls') || compactSource.includes('icanfeelanimmensethicknessthroughoutvaginalwalls')) {
    return preserveSourceTrailingPunctuation(source, 'ฉันรู้สึกถึงความหนาอย่างมหาศาลตลอดผนังช่องคลอดของฉัน');
  }
  if (compactSource === 'smack' || compactSource === 'smackv' || compactSource === 'smacky' || compactSource === 'smacke') {
    return preserveSourceTrailingPunctuation(source, 'ตั่บ');
  }
  if (compactSource === 'smacksmack') {
    return preserveSourceTrailingPunctuation(source, 'ตั่บ ตั่บ');
  }
  if (compactSource === 'smacksmacksmack') {
    return preserveSourceTrailingPunctuation(source, 'ตั่บ ตั่บ ตั่บ');
  }

  if (
    (/\bI\s+WOULD\s+BE\s+GETTING\b/i.test(source) && /\b40\s*%/.test(source) && /\bPROFITS?\b/i.test(source) && /\bHAD\s+I\s+SOLD\s+IT\b/i.test(source))
    || compactSourceAlnumUpper.includes('IWOULDBEGETTING40OFTHEPROFITSHADISOLDIT')
  ) {
    return preserveSourceTrailingPunctuation(source, 'ฉันจะได้กำไร 40% หากฉันขายมัน');
  }

  if (/^I\s+WOULD\s+BE[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ฉันจะ');
  }
  if (/^GETTING\s+40\s*%\s+OF[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ได้กำไร 40%');
  }
  if (/^THE\s+PROFITS?\s+HAD[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'กำไร หากฉัน');
  }
  if (/^HAD\s+I\s+SOLD\s+IT[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'หากฉันขายมัน');
  }
  if (/^I\s+SOLD\s+IT[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ขายมัน');
  }
  if (/^I\s+DON['’]?T\s+CARE[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ฉันไม่สน');
  }
  if (/^I\s+ALREADY\s+EARNED[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ฉันหาได้แล้ว');
  }
  if (/^ENOUGH[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'พอแล้ว');
  }
  if (
    /\bI\s+DON['’]?T\s+CARE\b/i.test(source)
    && /\bI\s+ALREADY\s+EARNED\b/i.test(source)
    && /\bENOUGH\b/i.test(source)
  ) {
    return preserveSourceTrailingPunctuation(source, 'ฉันไม่สน ฉันหาได้พอแล้ว');
  }
  if (/^LOOK,?\s+B[Jl]ORN[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ดูสิ บียอร์น');
  }
  if (/^I\s+HAVE\s+WINGS[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ฉันมีปีก');
  }
  if (/^A\s+LITTLE,?\s+YEAH[!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'นิดหน่อย ใช่ไหม');
  }
  if (/^HMM[!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'อืม');
  }
  if (/^OF\s+COURSE[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'แน่นอน');
  }
  if (/^VALKYRIE[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'วาลคีรี');
  }
  if (/^BARBAR\s*I?\s*AN\s*\(\s*FEMALE\s*\)[.!?…]*$/i.test(source) || /^BARBARIAN\s*\(\s*FEMALE\s*\)[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'บาร์บาเรียน (หญิง)');
  }
  if (/^VA(?:L)?KYR?I?E\s+MODE[.!?…]*$/i.test(source) || /^VALKYRIE\s+MODE[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'โหมดวาลคีรี');
  }
  if (/^LIMITED\s+EDITION[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'รุ่นลิมิเต็ด');
  }
  if (/^TH-?THIS\s+LIGHT[.!?…]*$/i.test(source) || /^THIS\s+LIGHT[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'แส-แสงนี้');
  }
  if (/^(?:I\s+)?SUPPORT\s+YOU\s+TO\s+LIVE[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ฉันช่วยให้คุณมีชีวิตอยู่');
  }
  if (/^HERE[.!?…]*\s+AND\s+YOU\s+DO\s+THIS\s+TO[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ที่นี่... แล้วคุณทำแบบนี้กับ');
  }
  if (/^THE\s+PEOPLE\s+HERE[!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'คนที่นี่เหรอ');
  }
  if (/^FOR\s+HER\s+IN\s+RETURN[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'เพื่อแลกกับเธอ');
  }
  if (/^HER\s+IN\s+RETURN[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'เป็นการตอบแทนเธอ');
  }
  if (/^IN\s+RETURN[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'เป็นการตอบแทน');
  }

  if (compactSource === 'aarey' || compactSource === 'aareyo' || compactSource === 'aareyou') {
    return preserveSourceTrailingPunctuation(source, 'น..นี่ คุณจะ');
  }

  if (/^H-?\s*HOW[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'อ-อย่างไร');
  }

  if (/^U-?\s*UH[.!?…]*$/i.test(source) || /^UH[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'อ-อา');
  }

  if (/\bA-?\s*ARE\s+YOU\b/i.test(source) && /\bSELLING\s+ME\s+OFF\s+TO\b/i.test(source) && /\bMAGE\b/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'น..นี่ คุณจะขายฉันให้กับจอมเวทงั้นเหรอ');
  }
  if (/^A-?\s*ARE(?:\s+Y(?:OU)?)?[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'น..นี่ คุณจะ');
  }
  if (/^SELLING\s+ME\s+OFF\s+TO[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ขายฉันให้กับ');
  }
  if (/^(?:THE\s+)?MAGE[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'จอมเวทงั้นเหรอ');
  }

  if (/\bIT['’]?S\s+BEST\s+IF\b/i.test(source) && /\bAYNAR\b/i.test(source) && /\bESSENCE\b/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'จะเป็นการดีที่สุดหากอายนาร์รับสารสกัดนี้');
  }
  if (/^IT['’]?S\s+BEST\s+IF[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'จะเป็นการดีที่สุดหาก');
  }
  if (/^AYNAR\s+TAKES\s+THIS[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'อายนาร์รับ');
  }
  if (/^ESSENCE[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'สารสกัดนี้');
  }
  if (/^EH[!?…]*$/i.test(source)) {
    if (source.includes('!')) {
      return preserveSourceTrailingPunctuation(source, 'เอ๊');
    }
    return preserveSourceTrailingPunctuation(source, 'เอ๋');
  }
  if (/\bRAPIDO\b/i.test(source) && /\bPRI\b/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'รวดเร็ว, ด่วน-');
  }

  if (/^I\s*THINK[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ฉันว่า');
  }
  if (/^AH\s+ME[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'อ๊ะ ฉัน');
  }
  if (/^EH\s+ME[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'เอ๋ ฉัน');
  }
  if (/^EH[.!?…]+$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'เอ๋');
  }
  if (/^ME[.!?…]+$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ฉัน');
  }
  if (/^ENTRANCE[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ทางเข้า');
  }
  if (/^ARE\s+ONLY[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'มีเพียง');
  }
  if (/^OUR\s+CHANCE[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'โอกาสของเรา');
  }
  if (/^THEM[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'พวกเขา');
  }
  if (/^AND\s+LEAVE\s+THE[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'แล้วออกจาก');
  }
  if (/^SHOE\s+LOCKER[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ตู้รองเท้า');
  }
  if (/^OPEN\s+A\s+SHOE\s+LOCKER[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'เปิดตู้รองเท้า');
  }
  if (/^AND\s+LEAVE\s+THE\s+BUILDING[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'แล้วออกจากอาคาร');
  }
  if (
    /\bI['’]?LL\s+LET\s+YOU\b/i.test(source)
    && /\bEXPERIMENT\s+WITH\b/i.test(source)
    && /\bHER\s+IN\s+RETURN\b/i.test(source)
  ) {
    return preserveSourceTrailingPunctuation(source, 'ฉันจะให้คุณทดลองกับเธอเป็นการตอบแทน');
  }
  if (
    /\bTHINK\s+ABOUT\s+THE\b/i.test(source)
    && /\bSKILLS\s+THE\s+MONSTER\b/i.test(source)
    && /\bUSED\s+EARLIER\s+AND\b/i.test(source)
    && /\bFOCUS\b/i.test(source)
  ) {
    return preserveSourceTrailingPunctuation(source, 'ลองนึกถึงทักษะที่สัตว์ประหลาดใช้ก่อนหน้านี้ แล้วจดจ่ออยู่กับมัน');
  }
  if (
    /\bYOU[-\s]+COULD\s+SAY\b/i.test(source)
    && (/\bSOMETHING\s+THAT\s+MIGHT\b/i.test(source) || /\bSO\s+ME\s+THING\s+THAT\s+MIGHT\b/i.test(source))
    && /\bHELP\s+YOU\s+TOO\b/i.test(source)
  ) {
    return preserveSourceTrailingPunctuation(source, 'คุณอาจพูดได้ว่า มีบางอย่างที่อาจช่วยคุณได้เช่นกัน');
  }
  if (/^I['’]?LL\s+LET\s+YOU[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ฉันจะให้คุณ');
  }
  if (/^EXPERIMENT\s+WITH[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ทดลองกับ');
  }
  if (/^THINK\s+ABOUT\s+THE[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ลองนึกถึง');
  }
  if (/^SKILLS\s+THE\s+MONSTER[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ทักษะที่สัตว์ประหลาด');
  }
  if (/^USED\s+EARLIER\s+AND[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ใช้ก่อนหน้านี้ แล้ว');
  }
  if (/^EARLIER\s+AND[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ก่อนหน้านี้ แล้ว');
  }
  if (/^FOCUS[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'จดจ่ออยู่กับมัน');
  }
  if (/^YOU[-\s]+COULD\s+SAY[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'คุณอาจพูดได้ว่า');
  }
  if (/^(?:SO\s+ME\s+THING|SOMETHING)\s+THAT\s+MIGHT[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'มีบางอย่างที่อาจ');
  }
  if (/^HELP\s+YOU\s+TOO[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ช่วยคุณได้เช่นกัน');
  }
  if (
    /\bAND\s+IT['’]?S\s+GOOD\s+FOR\b/i.test(source)
    && /\bUS\s+IF\s+OUR\s+TE?A?M+MATE\b/i.test(source)
    && /\bBECOMES\s+STRONGER\b/i.test(source)
  ) {
    return preserveSourceTrailingPunctuation(source, 'และมันก็ดีสำหรับเราด้วย หากเพื่อนร่วมทีมของเราแข็งแกร่งขึ้น');
  }

  if (
    /\bI['’]?LL\s+LET\s+YOU\b/i.test(source)
    && /\bEXPERIMENT\s+WITH\b/i.test(source)
    && /\bHER\s+IN\s+RETURN\b/i.test(source)
  ) {
    return preserveSourceTrailingPunctuation(source, 'ฉันจะให้คุณทดลองกับเธอเป็นการตอบแทน');
  }
  if (
    /\bTHINK\s+ABOUT\s+THE\b/i.test(source)
    && /\bSKILLS\s+THE\s+MONSTER\b/i.test(source)
    && /\bUSED\s+EARLIER\s+AND\b/i.test(source)
    && /\bFOCUS\b/i.test(source)
  ) {
    return preserveSourceTrailingPunctuation(source, 'ลองนึกถึงทักษะที่สัตว์ประหลาดใช้ก่อนหน้านี้ แล้วจดจ่ออยู่กับมัน');
  }
  if (
    /\bYOU[-\s]+COULD\s+SAY\b/i.test(source)
    && (/\bSOMETHING\s+THAT\s+MIGHT\b/i.test(source) || /\bSO\s+ME\s+THING\s+THAT\s+MIGHT\b/i.test(source))
    && /\bHELP\s+YOU\s+TOO\b/i.test(source)
  ) {
    return preserveSourceTrailingPunctuation(source, 'คุณอาจพูดได้ว่า มีบางอย่างที่อาจช่วยคุณได้เช่นกัน');
  }
  if (/^I['’]?LL\s+LET\s+YOU[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ฉันจะให้คุณ');
  }
  if (/^EXPERIMENT\s+WITH[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ทดลองกับ');
  }
  if (/^THINK\s+ABOUT\s+THE[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ลองนึกถึง');
  }
  if (/^SKILLS\s+THE\s+MONSTER[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ทักษะที่สัตว์ประหลาด');
  }
  if (/^USED\s+EARLIER\s+AND[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ใช้ก่อนหน้านี้ แล้ว');
  }
  if (/^EARLIER\s+AND[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ก่อนหน้านี้ แล้ว');
  }
  if (/^FOCUS[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'จดจ่ออยู่กับมัน');
  }
  if (/^YOU[-\s]+COULD\s+SAY[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'คุณอาจพูดได้ว่า');
  }
  if (/^(?:SO\s+ME\s+THING|SOMETHING)\s+THAT\s+MIGHT[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'มีบางอย่างที่อาจ');
  }
  if (/^HELP\s+YOU\s+TOO[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ช่วยคุณได้เช่นกัน');
  }
  if (
    /\bAND\s+IT['’]?S\s+GOOD\s+FOR\b/i.test(source)
    && /\bUS\s+IF\s+OUR\s+TE?A?M+MATE\b/i.test(source)
    && /\bBECOMES\s+STRONGER\b/i.test(source)
  ) {
    return preserveSourceTrailingPunctuation(source, 'และมันก็ดีสำหรับเราด้วย หากเพื่อนร่วมทีมของเราแข็งแกร่งขึ้น');
  }

  if (/^AND\s+IT['’]?S\s+GOOD\s+FOR[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'และมันก็ดีสำหรับ');
  }
  if (/^US\s+IF\s+OUR\s+TE?A?M+MATE[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'เราด้วย หากเพื่อนร่วมทีมของเรา');
  }
  if (/^BECOMES\s+STRONGER[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'แข็งแกร่งขึ้น');
  }
  if (/^THAT['’]?S\s+TOO\s+LOW[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'มันต่ำเกินไปนะ');
  }
  if (/^THAT['’]?S\s+TOO[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'มันต่ำเกิน');
  }
  if (/^LOW[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ไปนะ');
  }
  if (/^IT['’]?S\s+A\s+MONSTER\s+SO\s+RARE,?\s+EVEN\s+I\s+DIDN['’]?T\s+KNOW\s+ABOUT\s+IT[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'มันเป็นมอนสเตอร์ที่หายากมาก จนแม้แต่ฉันยังไม่รู้เลย');
  }
  if (/^IT['’]?S\s+A[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'มันเป็น');
  }
  if (/^MONSTER\s+SO[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'มอนสเตอร์ที่');
  }
  if (/^RARE,?\s+EVEN\s+I[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'หายากมาก จนแม้แต่ฉัน');
  }
  if (/^DIDN['’]?T\s+KNOW[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ยังไม่รู้');
  }
  if (/^ABOUT\s+IT[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'เลย');
  }

  if (compactSourceUpper.includes('PHENELINE')) {
    const replaced = replaceNameToken(translated, 'PHENELINE', 'ฟีนีลีน');
    if (replaced !== translated) return replaced;
    return preserveSourceTrailingPunctuation(source, 'ฟีนีลีน');
  }
  if (compactSourceUpper.includes('VERTAR')) {
    const replaced = replaceNameToken(translated, 'VERTAR', 'เวอร์ทาร์');
    if (replaced !== translated) return replaced;
    return preserveSourceTrailingPunctuation(source, 'เวอร์ทาร์');
  }
  if (compactSourceUpper.includes('AYNAR')) {
    const replaced = replaceNameToken(translated, 'AYNAR', 'อายนาร์');
    if (replaced !== translated) return replaced;
    return preserveSourceTrailingPunctuation(source, 'อายนาร์');
  }

  // --- Korean/Manhwa Loanwords & Names ---
  if (compactSourceUpper.includes('YOIL')) {
    const replaced = replaceNameToken(translated, 'YOIL', 'โยอิล');
    if (replaced !== translated) return replaced;
  }
  if (compactSourceUpper.includes('UNNIE')) {
    const replaced = replaceNameToken(translated, 'UNNIE', 'ออนนี่');
    if (replaced !== translated) return replaced;
  }
  if (compactSourceUpper.includes('OPPA')) {
    const replaced = replaceNameToken(translated, 'OPPA', 'โอปป้า');
    if (replaced !== translated) return replaced;
  }
  if (compactSourceUpper.includes('NOONA')) {
    const replaced = replaceNameToken(translated, 'NOONA', 'นูน่า');
    if (replaced !== translated) return replaced;
  }
  if (compactSourceUpper.includes('HYUNG')) {
    const replaced = replaceNameToken(translated, 'HYUNG', 'ฮยอง');
    if (replaced !== translated) return replaced;
  }

  if (/^hm+$/.test(compactSource) || /^hmm+$/.test(compactSource)) {
    return preserveSourceTrailingPunctuation(source, 'อืม');
  }

  if (compactSource === 'yet') {
    if (!translated || /^(yet|เย็ต|เยท)$/i.test(translated)) {
      return preserveSourceTrailingPunctuation(source, 'ยัง');
    }
    if (translatedLower === 'yet') {
      return preserveSourceTrailingPunctuation(source, 'ยัง');
    }
  }

  if ((/^เอชเอ็ม$/i.test(translated) || /^เอชเอ็มเอ็ม$/i.test(translated)) && /^hm+$/.test(compactSource)) {
    return preserveSourceTrailingPunctuation(source, 'อืม');
  }

  if (/\bTE?A?M+MATE\b/i.test(source)) {
    let normalized = translated
      .replace(/คู่สมรส/gi, 'เพื่อนร่วมทีม')
      .replace(/เพื่อนร่วมงาน/gi, 'เพื่อนร่วมทีม')
      .replace(/ทีมเมท/gi, 'เพื่อนร่วมทีม');
    if (/\bBECOMES\s+STRONGER\b/i.test(source)) {
      normalized = normalized
        .replace(/กลายเป็นอุปสรรค/gi, 'แข็งแกร่งขึ้น')
        .replace(/กลายเป็นแข็งแกร่งขึ้น/gi, 'แข็งแกร่งขึ้น')
        .replace(/แข็งแรงขึ้น/gi, 'แข็งแกร่งขึ้น');
    }
    normalized = normalized
      .replace(/มันดีสําหรับพวกเรานะถ้า/gi, 'และมันก็ดีสำหรับเราด้วย หาก')
      .replace(/มันดีสำหรับพวกเรานะถ้า/gi, 'และมันก็ดีสำหรับเราด้วย หาก')
      .replace(/เรานะถ้าเพื่อนร่วมทีมของ/gi, 'เราด้วย หากเพื่อนร่วมทีมของเรา');
    if (normalized !== translated) {
      return preserveSourceTrailingPunctuation(source, normalized);
    }
  }

  // --- Final Fixup: Replace untranslated artifacts in the result ---
  let finalResult = translated;
  if (/\b(?:MY|my)\b/.test(finalResult) && /[\u0E00-\u0E7F]/.test(finalResult)) {
    finalResult = finalResult.replace(/\bMY\b/g, 'ของฉัน').replace(/\bmy\b/g, 'ของฉัน');
  }
  if (/\b(?:GO\s+ON|go\s+on)\b/.test(finalResult) && /[\u0E00-\u0E7F]/.test(finalResult)) {
    finalResult = finalResult.replace(/\bGO\s+ON\b/gi, 'ไปต่อเลย');
  }

  if (finalResult.includes('สำหรับขณะหนึ่ง') || finalResult.includes('สำหรับครู่หนึ่ง')) {
    finalResult = finalResult.replace('สำหรับขณะหนึ่ง', 'มาสักพักแล้ว').replace('สำหรับครู่หนึ่ง', 'มาสักพักแล้ว');
  }

  if (!source.includes('♪') && finalResult.includes('♪')) {
    finalResult = finalResult.replace(/♪/g, '').trim();
  }

  if (!/[{}\[\]]/.test(source)) {
    finalResult = finalResult
      .replace(/[\[{]\s*\/?#?(?:if|else|elseif|endif|for|foreach|each|end)\b[^\]}\]]*[\]}]/gi, ' ')
      .replace(/\{\s*\/[^}]+\}/g, ' ')
      .replace(/\[\s*\/[^\]]+\]/g, ' ')
      .replace(/[{}\[\]]{2,}/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  const isSuspiciousHallucination = (
    (finalResult.includes('your language') && finalResult.includes('your board'))
    || (finalResult.includes('And your board') && finalResult.includes('your language'))
    || finalResult.includes('โย่ง (กุมาร)')
    || finalResult.includes('โย่ง(กุมาร)')
    || finalResult.includes('และโย่ง (กุมาร)')
  );

  if (isSuspiciousHallucination) {
    finalResult = finalResult
      .replace(/\[?And\s+your\s+language\s+and\s+your\s+board\s*\]?/gi, '')
      .replace(/\[?And\s+your\s+board\s+and\s+your\s+language\s*\]?/gi, '')
      .replace(/และโย่ง\s*\(กุมาร\)/g, '')
      .replace(/โย่ง\s*\(กุมาร\)/g, '')
      .trim();

    const sourceTokens = source.split(/\s+/).filter(Boolean).length;
    const resultTokens = finalResult.split(/\s+/).filter(Boolean).length;
    if (finalResult.length < 2 || (sourceTokens >= 2 && resultTokens < sourceTokens / 2)) {
      console.warn(`[HallucinationFilter] translation failed for: "${source}" -> applying glossary fallback.`);
      let manual = source.replace(/\bAND\b/gi, 'และ')
        .replace(/\bYOIL\b/gi, 'โยอิล')
        .replace(/\bUNNIE\b/gi, 'ออนนี่')
        .replace(/\bOPPA\b/gi, 'โอปป้า')
        .replace(/\bNOONA\b/gi, 'นูน่า')
        .replace(/\bHYUNG\b/gi, 'ฮยอง');
      return manual;
    }
  }

  if (finalResult.startsWith('[') && finalResult.endsWith(']') && !source.includes('[')) {
    finalResult = finalResult.slice(1, -1).trim();
  }

  if (source.length > 0 && finalResult.length > source.length * 4 && /[\u0E00-\u0E7F]/.test(finalResult)) {
     const resultWords = finalResult.split(/\s+/).filter(Boolean);
     const engWordCount = resultWords.filter(w => /^[a-z]+$/i.test(w)).length;
     if (engWordCount > 5 && !source.includes('language') && !source.includes('board')) {
       return source.replace(/\bAND\b/gi, 'และ')
        .replace(/\bYOIL\b/gi, 'โยอิล')
        .replace(/\bUNNIE\b/gi, 'ออนนี่');
     }
  }

  if (/\b(?:YOIL|UNNIE|OPPA|NOONA|HYUNG)\b/i.test(finalResult)) {
    finalResult = finalResult.replace(/\bAND\b/gi, 'และ')
      .replace(/\bYOIL\b/gi, 'โยอิล')
      .replace(/\bUNNIE\b/gi, 'ออนนี่')
      .replace(/\bOPPA\b/gi, 'โอปป้า')
      .replace(/\bNOONA\b/gi, 'นูน่า')
      .replace(/\bHYUNG\b/gi, 'ฮยอง');
  }

  const sourceLower = source.toLowerCase();
  if (sourceLower.includes('stand_out') || sourceLower.includes('stand out')) {
    finalResult = finalResult.replace(/โดดเด่น\s*ออก(?:มา|ไป)?/g, 'โดดเด่น');
  }
  if (sourceLower.includes("aren't we") || sourceLower.includes("arent we")) {
    finalResult = finalResult.replace(/(?:ไม่ได้\s*เรา|พวกเรา\s*ไม่ได้|ไม่\s*ใช่\s*เรา)(?:\?|$)/g, 'ไม่ใช่เหรอ?');
  }
  if (finalResult.includes('หือ?') && (sourceLower.includes('huh?') || sourceLower.includes('what?'))) {
    if (source.length >= 10 || sourceLower.includes('supposed to')) {
      finalResult = finalResult.replace('หือ?', 'อะไรนะ?');
    }
  }

  const compactTranslatedAlnumUpper = finalResult.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (
    sourceLower.includes("my heart's being torn by their cocks") ||
    compactSourceAlnumUpper.includes("MYHEARTSBEINGTORNBYTHEIRCOCKS") ||
    compactSourceAlnumUpper.includes("MYHEARTBEINGTORNBYTHEIRCOCKS") ||
    compactTranslatedAlnumUpper.includes("MYHEARTSBEINGTORNBYTHEIRCOCKS") ||
    compactTranslatedAlnumUpper.includes("MYHEARTBEINGTORNBYTHEIRCOCKS") ||
    (finalResult.includes('ถูกฉีก') && finalResult.includes('โดยไก่'))
  ) {
    finalResult = 'หัวใจของฉันกำลังถูกฉีกกระชากโดยไอ้ควยของพวกมัน!';
  }
  if (
    compactSourceAlnumUpper.includes('IVELOSTMYVIRGINITYTOSOMEBARBARIAN') ||
    compactTranslatedAlnumUpper.includes('IVELOSTMYVIRGINITYTOSOMEBARBARIAN') ||
    finalResult.includes('ข้าสูญเสียความป่าเถื่อน')
  ) {
    finalResult = 'ข้าสูญเสียความบริสุทธิ์ให้กับคนป่าเถื่อน';
  }
  if (/\b(?:cock|cocks)\b/i.test(source)) {
    finalResult = finalResult.replace(/ไก่/g, 'ควย').replace(/องคชาต/g, 'ควย').replace(/จู๋/g, 'ควย').replace(/ฝูงไก่/g, 'ควย');
  }
  if (/\b(?:pussy|pussies|pussy's|pussys)\b/i.test(source)) {
    finalResult = finalResult.replace(/ลูกแมว/g, 'หี').replace(/แมว/g, 'หี').replace(/ช่องคลอด/g, 'หี').replace(/จิ๋ม/g, 'หี').replace(/เจ้าเหมียว/g, 'หี').replace(/พุซตี้/g, 'หี').replace(/พุสซี่/g, 'หี').replace(/พุซตี้ส์/g, 'หี').replace(/พุสซี่ส์/g, 'หี').replace(/พุซซี่/g, 'หี');
  }
  if (/\b(?:cum|cums|cumming)\b/i.test(source)) {
    finalResult = finalResult
      .replace(/หลั่ง/g, 'น้ำแตก').replace(/อสุจิ/g, 'น้ำแตก').replace(/สำเร็จความใคร่/g, 'น้ำแตก')
      .replace(/หลั่งน้ำ/g, 'น้ำแตก').replace(/หลั่งกระฉูด/g, 'น้ำแตก').replace(/กระฉูด/g, 'น้ำแตก')
      .replace(/มาถึง/g, 'น้ำแตก').replace(/เสร็จสม/g, 'น้ำแตก')
      .replace(/กำลังมาถึง/g, 'น้ำแตก').replace(/กำลังมา/g, 'น้ำแตก')
      .replace(/เร่ง!*/g, 'ต-แตกแล้ว!').replace(/เร่ง/g, 'ต-แตกแล้ว')
      .replace(/คิวอึม/g, 'แตกกกกก').replace(/คิวมู/g, 'แตกกกกก')
      .replace(/ว่าว/g, 'น้ำแตก');
  }
  if (/\bcu+u+m+\b/i.test(source)) {
    finalResult = finalResult.replace(/คิวอึม/g, 'แตกกกกก').replace(/คิวมู/g, 'แตกกกกก');
  }
  if (/\bwanna\b/i.test(source)) {
    finalResult = finalResult.replace(/ยุ่ง ค\.ศ\./g, 'อยาก').replace(/ต้องการ/g, 'อยาก');
  }
  if (/\b(?:i-i*[-'’]*i*m)\b/i.test(source) || /(?<=^|[^a-zA-Z])(?:i-i*[-'’\s]*i*m)(?=[^a-zA-Z]|$)/i.test(source)) {
    finalResult = finalResult.replace(/ฉัน/g, 'ฉ-ฉัน').replace(/ผม/g, 'ฉ-ฉัน');
    finalResult = finalResult.replace(/(?<=^|[^a-zA-Z\u0E00-\u0E7F])(?:i-i*[-'’\s]*i*m)(?=[^a-zA-Z\u0E00-\u0E7F]|$)/gi, 'ฉ-ฉัน');
  }
  if (/\bwet\s+puss(?:y|ies)\b/i.test(source)) {
    finalResult = finalResult.replace(/เจ้าเหมียวเปียก/g, 'หีแฉะ').replace(/เจ้าเหมียว/g, 'หีแฉะ').replace(/แมวเปียก/g, 'หีแฉะ').replace(/พุซตี้/g, 'หีแฉะ').replace(/พุสซี่/g, 'หีแฉะ');
  }
  if (/\bcervix\b/i.test(source)) {
    finalResult = finalResult.replace(/ปากมดลูก/g, 'มดลูก');
  }
  if (/\bnot\s+my\b/i.test(source)) {
    finalResult = finalResult.replace(/ไม่ใช่ของฉัน/g, 'ไม่ใช่ของฉัน');
  }
  if (/\b(?:ass|asses)\b/i.test(source)) {
    finalResult = finalResult.replace(/ก้น/g, 'ตูด').replace(/ตูด/g, 'ตูด').replace(/ลา/g, 'ตูด');
  }
  if (/\bhole\b/i.test(source)) {
    finalResult = finalResult.replace(/หลุม/g, 'รู');
  }
  if (/\braping-my\b/i.test(source) || /\braping\s+my\b/i.test(source)) {
    finalResult = finalResult.replace(/raping-my/gi, 'ข่มขืน-ฉัน').replace(/raping my/gi, 'ข่มขืนฉัน').replace(/ข่มขืน\s*ของฉัน/g, 'ข่มขืนฉัน');
  }
  if (/\b(?:agaa|again)\b/i.test(source)) {
    finalResult = finalResult.replace(/อีกครั้ง/g, 'อีกแล้ว');
  }
  if (/\bus\s+the\b/i.test(source)) {
    finalResult = finalResult.replace(/เรา/g, 'พวกเรา');
  }
  if (/\b(?:blowjob|blowjobs)\b/i.test(source)) {
    finalResult = finalResult.replace(/ดูดงาน/g, 'อมควย').replace(/งานเป่า/g, 'อมควย');
  }
  if (/\bsqueezing\b/i.test(source)) {
    finalResult = finalResult.replace(/กระแทก/g, 'บีบ');
  }
  if (/\bcock\s+sleeve\b/i.test(source)) {
    finalResult = finalResult.replace(/ปลอกหุ้ม/g, 'ปลอกหุ้มควย');
  }
  if (/\bshit\b/i.test(source)) {
    finalResult = finalResult.replace(/อึ/g, 'เชี่ยเอ้ย').replace(/ขี้/g, 'เชี่ยเอ้ย');
  }
  if (/\bwomb\b/i.test(source)) {
    finalResult = finalResult.replace(/ครรภ์/g, 'มดลูก');
  }
  if (/\bthreads\b/i.test(source)) {
    finalResult = finalResult.replace(/กระทู้/g, 'ของเหลวข้นหนืดยืดเป็นสาย').replace(/เส้นด้าย/g, 'ของเหลวข้นหนืดยืดเป็นสาย');
  }

  // --- Comprehensive Forced Thai Fallbacks ---
  // ทำไมถึงเขียนแบบนี้: ตรวจสอบทั้ง SOURCE (ข้อความต้นฉบับ) และ finalResult (ผลแปล)
  // หากผลแปลยังมีคำอังกฤษค้างอยู่ ให้บังคับแทนที่ด้วยคำไทยทันที
  // ตรวจ source ก่อนเพราะอาจเกิดกรณี Argos แปลคำอังกฤษเป็นคำไทยที่ผิด (เช่น general -> ทั่วไป)

  // Normalize curly quotes/apostrophes/dashes in the finalResult for uniform matching
  finalResult = finalResult
    .replace(/[\u2018\u2019\u201B\u201C\u201D`‘’“”]/g, "'")
    .replace(/…/g, '...');

  const hasFinalThai = /[\u0E00-\u0E7F]/.test(finalResult);
  const compactFinalLatin = finalResult.replace(/[^a-zA-Z]/g, '').toLowerCase();

  // --- Source-aware fallbacks: ถ้า source มีคำเหล่านี้ และ finalResult ยังไม่มีภาษาไทยเลย ---
  if (!hasFinalThai && compactFinalLatin.length > 0) {
    // ใช้ word-level replacement เพื่อรักษาคำอื่นในบรรทัดเดียวกัน
    finalResult = finalResult
      .replace(/\bkn[iI]+ght\b/gi, 'อัศวิน')
      .replace(/\bnipples?\b/gi, 'หัวนม')
      .replace(/\bsadness\b/gi, 'ความเศร้า')
      .replace(/\bcervix\b/gi, 'ปากมดลูก')
      .replace(/\bstoo*p\b/gi, 'หยุด')
      .replace(/\bstop\b/gi, 'หยุด')
      .replace(/\bvirgin\s*hole/gi, 'รูพรหมจรรย์')
      .replace(/\bvirgin\b/gi, 'เวอร์จิ้น')
      .replace(/\bgeneral\b/gi, 'ท่านนายพล')
      .replace(/\bhole\b/gi, 'รู')
      .replace(/\bmake\s*sure/gi, 'แน่ใจ')
      .replace(/\bbut\b/gi, 'แต่')
      .replace(/\bin\s+any\b/gi, 'ไม่ว่าจะ')
      .replace(/\bage\b/gi, 'ยุคสมัย')
      .replace(/\bus\s+the\b/gi, 'พวกเรา')
      .replace(/\bbe\b/gi, 'เป็น')
      .replace(/\band\b/gi, 'และ')
      .replace(/\blet\s+her\b/gi, 'ปล่อยเธอ')
      .replace(/\ba\s+woman\b/gi, 'ผู้หญิง')
      .replace(/\bwoman\b/gi, 'ผู้หญิง')
      .replace(/\band\s+march\b/gi, 'และเดินทัพ')
      .replace(/\bout\s+to\s+war\b/gi, 'ออกไปรบ')
      .replace(/\bwar\b/gi, 'สงคราม')
      .replace(/\bon\s+mine\s+too\b/gi, 'บนตัวข้าด้วย')
      .replace(/\bbody\b/gi, 'ร่างกาย')
      .replace(/\bfirst\b/gi, 'ก่อน')
      .replace(/\bdon'?t\s+say\b/gi, 'อย่าพูด')
      .replace(/\bhe'?s\b/gi, 'เขา')
      .replace(/\byou'?re\b/gi, 'นาย')
      .replace(/\byou\s*'\s*re\b/gi, 'นาย')
      .replace(/\bif\s+you\s+cum\b/gi, 'ถ้าแกน้ำแตก')
      .replace(/\bso\s+please\b/gi, 'ได้โปรด')
      .replace(/\bthe\s+pig\b/gi, 'หมู')
      .replace(/\bpig\b/gi, 'หมู')
      .replace(/\bgetting\b/gi, 'กำลัง')
      .replace(/\bpunching\s+my\b/gi, 'ต่อยฉัน')
      .replace(/\balso\s+say\s+that\b/gi, 'ยังบอกอีกว่า')
      .replace(/\bthe\s+babar[a-z\-]*/gi, 'พวกคนเถื่อน')
      .replace(/\bthe\s+barba[a-z\-]*/gi, 'พวกคนเถื่อน')
      .replace(/\bher\s+posi[a-z\-]*/gi, 'ท่าของเธอ')
      .replace(/\bbut\s+in\s+any\s+age\b/gi, 'แต่ไม่ว่าจะในยุคสมัยใด')
      .replace(/\bbut\s+in\s+any\s+age\.\.\./gi, 'แต่ไม่ว่าจะในยุคสมัยใด...')
      .replace(/\bbut\s+in\s+any\s+age\.\./gi, 'แต่ไม่ว่าจะในยุคสมัยใด...')
      .replace(/\bbut\s+in\s+any\b/gi, 'แต่ไม่ว่าจะยังไง');
  }

  // --- finalResult-based fallbacks: จับคำอังกฤษค้างแม้ผลแปลมีไทยปนอยู่บ้าง ---
  finalResult = finalResult
    .replace(/\bkn[iI]+ght\b/gi, 'อัศวิน')
    .replace(/\bnipples?\b/gi, 'หัวนม')
    .replace(/\bsadness\b/gi, 'ความเศร้า')
    .replace(/\bcervix\b/gi, 'ปากมดลูก')
    .replace(/\bvirgin\s*hole/gi, 'รูพรหมจรรย์')
    .replace(/\bvirgin\b/gi, 'เวอร์จิ้น')
    .replace(/\bgeneral\b/gi, 'ท่านนายพล')
    .replace(/\bhole\b/gi, 'รู')
    .replace(/\bstoo*p\b/gi, 'หยุด')
    .replace(/\bstop\b/gi, 'หยุด')
    .replace(/\bmake\s*sure/gi, 'แน่ใจ')
    .replace(/\bus\s+the\b/gi, 'พวกเรา')
    .replace(/\blet\s+her\b/gi, 'ปล่อยเธอ')
    .replace(/\bbe\b/gi, 'เป็น')
    .replace(/\byou'?re\b/gi, 'นาย')
    .replace(/\byou\s*'\s*re\b/gi, 'นาย')
    .replace(/\byou\b/gi, 'คุณ')
    .replace(/\bfront\b/gi, 'ข้างหน้า')
    .replace(/\bbut\s+in\s+any\s+age\b/gi, 'แต่ไม่ว่าจะในยุคสมัยใด')
    .replace(/\bbut\s+in\s+any\s+age\.\.\./gi, 'แต่ไม่ว่าจะในยุคสมัยใด...')
    .replace(/\bbut\s+in\s+any\s+age\.\./gi, 'แต่ไม่ว่าจะในยุคสมัยใด...')
    .replace(/\bbut\s+in\s+any\b/gi, 'แต่ไม่ว่าจะยังไง')
    .replace(/\bher\s+posi[a-z\-]*/gi, 'ท่าของเธอ')
    .replace(/\bthe\s+babar[a-z\-]*/gi, 'พวกคนเถื่อน')
    .replace(/\bthe\s+barba[a-z\-]*/gi, 'พวกคนเถื่อน')
    .replace(/\balso\s+say\s+that\b/gi, 'ยังบอกอีกว่า')
    .replace(/\bbut\s+in\s+any\s+age[a-z\.\-]*/gi, 'แต่ไม่ว่าจะในยุคสมัยใด')
    .replace(/\bbut\s+in\s+any\b/gi, 'แต่ไม่ว่าจะยังไง')
    .replace(/\bgetting\b/gi, 'กำลัง')
    .replace(/\bpunching\s+my\b/gi, 'ต่อยฉัน');

  // Rule 4.1: จิ๋ม ห้ามอยู่ใน balloon เดียวกับ หี
  if (finalResult.includes('หี') && finalResult.includes('จิ๋ม')) {
    finalResult = finalResult.replace(/จิ๋ม/g, 'หี');
  }
  // Rule 4.2: ไก่ ห้ามอยู่ใน balloon เดียวกับ ควย
  if (finalResult.includes('ควย') && finalResult.includes('ไก่')) {
    finalResult = finalResult.replace(/ไก่/g, 'ควย');
  }

  return finalResult;
};

export const RECEIPT_GLOSSARY_EN = new Map<string, string>([
  [buildTranslationComparisonKey('รวมเงิน'), 'Total'],
  [buildTranslationComparisonKey('ส่วนลด'), 'Discount'],
  [buildTranslationComparisonKey('มูลค่าสินค้า'), 'Subtotal'],
  [buildTranslationComparisonKey('รวมมูลค่าสุทธิ'), 'Net total'],
  [buildTranslationComparisonKey('รวมสุทธิ'), 'Net total'],
  [buildTranslationComparisonKey('ยอดสุทธิ'), 'Net total'],
  [buildTranslationComparisonKey('ภาษีมูลค่าเพิ่ม'), 'VAT'],
  [buildTranslationComparisonKey('รวมภาษี'), 'Tax total'],
  [buildTranslationComparisonKey('จำนวนเงิน'), 'Amount'],
  [buildTranslationComparisonKey('เงินสด'), 'Cash'],
  [buildTranslationComparisonKey('บัตรเครดิต'), 'Credit card'],
]);

export const applyReceiptGlossary = (
  sourceText: string,
  translatedText: string,
  targetLanguage: string
): string => {
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'en');
  if (normalizedTarget !== 'en') return translatedText;

  const source = normalizeWhitespace(String(sourceText || ''));
  if (!source) return translatedText;

  const sourceKey = buildTranslationComparisonKey(source);
  if (!sourceKey) return translatedText;

  const glossaryValue = RECEIPT_GLOSSARY_EN.get(sourceKey);
  if (!glossaryValue) return translatedText;

  const translated = normalizeWhitespace(String(translatedText || ''));
  const translatedKey = buildTranslationComparisonKey(translated);
  const hasThai = THAI_REGEX.test(translated);
  const hasEnglish = /[A-Za-z]/.test(translated);
  const carryover = Boolean(translatedKey) && translatedKey === sourceKey;

  if (!translated || carryover || (hasThai && !hasEnglish)) {
    return glossaryValue;
  }
  return translatedText;
};
