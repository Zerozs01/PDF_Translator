/**
 * SFX Dictionary Service — ระบบจัดการและแปลเสียงเอฟเฟกต์ (SFX)
 *
 * รองรับ:
 *   1. คลังเสียงเอฟเฟกต์เริ่มต้น (JP/EN/KO)
 *   2. การค้นหาแบบ Exact Match และ Fuzzy Match (Levenshtein Similarity)
 *   3. การผสานคำที่ผู้ใช้เพิ่ม/แก้ไขเอง (User Dict) ผ่าน LocalStorage
 */

import { useGlossaryStore } from '../../stores/useGlossaryStore';

export interface SFXDictionaryEntry {
  source: string;
  target: string;
  notes?: string;
}

export type SFXLanguage = 'en' | 'jp' | 'ko';

export interface SFXDictionary {
  version: string;
  data: Record<SFXLanguage, SFXDictionaryEntry[]>;
}

// ── คลังคำเสียงเอฟเฟกต์เริ่มต้น (Default Dictionary) ──────────────────
export const DEFAULT_SFX_DICTIONARY: SFXDictionary = {
  version: '1.0',
  data: {
    jp: [
      { source: 'ドン', target: 'ตึง!', notes: 'เสียงกระแทกหนักๆ หรือเสียงหัวใจเต้นแรง' },
      { source: 'ガーン', target: 'ช็อก!', notes: 'เสียงตกใจ ตะลึง' },
      { source: 'ドキドキ', target: 'ตึกตัก', notes: 'เสียงหัวใจเต้นตื่นเต้น' },
      { source: 'ニコ', target: 'ยิ้ม', notes: 'เสียงหน้ายิ้มแย้ม' },
      { source: 'ハッ', target: 'เฮือก!', notes: 'เสียงสะดุ้ง ตื่นตระหนก' },
      { source: 'コソコソ', target: 'ซุบซิบ', notes: 'เสียงกระซิบกระซาบ' },
      { source: 'ザワザワ', target: 'ซู่ซ่า', notes: 'เสียงจอแจ อื้ออึง' },
      { source: 'キャー', target: 'กรี๊ด!', notes: 'เสียงกรีดร้องด้วยความตกใจหรือชื่นชม' },
      { source: 'シーン', target: 'เงียบ...', notes: 'เสียงความเงียบสงัด' },
      { source: 'ゴゴゴ', target: 'ครืนนน', notes: 'เสียงบรรยากาศกดดัน ครืนๆ' },
      { source: 'バサッ', target: 'พรึ่บ!', notes: 'เสียงขยับปีก หรือคลี่กระดาษอย่างรวดเร็ว' },
      { source: 'フッ', target: 'หึ...', notes: 'เสียงหัวเราะในลำคอเบาๆ' },
    ],
    en: [
      { source: 'CRASH', target: 'โครม!', notes: 'เสียงสิ่งของชนหรือพังทลายอย่างรุนแรง' },
      { source: 'BOOM', target: 'ตูม!', notes: 'เสียงระเบิดกระแทก' },
      { source: 'BANG', target: 'ปัง!', notes: 'เสียงปืนหรือเสียงกระแทกดัง' },
      { source: 'SLAM', target: 'ปัง!', notes: 'เสียงปิดประตูกระแทกดัง' },
      { source: 'THUD', target: 'ตุ้บ!', notes: 'เสียงของหนักตกพื้น' },
      { source: 'TAP', target: 'แปะ!', notes: 'เสียงเคาะเบาๆ' },
      { source: 'SWIPE', target: 'ฟึ่บ!', notes: 'เสียงปัดกวาดอย่างรวดเร็ว' },
      { source: 'SIGH', target: 'เฮ้อ...', notes: 'เสียงถอนหายใจ' },
      { source: 'GASP', target: 'เฮือก!', notes: 'เสียงสูดหายใจด้วยความตกใจ' },
      { source: 'SMASH', target: 'เพล้ง!', notes: 'เสียงกระจกหรือภาชนะแตกพัง' },
      { source: 'GULP', target: 'อึก...', notes: 'เสียงกลืนน้ำลายด้วยความตึงเครียด' },
      { source: 'RUMBLE', target: 'ครืนนน', notes: 'เสียงฟ้าร้องหรือพื้นสั่นสะเทือน' },
      { source: 'WHOOSH', target: 'ฟิ้ววว', notes: 'เสียงลมพัดผ่านอย่างรวดเร็ว' },
      { source: 'WHACK', target: 'ผลัวะ!', notes: 'เสียงฟาดหรือตีเข้าอย่างจัง' },
      { source: 'STARE', target: 'จ้อง...', notes: 'เสียงจ้องเขม็ง' },
      { source: 'CLICK', target: 'คลิก!', notes: 'เสียงกดสวิตช์ หรือเสียงเมาส์' },
      { source: 'SHOCK', target: 'ช็อก!', notes: 'อาการตื่นตะลึง' },
      { source: 'PANT', target: 'แฮ่ก... แฮ่ก...', notes: 'เสียงหอบเหนื่อย' },
      { source: 'Pinchy', target: 'หยิก', notes: 'เสียงหยิกหรือบีบดึง' },
      { source: 'Pinch', target: 'หยิก', notes: 'เสียงหยิกหรือบีบดึง' },
      { source: 'Smack', target: 'ตั่บ', notes: 'เสียงกระทบกัน ตั่บ' },
      { source: 'SmackV', target: 'ตั่บ', notes: 'เสียงกระทบกัน ตั่บ (OCR trailing V variant)' },
      { source: 'Smack Smack Smack', target: 'ตั่บ ตั่บ ตั่บ', notes: 'เสียงกระทบกัน ตั่บ ตั่บ ตั่บ' },
      { source: 'Smack Smack', target: 'ตั่บ ตั่บ', notes: 'เสียงกระทบกัน ตั่บ ตั่บ' },
      { source: 'Poke', target: 'กระทุ้ง', notes: 'เสียงกระทุ้งหรือจิ้ม' },
      { source: 'Badum', target: 'ตึกตัก', notes: 'เสียงหัวใจเต้น' },
      { source: 'Badumm', target: 'ตึกตัก', notes: 'เสียงหัวใจเต้น (variant)' },
      // Fwoooshh variants — ต้องใส่ครบเพื่อให้ fuzzy match จับได้ทุกรูปแบบการสะกด
      { source: 'Fwoooshh', target: 'ฟู่ววว', notes: 'เสียงลมพัดหรือพลังพวยพุ่ง' },
      { source: 'Fwoosh', target: 'ฟู่ววว', notes: 'เสียงลมพัด' },
      { source: 'Fwooosh', target: 'ฟู่ววว', notes: 'เสียงลมพัด (3o variant)' },
      { source: 'Fwooshh', target: 'ฟู่ววว', notes: 'เสียงลมพัด (2h variant)' },
      { source: 'Fwoooshhh', target: 'ฟู่ววว', notes: 'เสียงลมพัดยาว (3h variant)' },
      { source: 'Fwsshhh', target: 'ฟซซซ์ชชช', notes: 'เสียงลมผ่านหรือเสียงทะเล' },
      { source: 'Fwsshh', target: 'ฟซซซ์ชชช', notes: 'เสียงลมผ่าน (2h variant)' },
      { source: 'Fwssh', target: 'ฟซซซ์ชชช', notes: 'เสียงลมผ่าน (1h variant)' },
      { source: 'Fsssshhh', target: 'ฟซซซ์ชชช', notes: 'เสียงลมผ่านแบบลากยาวมาก' },
      { source: 'Fwsssshh', target: 'ฟซซซ์ชชช', notes: 'เสียงลมผ่าน (w-s variant)' },
      { source: 'Fwsshhh...', target: 'ฟซซซ์ชชช...', notes: 'เสียงลมผ่านยาว' },
      { source: 'Fwsssshhh', target: 'ฟซซซ์ชชช', notes: 'เสียงลมผ่านลากยาว' },
      { source: 'Phew', target: 'ฟิ้ววว', notes: 'เสียงถอนหายใจหรือโล่งอก' },
      { source: 'Phew...', target: 'ฟิ้ววว...', notes: 'เสียงถอนหายใจ (ยาว)' },
      { source: 'Gxp', target: 'บีบ', notes: 'เสียงกำหรือบีบ (Grip)' },
      { source: 'Grip', target: 'บีบ', notes: 'เสียงกำหรือบีบ' },
      // เสียงคราง/ร้องรับ — ตรงตาม Mapping Table ของผู้ใช้
      { source: 'Aan', target: 'อ่าห์...', notes: 'OCR variant ของ Anh เสียงคราง' },
      { source: 'Anh', target: 'อ่าห์...', notes: 'เสียงคราง อาห์' },
      { source: 'Haa', target: 'ฮ่า...', notes: 'เสียงหายใจขาดห้วงกระชั้น' },
      { source: 'Haa...', target: 'ฮ่า...', notes: 'เสียงหายใจขาดห้วงกระชั้น (ยาว)' },
      { source: 'Hah', target: 'ฮ่าห์!', notes: 'เสียงหลุดจังหวะพีก' },
      { source: 'Aaah', target: 'อ่าห์...', notes: 'เสียงคราง อ่าห์ ลากยาว' },
      { source: 'Aaah...', target: 'อ่าห์... อาห์...', notes: 'เสียงคราง ลากยาว ต่อเนื่อง' },
      { source: 'Ah...', target: 'อ่าห์...', notes: 'เสียงครางผ่อนคลาย' },
      { source: 'Ah', target: 'อ่าห์...', notes: 'เสียงคราง' },
      { source: 'Oon', target: 'อือออ...', notes: 'เสียงร้องครางเบาๆ' },
      { source: 'Oon...', target: 'อือออ...', notes: 'เสียงร้องคราง (variant)' },
      { source: 'Mm...', target: 'อื้ม...', notes: 'เสียงครางในลำคอออดอ้อน' },
      { source: 'Mmm', target: 'อื้ม...', notes: 'เสียงคราง in ลำคอ' },
      { source: 'Mm', target: 'อื้ม...', notes: 'เสียงครางในลำคอ (สั้น)' },
      { source: 'Nnh...', target: 'อื้อ...', notes: 'เสียงครางกลั้นสะท้าน' },
      { source: 'Nnh', target: 'อื้อ...', notes: 'เสียงครางกลั้น' },
      { source: 'Ngh', target: 'อึก...', notes: 'เสียงครางสั่นสะท้านอัดอั้น' },
      { source: 'Ngh...', target: 'อึก...', notes: 'เสียงครางกลั้นสั่นสะท้าน' },
      { source: 'Nn...', target: 'อื้อ...', notes: 'เสียงครางกลั้น (nn variant)' },
      { source: 'Oh!', target: 'อ๊าห์!', notes: 'เสียงอุทานตกใจ/ตื่นเต้น' },
      { source: 'Ooh', target: 'โอ้...', notes: 'เสียงอุทานพึงพอใจ' },
      { source: 'Oh', target: 'โอ้...', notes: 'เสียงอุทาน' },
      { source: 'Shaking', target: 'เขย่า', notes: 'อาการหรือเสียงสั่นสะเทือน/เขย่า' },
      { source: 'SO SO FTYETFIRM', target: 'นุ่มมาก...แต่ก็แน่นกระชับ', notes: 'SO SOFT.. YET FIRM' },
      { source: 'SO SOFT.. YET FIRM', target: 'นุ่มมาก...แต่ก็แน่นกระชับ', notes: 'คำบรรยายความรู้สึก' },
      { source: 'FTTITATERASE', target: 'นุ่มมาก...แต่ก็แน่นกระชับ', notes: 'SO SOFT YET FIRM OCR variant' },
      { source: 'Smacky', target: 'ตั่บ', notes: 'เสียงกระทบกัน ตั่บ (Smack variant)' },
      { source: 'Smacke', target: 'ตั่บ', notes: 'เสียงกระทบกัน ตั่บ (Smack OCR variant)' },
      { source: 'Shmacki Patv', target: 'ปั๊ก แต๊บ', notes: 'เสียงเอวกระแทกร่องสะกดเพี้ยน' },
      { source: 'Shmack Pat', target: 'ปั๊ก แต๊บ', notes: 'เสียงเอวกระแทกร่อง' },
      { source: 'EJACULATED', target: 'หลั่งน้ำอสุจิ', notes: 'เสียงอุทาน/กริยาอนาจาร' },
      { source: 'INTO...', target: 'เข้าไปข้างใน...', notes: 'คำบรรยายทิศทาง' },
      { source: 'Gloop', target: 'กลูป', notes: 'เสียงน้ำหนืด/ของเหลวข้น' },
      { source: 'Twitches', target: 'กระตุก', notes: 'เสียงหรืออาการกระตุก' },
      { source: 'Twitchesd', target: 'กระตุก', notes: 'เสียงหรืออาการกระตุก (OCR variant)' },
      { source: 'LIKE A TOY', target: 'เหมือนของเล่น', notes: 'ประโยคเปรียบเทียบ' },
      { source: 'LikBatoyd', target: 'เหมือนของเล่น', notes: 'LIKE A TOY OCR variant' },
      { source: 'FUCK TOY', target: 'ของเล่นทางเพศ', notes: 'คำสังขม แปลตรงตามบริบท' },
      { source: 'LOL', target: 'ฮ่าๆ', notes: 'เสียงขำ Laughing Out Loud' },
      { source: 'AHH ITS COMING', target: 'อ๊าห์... มันกำลังจะมาแล้ว... ♥', notes: 'AHH IT’S COMING' },
      { source: "AHH IT'S COMING", target: 'อ๊าห์... มันกำลังจะมาแล้ว... ♥', notes: 'เสียงร้อง/อุทานทางเพศ' },
      { source: 'AHH ITS COMINGO', target: 'อ๊าห์... มันกำลังจะมาแล้ว... ♥', notes: 'OCR trailing O variant' },
      { source: 'CUMING CUMMING CUMMING', target: 'จะเสร็จ...จ-จะเสร็จ...จะแตกแล้ว... ♥', notes: 'เสียงสมมุติผู้ใหญ่' },
      { source: 'CUMMINNGGG', target: 'แตกกออกมาแล้ววว...♥', notes: 'เสียงสมมุติลากเสียงยาว' },
      { source: 'CUMMINNGGGO', target: 'แตกกออกมาแล้ววว...♥', notes: 'OCR trailing O variant' }

    ],
    ko: [
      { source: '쿵', target: 'ตึง!', notes: 'เสียงของหนักกระแทกพื้น' },
      { source: '두근두근', target: 'ตึกตัก', notes: 'เสียงหัวใจเต้นตื่นเต้น' },
      { source: '하하', target: 'ฮ่าๆ', notes: 'เสียงหัวเราะอย่างร่าเริง' },
      { source: '헉', target: 'เฮือก!', notes: 'เสียงสะดุ้งหรือตกใจ' },
      { source: '슥', target: 'ฟึ่บ!', notes: 'เสียงเฉียดผ่านเบาๆ' },
      { source: '쾅', target: 'ปัง!', notes: 'เสียงกระแทกดังรุนแรง' },
    ],
  },
};

const USER_DICT_STORAGE_KEY = 'pdf_translator_user_sfx_dict';

// ── Helper Algorithms ──────────────────────────────────────────────
/** คำนวณ Levenshtein Distance เพื่อหาจำนวนครั้งในการแก้ไขตัวหนังสือ */
export function getLevenshteinDistance(a: string, b: string): number {
  const tmp: number[][] = [];
  for (let i = 0; i <= a.length; i++) tmp[i] = [i];
  for (let j = 0; j <= b.length; j++) tmp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      tmp[i][j] = Math.min(
        tmp[i - 1][j] + 1,
        tmp[i][j - 1] + 1,
        tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return tmp[a.length][b.length];
}

/** คำนวณหาความคล้ายคลึงกัน (Similarity score: 0.0 - 1.0) */
export function getStringSimilarity(a: string, b: string): number {
  const normA = a.trim().toLowerCase();
  const normB = b.trim().toLowerCase();
  if (normA === normB) return 1.0;
  
  const maxLen = Math.max(normA.length, normB.length);
  if (maxLen === 0) return 1.0;
  
  const distance = getLevenshteinDistance(normA, normB);
  return (maxLen - distance) / maxLen;
}

// ── Dictionary Actions ─────────────────────────────────────────────
/** ดึงข้อมูล User Dictionary จาก LocalStorage */
export function getUserDictionary(): Record<SFXLanguage, SFXDictionaryEntry[]> {
  try {
    const raw = localStorage.getItem(USER_DICT_STORAGE_KEY);
    if (!raw) return { en: [], jp: [], ko: [] };
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to parse User SFX Dictionary from localStorage', e);
    return { en: [], jp: [], ko: [] };
  }
}

/** บันทึกข้อมูล User Dictionary ลงใน LocalStorage */
export function saveUserDictionary(userDict: Record<SFXLanguage, SFXDictionaryEntry[]>): void {
  try {
    localStorage.setItem(USER_DICT_STORAGE_KEY, JSON.stringify(userDict));
  } catch (e) {
    console.error('Failed to save User SFX Dictionary to localStorage', e);
  }
}

/** ผสานคลังคำเริ่มต้นร่วมกับคลังคำของผู้ใช้ */
export function getMergedDictionary(): SFXDictionary {
  const userDict = getUserDictionary();
  
  // Fetch custom SFX entries from useGlossaryStore
  let customSfxEntries: SFXDictionaryEntry[] = [];
  try {
    const storeEntries = useGlossaryStore.getState().entries;
    customSfxEntries = storeEntries
      .filter((e) => e.isActive && e.type === 'SFX' && e.sourceText.trim())
      .map((e) => ({
        source: e.sourceText.trim(),
        target: e.targetText.trim(),
        notes: 'คำแปลจากพจนานุกรมส่วนตัว (Custom Glossary)',
      }));
  } catch (err) {
    console.error('[sfxDictionaryService] Failed to load custom SFX from useGlossaryStore:', err);
  }
  
  const merged: SFXDictionary = {
    version: '1.0',
    data: {
      en: [...customSfxEntries, ...userDict.en, ...DEFAULT_SFX_DICTIONARY.data.en],
      jp: [...customSfxEntries, ...userDict.jp, ...DEFAULT_SFX_DICTIONARY.data.jp],
      ko: [...customSfxEntries, ...userDict.ko, ...DEFAULT_SFX_DICTIONARY.data.ko],
    },
  };
  
  // ลบตัวซ้ำ (กรณีผู้ใช้แก้คำทับคำเดิม) โดยอิงตาม source
  const deduplicate = (entries: SFXDictionaryEntry[]) => {
    const seen = new Set<string>();
    return entries.filter(e => {
      const key = e.source.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  merged.data.en = deduplicate(merged.data.en);
  merged.data.jp = deduplicate(merged.data.jp);
  merged.data.ko = deduplicate(merged.data.ko);

  return merged;
}

/**
 * แปลเสียงเอฟเฟกต์ (SFX) จากพจนานุกรม
 * ค้นหาแบบ Exact match ก่อน หากไม่พบจะค้นหาแบบ Fuzzy match ภายใต้เกณฑ์ที่กำหนด
 */
export function translateSFX(
  text: string,
  lang: SFXLanguage,
  fuzzyThreshold = 0.75,
  _isEnFallback = false
): string | null {
  const dict = getMergedDictionary();
  const entries = dict.data[lang] || [];
  const normalizedInput = text.trim().toLowerCase();

  if (!normalizedInput) return null;

  // 1st Phase: Exact match
  const exact = entries.find(e => e.source.toLowerCase() === normalizedInput);
  if (exact) return exact.target;

  // 2nd Phase: Fuzzy match
  let bestMatch: SFXDictionaryEntry | null = null;
  let highestScore = 0;

  // Protect short sound effects from false positives (e.g. ZOOM vs BOOM has 0.75 similarity, but different meaning)
  const effectiveThreshold = normalizedInput.length <= 4
    ? Math.max(fuzzyThreshold, 0.85)
    : fuzzyThreshold;

  for (const entry of entries) {
    const score = getStringSimilarity(entry.source, normalizedInput);
    if (score > highestScore && score >= effectiveThreshold) {
      highestScore = score;
      bestMatch = entry;
    }
  }

  if (bestMatch) return bestMatch.target;

  // 3rd Phase: English Fallback
  // หากไม่พบในภาษาหลัก และข้อความเป็นตัวอักษรละติน ให้ค้นหาในพจนานุกรมภาษาอังกฤษแทน
  // (เช่น มังงะญี่ปุ่น/เกาหลีแต่มีเสียงเอฟเฟกต์ภาษาอังกฤษ เช่น Smack, Boom, Shaking)
  if (lang !== 'en' && !_isEnFallback && /[a-zA-Z]/.test(text)) {
    return translateSFX(text, 'en', fuzzyThreshold, true);
  }

  return null;
}
