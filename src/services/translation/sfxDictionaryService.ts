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
  fuzzyThreshold = 0.75
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

  return bestMatch ? bestMatch.target : null;
}
