import { TranslatableItem, TranslationResult, TranslationEngine } from '../../types/translation';
import { translateSFX, SFXLanguage } from './sfxDictionaryService';
import { dbService } from '../dbService';
import { hasKoreanTranslationCarryover } from './koreanTranslationPolicy';

/**
 * Argos Offline Engine Implementation
 * แปลภาษาออฟไลน์ผ่าน Argos Translator โดยข้าม SFX และใช้วิธีดัชนี Index-based Mapping
 */
export class ArgosTranslationEngine implements TranslationEngine {
  readonly id = 'argos';
  readonly name = 'Argos Offline Translator';

  async translate(
    items: TranslatableItem[],
    options: {
      sourceLanguage: string;
      targetLanguage: string;
      translationMode: string;
      translateBatchOffline: (texts: string[], type: string, mode: any, src: string, tgt: string) => Promise<string[]>;
    }
  ): Promise<TranslationResult[]> {
    // 1. แยกกลุ่มเพื่อจัดการ: Argos จะ bypass กลุ่ม 'sfx' ไปยัง Local Dictionary
    const nonSfxItems = items.filter((item) => item.groupType !== 'sfx');
    const sfxItems = items.filter((item) => item.groupType === 'sfx');

    const results: TranslationResult[] = [];

    // 2. ประมวลผลคำแปลสำหรับ Sfx Items ด้วย Local Dictionary
    const sfxLang = (options.sourceLanguage.substring(0, 2).toLowerCase()) as SFXLanguage;
    for (const item of sfxItems) {
      const sfxTranslated = translateSFX(item.text, sfxLang);
      if (sfxTranslated) {
        results.push({
          id: item.id,
          translatedText: sfxTranslated,
          success: true,
          engineUsed: 'sfx-dict',
        });
      } else {
        // หากค้นหาในพจนานุกรมไม่เจอ ให้ส่งคำเดิมกลับคืนเพื่อให้ระบบสามารถ fallback หรือส่งไปแปลออฟไลน์ได้ (ในกรณีที่อยากลอง)
        // หรือให้ Argos รันแปลทับเป็นภาษาไทยแบบดั้งเดิม (แต่ในสเปกแจ้งให้ Bypass Argos ทิ้งไป 100% สำหรับ SFX และ lookup local dict)
        // ดังนั้นหากไม่พบ ให้ส่งข้อความเดิมกลับไป
        results.push({
          id: item.id,
          translatedText: item.text,
          success: true,
          engineUsed: 'sfx-dict-fallback',
        });
      }
    }

    if (nonSfxItems.length === 0) {
      return results;
    }

    try {
      // 3. Pre-processing: คัดแยกข้อความดิบ และจดจำ Index ของแต่ละชิ้นงาน
      const textsToTranslate = nonSfxItems.map((item) => item.text);

      // 4. สั่งแปล Batch ผ่านตัวเชื่อม ipcRenderer ของโปรแกรมหลัก
      const translatedTexts = await options.translateBatchOffline(
        textsToTranslate,
        'text',
        options.translationMode,
        options.sourceLanguage,
        options.targetLanguage
      );

      // 5. Post-processing: Remap ผลลัพธ์และคืนกลับไปตามลำดับ ID
      nonSfxItems.forEach((item, index) => {
        results.push({
          id: item.id,
          translatedText: translatedTexts[index] || item.text,
          success: true,
          engineUsed: this.id,
        });
      });
    } catch (error: any) {
      console.error('[ArgosTranslationEngine] Offline translation failed:', error);
      // แนบประวัติการล้มเหลวให้กับกลุ่ม Balloon / Narration
      nonSfxItems.forEach((item) => {
        results.push({
          id: item.id,
          translatedText: item.text,
          success: false,
          error: error.message || 'Unknown offline translation error',
          engineUsed: this.id,
        });
      });
    }

    return results;
  }
}

/**
 * Gemini Online Engine Implementation
 * แปลภาษาออนไลน์ผ่าน Gemini API โดยรองรับระบบรักษาบริบทและการแปล SFX แบบ Local Dictionary
 */
export class GeminiTranslationEngine implements TranslationEngine {
  readonly id = 'gemini';
  readonly name = 'Gemini Online Translator';

  async translate(
    items: TranslatableItem[],
    options: {
      sourceLanguage: string;
      targetLanguage: string;
      translationMode: string;
      translateBatchOffline: (texts: string[], type: string, mode: any, src: string, tgt: string) => Promise<string[]>;
      translateBatchGemini?: (texts: string[], type: string, mode: any, src: string, tgt: string) => Promise<string[]>;
    }
  ): Promise<TranslationResult[]> {
    if (!options.translateBatchGemini) {
      throw new Error('Gemini translation batch function is required.');
    }

    // 1. แยกกลุ่มเพื่อจัดการ: ใช้ Local Dict แปล SFX เป็นด่านแรก
    const nonSfxItems = items.filter((item) => item.groupType !== 'sfx');
    const sfxItems = items.filter((item) => item.groupType === 'sfx');

    const results: TranslationResult[] = [];
    const sfxToTranslateViaLLM: TranslatableItem[] = [];

    // ดักแปล SFX ด้วย Local Dictionary ก่อน
    const sfxLang = (options.sourceLanguage.substring(0, 2).toLowerCase()) as SFXLanguage;
    for (const item of sfxItems) {
      const sfxTranslated = translateSFX(item.text, sfxLang);
      if (sfxTranslated) {
        results.push({
          id: item.id,
          translatedText: sfxTranslated,
          success: true,
          engineUsed: 'sfx-dict',
        });
      } else {
        // หากไม่เจอใน Local Dict ส่งไปแปลใน LLM ในฐานะ Context ต่อไป
        sfxToTranslateViaLLM.push(item);
      }
    }

    // รวมกลุ่มทั้งหมดที่จะส่งแปลผ่าน LLM
    const llmTargetItems = [...nonSfxItems, ...sfxToTranslateViaLLM];
    if (llmTargetItems.length === 0) {
      return results;
    }

    try {
      // สำหรับ Gemini: เราสามารถสร้าง XML Tagging หรือแปลแบบ Batch ปกติ
      // เพื่อให้เข้ากันได้กับโครงสร้างเดิมและยืดหยุ่นที่สุด เราจะส่งแปลแบบทีละประโยค (Batch)
      // หรือหากต้องการความต่อเนื่องของ Context สามารถแปลงเป็น Single String XML ได้ตามคู่มือ:
      // "<balloon id='1'>Hey</balloon><sfx id='2'>Bang</sfx>"
      // ในที่นี้ เพื่อความสเถียรและประยุกต์ใช้กับฟังก์ชัน translateBatchGemini ที่ส่ง Array
      // เราสามารถห่อหุ้ม XML แยก หรือแปลแบบส่ง Batch ไปโดยตรง
      
      const inputs = llmTargetItems.map((item) => {
        if (item.groupType === 'sfx') {
          return `<sfx id="${item.id}">${item.text}</sfx>`;
        } else if (item.groupType === 'narration') {
          return `<narration id="${item.id}">${item.text}</narration>`;
        } else {
          return `<balloon id="${item.id}">${item.text}</balloon>`;
        }
      });

      const translatedOutputs = await options.translateBatchGemini(
        inputs,
        'text',
        options.translationMode,
        options.sourceLanguage,
        options.targetLanguage
      );

      llmTargetItems.forEach((item, index) => {
        const rawOutput = translatedOutputs[index] || item.text;
        // ล้าง XML tag ออกจากผลลัพธ์ที่ตอบกลับมา (เช่น <balloon id="1">คำแปล</balloon> -> คำแปล)
        const cleanedText = rawOutput
          .replace(/<balloon[^>]*>([\s\S]*?)<\/balloon>/gi, '$1')
          .replace(/<sfx[^>]*>([\s\S]*?)<\/sfx>/gi, '$1')
          .replace(/<narration[^>]*>([\s\S]*?)<\/narration>/gi, '$1')
          .trim();

        results.push({
          id: item.id,
          translatedText: cleanedText || item.text,
          success: true,
          engineUsed: this.id,
        });
      });
    } catch (error: any) {
      console.error('[GeminiTranslationEngine] Gemini translation failed:', error);
      llmTargetItems.forEach((item) => {
        results.push({
          id: item.id,
          translatedText: item.text,
          success: false,
          error: error.message || 'Unknown online translation error',
          engineUsed: this.id,
        });
      });
    }

    return results;
  }
}

/**
 * TranslationCoordinator
 * ทำหน้าที่เป็นตัวประสานงานการแปล คัดแยกประเภท และรัน Engine ที่ถูกลงทะเบียนไว้
 */
export class TranslationCoordinator {
  private engines: Map<string, TranslationEngine> = new Map();

  constructor() {
    // ลงทะเบียน Engine ทั้งหมด
    this.engines.set('argos', new ArgosTranslationEngine());
    this.engines.set('gemini', new GeminiTranslationEngine());
  }

  registerEngine(engine: TranslationEngine) {
    this.engines.set(engine.id, engine);
  }

  getEngine(engineId: string): TranslationEngine | undefined {
    return this.engines.get(engineId);
  }

  async runTranslation(
    engineId: string,
    items: TranslatableItem[],
    options: {
      sourceLanguage: string;
      targetLanguage: string;
      translationMode: string;
      translateBatchOffline: (texts: string[], type: string, mode: any, src: string, tgt: string) => Promise<string[]>;
      translateBatchGemini?: (texts: string[], type: string, mode: any, src: string, tgt: string) => Promise<string[]>;
    }
  ): Promise<TranslationResult[]> {
    const engine = this.engines.get(engineId);
    if (!engine) {
      throw new Error(`Engine with ID "${engineId}" not registered.`);
    }

    // 1. แยกแยะกรองข้อความขยะ/ว่างออกไปก่อนแปล
    const activeItems = items.filter((item) => item.text.trim().length > 0);
    const emptyItems = items.filter((item) => item.text.trim().length === 0);

    const results: TranslationResult[] = [];

    // 1.5 ลองดึงข้อมูลคำแปลจากระบบแคชประโยค (Sentence-level cache) ข้ามการประมวลผลเอนจินหลัก
    const cachedLookup = await Promise.all(
      activeItems.map(async (item) => {
        try {
          const cachedText = await dbService.getSentenceTranslation(
            item.text,
            options.sourceLanguage,
            options.targetLanguage,
            engineId,
            options.translationMode
          );
          return { item, cachedText };
        } catch (error) {
          console.warn('[TranslationCoordinator] Cache lookup error for text:', item.text, error);
          return { item, cachedText: null };
        }
      })
    );

    const cachedItems: { item: TranslatableItem; cachedText: string }[] = [];
    const uncachedItems: TranslatableItem[] = [];

    // Detect cached translations that were never actually translated or are low quality.
    // Covers 3 failure modes:
    // 1. Still English/Latin with no Thai chars (Argos returned source unchanged)
    // 2. Still contains source-script characters (e.g. Hangul in result when target is Thai)
    // 3. Result is extremely short compared to source — Argos collapsed long text to e.g. ". . ."
    const isCachedUntranslated = (cachedText: string, sourceText: string, targetLang: string, sourceLang: string): boolean => {
      if (targetLang !== 'th') return false;
      const trimmed = cachedText.trim();
      if (!trimmed) return true; // Empty is always bad

      const hasThaiChars = /[\u0E00-\u0E7F]/.test(trimmed);
      const hasLatinLetters = /[a-zA-Z]/.test(trimmed);

      // Case 1: Still English → was never translated
      if (hasLatinLetters && !hasThaiChars) return true;

      // Case 2: Still contains source-script characters (Hangul, Kana, CJK) in the result
      const sourceHasHangul = /[\uAC00-\uD7AF]/.test(sourceText);
      if (hasKoreanTranslationCarryover(trimmed) && (sourceLang === 'ko' || sourceHasHangul)) return true;
      const hasKana = /[\u3040-\u30FF]/.test(trimmed);
      const sourceHasKana = /[\u3040-\u30FF]/.test(sourceText);
      if (hasKana && (sourceLang === 'ja' || sourceHasKana)) return true;
      const hasHan = /[\u3400-\u4DBF\u4E00-\u9FFF]/.test(trimmed);
      const sourceHasHan = /[\u3400-\u4DBF\u4E00-\u9FFF]/.test(sourceText);
      if (hasHan && sourceHasHan) return true;

      // Case 3: Collapsed result — result is way shorter than source for non-trivial inputs
      // e.g. source="출력해서집에붙여놓을라고하는데 ㅋㅋ" → result=". . ." is clearly garbage
      const sourceLen = sourceText.trim().length;
      const resultLen = trimmed.length;
      if (sourceLen > 15 && resultLen < 4) return true; // collapsed to almost nothing
      const resultHasOnlyDots = /^[\s.·•\-_]+$/.test(trimmed);
      if (resultHasOnlyDots && sourceLen > 5) return true;

      return false;
    };

    for (const res of cachedLookup) {
      if (res.cachedText !== null && !isCachedUntranslated(res.cachedText, res.item.text, options.targetLanguage, options.sourceLanguage)) {
        cachedItems.push({ item: res.item, cachedText: res.cachedText });
      } else {
        // Cache miss OR cached result is low quality → re-translate with engine
        uncachedItems.push(res.item);
      }
    }

    // 2. รันการแปลส่วนที่เหลือที่ไม่มีในแคชผ่าน Engine ที่เลือก
    let engineResults: TranslationResult[] = [];
    if (uncachedItems.length > 0) {
      engineResults = await engine.translate(uncachedItems, options);

      // บันทึกคำแปลที่ได้ลงในระบบแคชประโยคเพื่อใช้สำหรับครั้งต่อไปแบบคู่ขนาน
      // Guard: ตรวจสอบคุณภาพผลแปลก่อนบันทึก เพื่อป้องกันการแคชผลแปลมั่วจาก Argos
      const savePromises = engineResults.map(async (res) => {
        if (res.success && res.translatedText) {
          const matchedItem = uncachedItems.find((ui) => ui.id === res.id);
          if (matchedItem) {
            // Skip saving if the result is detected as low quality (same guard as cache-read)
            const wouldBeUntranslated = isCachedUntranslated(
              res.translatedText,
              matchedItem.text,
              options.targetLanguage,
              options.sourceLanguage
            );
            if (wouldBeUntranslated) {
              console.warn('[TranslationCoordinator] Skipping cache save for low-quality translation:', matchedItem.text, '→', res.translatedText);
              return;
            }
            try {
              await dbService.saveSentenceTranslation(
                matchedItem.text,
                options.sourceLanguage,
                options.targetLanguage,
                engineId,
                options.translationMode,
                res.translatedText
              );
            } catch (saveError) {
              console.warn('[TranslationCoordinator] Failed to save sentence to cache:', matchedItem.text, saveError);
            }
          }
        }
      });
      // รันบันทึกแคช
      await Promise.all(savePromises);
    }

    // 2.5 รวมผลงานจากแคชประโยคกลับเข้ามาในรูปแบบ TranslationResult
    const cachedResults: TranslationResult[] = cachedItems.map((c) => ({
      id: c.item.id,
      translatedText: c.cachedText,
      success: true,
      engineUsed: `${engineId}-sentence-cache`,
    }));

    // รวมผลลัพธ์ทั้งหมด
    results.push(...engineResults, ...cachedResults);

    // 3. รวมผลลัพธ์ของข้อความว่างกลับเข้ามา
    emptyItems.forEach((item) => {
      results.push({
        id: item.id,
        translatedText: '',
        success: true,
        engineUsed: 'empty',
      });
    });

    // จัดเรียงผลลัพธ์กลับตามลำดับ index ของข้อมูลที่ถูกส่งเข้ามาดั้งเดิม เพื่อไม่ให้ overlay สลับตำแหน่ง
    const itemsOrderMap = new Map(items.map((item, idx) => [item.id, idx]));
    results.sort((a, b) => {
      const idxA = itemsOrderMap.get(a.id) ?? 0;
      const idxB = itemsOrderMap.get(b.id) ?? 0;
      return idxA - idxB;
    });

    return results;
  }
}

// สร้าง instance เดี่ยวสำหรับใช้ทั้งระบบ (Singleton)
export const translationCoordinator = new TranslationCoordinator();
