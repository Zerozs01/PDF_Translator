const KOREAN_HANGUL_REGEX = /[\uAC00-\uD7AF]/;
const KOREAN_THAI_REGEX = /[\u0E00-\u0E7F]/g;
const KOREAN_LATIN_REGEX = /[A-Za-z]/g;

const normalizeWhitespace = (text: string): string => String(text || '').replace(/\s+/g, ' ').trim();

const buildComparisonKey = (text: string): string => normalizeWhitespace(text)
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, '');

const KOREAN_COLLOQUIAL_REPAIRS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /말어(?![\uAC00-\uD7AF])/g, replacement: '말아' },
  { pattern: /줘\s+말아(?![\uAC00-\uD7AF])/g, replacement: '줘 말아' },
  { pattern: /([\uAC00-\uD7AF]+?)을라고/g, replacement: '$1으려고' },
  { pattern: /([\uAC00-\uD7AF]+?)를라고/g, replacement: '$1려고' },
  { pattern: /하느데(?![\uAC00-\uD7AF])/g, replacement: '하는데' },
];

const preserveSourceTrailingPunctuation = (sourceText: string, replacement: string): string => {
  const punctuation = String(sourceText || '').trim().match(/([.!?…]+)$/)?.[1] || '';
  const cleanReplacement = normalizeWhitespace(String(replacement || '')).replace(/[.!?…]+$/g, '').trim();
  return `${cleanReplacement}${punctuation}`.trim();
};

const KOREAN_CONVERSATIONAL_FALLBACKS: Array<{ pattern: RegExp; replacement: string }> = [
  // Short SFX / single-word fallbacks
  { pattern: /^헉$/, replacement: 'เฮือก' },
  { pattern: /^헉헉$/, replacement: 'แฮ่กๆ' },
  { pattern: /^하하$/, replacement: 'ฮ่าๆ' },
  { pattern: /^하하하$/, replacement: 'ฮ่าๆๆ' },
  { pattern: /^후후$/, replacement: 'หึๆ' },
  { pattern: /^음$/, replacement: 'อืม' },
  { pattern: /^응$/, replacement: 'อืม' },
  { pattern: /^아$/, replacement: 'อา' },
  { pattern: /^앗$/, replacement: 'อ๊ะ' },
  { pattern: /^어$/, replacement: 'เอ๊ะ' },
  { pattern: /^어라$/, replacement: 'เอ๊ะ' },
  { pattern: /^오$/, replacement: 'โอ้' },
  { pattern: /^에$/, replacement: 'เอ๋' },
  { pattern: /^우와$/, replacement: 'ว้าว' },
  { pattern: /^쉿$/, replacement: 'ชู่ว' },
  { pattern: /^짝$/, replacement: 'แปะ' },
  { pattern: /^쾅$/, replacement: 'ปัง' },
  { pattern: /^탁$/, replacement: 'ตึก' },
  { pattern: /^끄덕$/, replacement: 'พยักหน้า' },
  { pattern: /^절레$/, replacement: 'ส่ายหน้า' },
  { pattern: /^안녕$/, replacement: 'สวัสดี' },
  { pattern: /^네$/, replacement: 'ใช่' },
  { pattern: /^아니$/, replacement: 'ไม่' },
  { pattern: /^진짜$/, replacement: 'จริงเหรอ' },
  { pattern: /^제발$/, replacement: 'ได้โปรด' },

  // Phrases & colloquial patterns
  { pattern: /^걸레년$/, replacement: 'อีผู้หญิงสำส่อน' },
  { pattern: /^이거이거$/, replacement: 'เรื่องนี้ เรื่องนี้' },
  { pattern: /^넘어가줘말[어아]$/, replacement: 'ฉันควรปล่อยผ่านไปหรือไม่?' },
  { pattern: /^지울거지응$/, replacement: 'แกจะลบมันใช่ไหม? ฮึ?' },
  { pattern: /^잘나왔던데왜지워$/, replacement: 'มันออกมาดีนี่ ทำไมต้องลบ?' },
  { pattern: /^출력해서집에붙여놓을라고하는데ㅋ+$/, replacement: 'ฉันวางแผนจะพิมพ์ออกมาแล้วเอาไปติดไว้ที่บ้าน ฮ่าๆ' },
  { pattern: /^붙여놓을라고하는데$/, replacement: 'ฉันวางแผนจะเอาไปแขวนไว้' },
  { pattern: /^분여놓을라고하느데$/, replacement: 'ฉันวางแผนจะเอาไปแขวนไว้' },
  { pattern: /^미친[색섹새]까뒤지기싫으면$/, replacement: 'ไอ้สารเลว ถ้าไม่อยากตาย' },
  { pattern: /^빨리지워라$/, replacement: 'ลบมันซะเร็วๆ' },
  { pattern: /^안지우면진짜$/, replacement: 'ถ้าไม่ลบ' },
  { pattern: /^죽여버릴거야$/, replacement: 'ฉันจะฆ่าแกจริงๆ' },
  { pattern: /^음뭐지이$/, replacement: 'หืม! นี่อะไรกันเนี่ย?' },
  { pattern: /^가장빠른입분제공사이트$/, replacement: 'เว็บไซต์ให้บริการเข้าเร็วที่สุด' },
  { pattern: /^데자뷰같은이느낌$/, replacement: 'ความรู้สึกนี้เหมือนเคยเกิดขึ้นมาก่อน' },
  { pattern: /^출력$/, replacement: 'พิมพ์ออกมา' },
  { pattern: /^미친$/, replacement: 'บ้าเอ๊ย' },
  { pattern: /^몸으로때운다고$/, replacement: 'จะใช้ร่างกายชดเชยงั้นเหรอ?' },
  { pattern: /^그사진지워주면$/, replacement: 'ถ้าคุณลบรูปนั้น' },
  { pattern: /^내가뭐든할게$/, replacement: 'ฉันจะทำอะไรก็ได้' },
  { pattern: /^뭐든한다고$/, replacement: 'ทำอะไรก็ได้งั้นเหรอ?' },
  { pattern: /^응몸으로때울수있는거라면뭐든$/, replacement: 'อืม ถ้าเป็นอะไรที่เอาร่างกายชดเชยได้ก็ตามนั้น...' },
  { pattern: /^그렇지역시$/, replacement: 'ใช่แล้ว! อย่างที่ฉันคาดไว้เลย' },
  { pattern: /^자아물어라물어$/, replacement: 'เอาล่ะ ถามมาได้เลย' },
  { pattern: /^미안해맹호야$/, replacement: 'ฉันขอโทษนะ แมงโฮ' },
  { pattern: /^미미안해뱅호야$/, replacement: 'ฉันขอโทษจริงๆ บังโฮ' },
  { pattern: /^내가잘못했어$/, replacement: 'ฉันผิดเอง' },
  { pattern: /^화내지말고$/, replacement: 'อย่าโกรธสิ' },
  { pattern: /^내가어떡하면될까$/, replacement: 'ฉันควรทำยังไงดี?' },
  { pattern: /^뭐야갑자기이년이꼬랑지를내리네$/, replacement: 'อะไรนะ? จู่ๆ ยัยนี่ก็ยอมแล้วเหรอ?' },

  // Conversational additions to clean up common Argos hallucinations
  { pattern: /^그런데$/, replacement: 'อย่างไรก็ตาม' },
  { pattern: /^저기요$/, replacement: 'ขอโทษนะ' },
  { pattern: /^당연한거아니야$/, replacement: 'แน่นอนอยู่แล้วไม่ใช่เหรอ' },
  { pattern: /^똑바로누워$/, replacement: 'นอนตรงๆ' },
  { pattern: /^이런$/, replacement: 'แบบนี้' },
  { pattern: /^자$/, replacement: 'เอาล่ะ' },
  { pattern: /^이나이에섹스를하는것만으로도\D*죄책감이\d*장난아닌데\D*$/, replacement: 'ในวัยนี้ แค่มีเพศสัมพันธ์… ความรู้สึกผิดไม่ใช่เรื่องเล่นๆเลย…' },
  { pattern: /^빨리지워응너그런거필요$/, replacement: 'ลบออกเร็วๆ สิ เธอจำเป็นต้องมีของแบบนั้นด้วยเหรอ?' },
  { pattern: /^엇얘기끝났어$/, replacement: 'เอ๊ะ! คุยกันเสร็จแล้วเหรอ?' },
  { pattern: /^수진짜알지$/, replacement: 'ซู!! รู้จริงๆ ใช่ไหม?' },
  { pattern: /^짓이넘어가준다$/, replacement: 'ยอมมองข้ามการกระทำนี้ให้ก็ได้' },
];

export const normalizeKoreanColloquialOcrText = (text: string): string => {
  let normalized = String(text || '');
  normalized = normalized
    .replace(/。/g, '. ')
    .replace(/、/g, ', ')
    .replace(/！/g, '! ')
    .replace(/？/g, '? ')
    .replace(/〜/g, '~');

  KOREAN_COLLOQUIAL_REPAIRS.forEach(({ pattern, replacement }) => {
    normalized = normalized.replace(pattern, replacement);
  });

  return normalizeWhitespace(normalized);
};

export const isBoilerplateHallucination = (sourceText: string, translatedText: string): boolean => {
  const source = String(sourceText || '').toLowerCase();
  const translated = String(translatedText || '').toLowerCase();

  // If the source text contains Hangul (Korean), Kana (Japanese), or Han (Chinese)
  const isCjkSource = /[\uAC00-\uD7AF\u3040-\u30FF\u4E00-\u9FFF]/.test(sourceText);
  if (!isCjkSource) return false;

  // List of common boilerplate terms that are frequently hallucinated by Argos
  const boilerplateTerms = [
    'เกี่ยวกับเรา',
    'เงื่อนไขการบริการ',
    'นโยบายความเป็นส่วนตัว',
    'ข้อตกลงในการให้บริการ',
    'ผมตกลงในเงื่อนไข',
    'ฉันตกลงในเงื่อนไข',
    'ข้อมูลส่วนบุคคล'
  ];

  // If the source doesn't actually mean "about us" or "terms of service", but translation contains it
  // Common Korean words for about us / terms of service are: "회사 소개", "이용 약관", "개인정보 처리방침"
  const isActualBoilerplateSource = /회사\s*소개|이용\s*약관|개인정보|서비스\s*약관/.test(sourceText);

  if (!isActualBoilerplateSource) {
    return boilerplateTerms.some(term => translated.includes(term));
  }
  return false;
};

export const applyKoreanConversationalFallback = (
  sourceText: string,
  translatedText: string
): string | null => {
  const source = normalizeWhitespace(sourceText);
  if (!source || !KOREAN_HANGUL_REGEX.test(source)) return null;

  const compactSource = source.replace(/[\s.!?~,]/g, '');
  const matched = KOREAN_CONVERSATIONAL_FALLBACKS.find((entry) => entry.pattern.test(compactSource));
  if (!matched) return null;

  return preserveSourceTrailingPunctuation(source, matched.replacement);
};

export const getKoreanTranslationScriptStats = (text: string): {
  hangulChars: number;
  thaiChars: number;
  latinChars: number;
  letterChars: number;
  hangulRatio: number;
  thaiRatio: number;
  latinRatio: number;
} => {
  const normalized = normalizeWhitespace(text);
  const hangulChars = (normalized.match(/\p{Script=Hangul}/gu) || []).length;
  const thaiChars = (normalized.match(KOREAN_THAI_REGEX) || []).length;
  const latinChars = (normalized.match(KOREAN_LATIN_REGEX) || []).length;
  const letterChars = hangulChars + thaiChars + latinChars;
  return {
    hangulChars,
    thaiChars,
    latinChars,
    letterChars,
    hangulRatio: hangulChars / Math.max(1, letterChars),
    thaiRatio: thaiChars / Math.max(1, letterChars),
    latinRatio: latinChars / Math.max(1, letterChars),
  };
};

export const hasKoreanTranslationCarryover = (text: string): boolean => {
  const stats = getKoreanTranslationScriptStats(text);
  return stats.hangulChars > 0 && stats.thaiChars === 0;
};

export const shouldPreferKoreanPivotTranslation = (
  sourceText: string,
  directText: string,
  pivotText: string
): boolean => {
  const source = normalizeWhitespace(sourceText);
  const direct = normalizeWhitespace(directText);
  const pivot = normalizeWhitespace(pivotText);

  if (!pivot) return false;
  if (!direct) return true;

  const directStats = getKoreanTranslationScriptStats(direct);
  const pivotStats = getKoreanTranslationScriptStats(pivot);
  if (pivotStats.thaiChars === 0) return false;

  if (directStats.thaiChars === 0 && directStats.latinChars > 0) return true;
  if (pivotStats.thaiChars > directStats.thaiChars + 1) return true;
  if (pivotStats.thaiRatio >= directStats.thaiRatio + 0.04) return true;
  if (directStats.latinRatio >= 0.18 && pivotStats.latinRatio + 0.05 < directStats.latinRatio) {
    return true;
  }

  const sourceKey = buildComparisonKey(source);
  const directKey = buildComparisonKey(direct);
  const pivotKey = buildComparisonKey(pivot);
  if (sourceKey && directKey && sourceKey === directKey && pivotKey !== sourceKey) {
    return true;
  }

  return false;
};