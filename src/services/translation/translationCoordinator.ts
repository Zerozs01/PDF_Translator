import { TranslatableItem, TranslationResult, TranslationEngine } from '../../types/translation';
import { translateSFX, SFXLanguage } from './sfxDictionaryService';
import { dbService } from '../dbService';
import { hasKoreanTranslationCarryover } from './koreanTranslationPolicy';
import { lookupShortPhraseTh } from './offlineTranslationService';

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
    const nonSfxItems: TranslatableItem[] = [];
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
        const shortPhraseMatch = lookupShortPhraseTh(item.text);
        if (shortPhraseMatch) {
          results.push({
            id: item.id,
            translatedText: shortPhraseMatch,
            success: true,
            engineUsed: 'short-phrase-dict',
          });
        } else {
          nonSfxItems.push(item);
        }
      }
    }

    items.forEach((item) => {
      if (item.groupType !== 'sfx') {
        nonSfxItems.push(item);
      }
    });

    if (nonSfxItems.length === 0) {
      return results;
    }

    try {
      // ทำไมถึงเขียนแบบนี้: ไม่ Deduplicate ก่อนส่งแปล เพราะคำที่ซ้ำในหลายบอลลูนจำเป็นต้องได้รับบริบทแยกกันตาม Context
      // การกรองคำซ้ำออกแล้วเอาคำแปลไปแปะทำให้ตัว engine ไม่ได้เห็น Context ที่สมบูรณ์ ทำให้คำแปลทื่อหรือผิดความหมาย
      const allTexts = nonSfxItems.map((item) => item.text);

      // 4. สั่งแปล Batch ด้วยข้อความทั้งหมด (context-aware)
      const translatedTexts = await options.translateBatchOffline(
        allTexts,
        'text',
        options.translationMode,
        options.sourceLanguage,
        options.targetLanguage
      );

      // 5. Post-processing: คืนค่าไปตามลำดับ ID ตามลำดับของ items
      nonSfxItems.forEach((item, index) => {
        const translatedText = translatedTexts[index] || item.text;
        results.push({
          id: item.id,
          translatedText,
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
 * M2M100 Offline Engine Implementation
 * แปลภาษาออฟไลน์ผ่าน Meta M2M100 โดยข้าม SFX และใช้วิธีดัชนี Index-based Mapping
 */
export class M2M100TranslationEngine implements TranslationEngine {
  readonly id = 'm2m100';
  readonly name = 'M2M100 Offline Translator';

  async translate(
    items: TranslatableItem[],
    options: {
      sourceLanguage: string;
      targetLanguage: string;
      translationMode: string;
      translateBatchOffline: (texts: string[], type: string, mode: any, src: string, tgt: string, engine?: string) => Promise<string[]>;
    }
  ): Promise<TranslationResult[]> {
    const nonSfxItems: TranslatableItem[] = [];
    const sfxItems = items.filter((item) => item.groupType === 'sfx');

    const results: TranslationResult[] = [];

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
        const shortPhraseMatch = lookupShortPhraseTh(item.text);
        if (shortPhraseMatch) {
          results.push({
            id: item.id,
            translatedText: shortPhraseMatch,
            success: true,
            engineUsed: 'short-phrase-dict',
          });
        } else {
          nonSfxItems.push(item);
        }
      }
    }

    items.forEach((item) => {
      if (item.groupType !== 'sfx') {
        nonSfxItems.push(item);
      }
    });

    if (nonSfxItems.length === 0) {
      return results;
    }

    try {
      // ทำไมถึงเขียนแบบนี้: ไม่ Deduplicate ก่อนส่งแปล เพราะคำที่ซ้ำในหลายบอลลูนจำเป็นต้องได้รับบริบทแยกกันตาม Context
      // การกรองคำซ้ำออกแล้วเอาคำแปลไปแปะทำให้ตัว engine ไม่ได้เห็น Context ที่สมบูรณ์ ทำให้คำแปลทื่อหรือผิดความหมาย
      const allTexts = nonSfxItems.map((item) => item.text);

      const translatedTexts = await options.translateBatchOffline(
        allTexts,
        'text',
        options.translationMode,
        options.sourceLanguage,
        options.targetLanguage,
        'm2m100'
      );

      nonSfxItems.forEach((item, index) => {
        const translatedText = translatedTexts[index] || item.text;
        results.push({
          id: item.id,
          translatedText,
          success: true,
          engineUsed: this.id,
        });
      });
    } catch (error: any) {
      console.error('[M2M100TranslationEngine] Offline translation failed:', error);
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
        const cleanedText = rawOutput
          .replace(/<balloon[^>]*>([\s\S]*?)<\/balloon>/gi, '$1')
          .replace(/<sfx[^>]*>([\s\S]*?)<\/sfx>/gi, '$1')
          .replace(/<narration[^>]*>([\s\S]*?)<\/narration>/gi, '$1')
          .trim();

        const sanitizedText = sanitizeTranslationResult(cleanedText);

        results.push({
          id: item.id,
          translatedText: sanitizedText || item.text,
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
  // LRU cache key: `${sourceLanguage}:${targetLanguage}:${engineId}:${translationMode}:${sourceText}`
  private memoryCache = new Map<string, string>();
  private readonly maxCacheSize = 1000;

  constructor() {
    // ลงทะเบียน Engine ทั้งหมด
    this.engines.set('argos', new ArgosTranslationEngine());
    this.engines.set('m2m100', new M2M100TranslationEngine());
    this.engines.set('gemini', new GeminiTranslationEngine());
  }

  registerEngine(engine: TranslationEngine) {
    this.engines.set(engine.id, engine);
  }

  clearMemoryCache(): void {
    this.memoryCache.clear();
  }

  getEngine(engineId: string): TranslationEngine | undefined {
    return this.engines.get(engineId);
  }

  async translateGroup(
    engineId: string,
    items: TranslatableItem[],
    options: {
      sourceLanguage: string;
      targetLanguage: string;
      translationMode: string;
      translateBatchOffline: (texts: string[], type: string, mode: any, src: string, tgt: string, engine?: string) => Promise<string[]>;
      translateBatchGemini?: (texts: string[], type: string, mode: any, src: string, tgt: string) => Promise<string[]>;
    }
  ): Promise<TranslationResult[]> {
    const engine = this.engines.get(engineId);
    if (!engine) {
      throw new Error(`Engine with ID "${engineId}" not registered.`);
    }

    const activeItems = items.filter((item) => item.text.trim().length > 0);
    const emptyItems = items.filter((item) => item.text.trim().length === 0);

    const results: TranslationResult[] = [];
    const dbQueryItems: TranslatableItem[] = [];
    const directResults = new Map<string, string | null>();

    for (const item of activeItems) {
      if (item.groupType === 'sfx') {
        directResults.set(item.id, null);
        continue;
      }
      
      if (options.targetLanguage === 'th') {
        const directDictTranslation = lookupShortPhraseTh(item.text);
        if (directDictTranslation) {
          console.log(`[TranslationCoordinator] Direct dictionary hit for: "${item.text}" -> "${directDictTranslation}"`);
          directResults.set(item.id, directDictTranslation);
          continue;
        }
      }

      const cacheKey = `${options.sourceLanguage}:${options.targetLanguage}:${engineId}:${options.translationMode}:${item.text}`;
      if (this.memoryCache.has(cacheKey)) {
        const cachedVal = this.memoryCache.get(cacheKey)!;
        this.memoryCache.delete(cacheKey);
        this.memoryCache.set(cacheKey, cachedVal);
        directResults.set(item.id, cachedVal);
        continue;
      }
      
      dbQueryItems.push(item);
    }

    let batchCacheResults: Record<string, string> = {};
    if (dbQueryItems.length > 0) {
      const sourceTexts = dbQueryItems.map(item => item.text);
      try {
        batchCacheResults = await dbService.getSentenceTranslationBatch(
          sourceTexts,
          options.sourceLanguage,
          options.targetLanguage,
          engineId,
          options.translationMode
        );

        for (const [srcText, transText] of Object.entries(batchCacheResults)) {
          if (transText) {
            const cacheKey = `${options.sourceLanguage}:${options.targetLanguage}:${engineId}:${options.translationMode}:${srcText}`;
            this.memoryCache.delete(cacheKey);
            this.memoryCache.set(cacheKey, transText);
          }
        }
        
        while (this.memoryCache.size > this.maxCacheSize) {
          const firstKey = this.memoryCache.keys().next().value;
          if (firstKey !== undefined) {
            this.memoryCache.delete(firstKey);
          }
        }
      } catch (error) {
        console.warn('[TranslationCoordinator] Batch cache lookup error:', error);
      }
    }

    const cachedLookup = activeItems.map((item) => {
      if (directResults.has(item.id)) {
        return { item, cachedText: directResults.get(item.id) || null };
      }
      const cachedText = batchCacheResults[item.text] || null;
      return { item, cachedText };
    });

    const cachedItems: { item: TranslatableItem; cachedText: string }[] = [];
    const uncachedItems: TranslatableItem[] = [];

    const isCachedUntranslated = (cachedText: string, sourceText: string, targetLang: string, sourceLang: string): boolean => {
      if (targetLang !== 'th') return false;
      const trimmed = cachedText.trim();
      if (!trimmed) return true;

      const hasThaiChars = /[\u0E00-\u0E7F]/.test(trimmed);
      const hasLatinLetters = /[a-zA-Z]/.test(trimmed);

      if (hasLatinLetters && !hasThaiChars) return true;

      const normSource = String(sourceLang || '').toLowerCase();
      if ((normSource === 'es' || normSource === 'spa') && hasLatinLetters && !hasThaiChars) {
        const lenDelta = Math.abs(trimmed.length - sourceText.length) / Math.max(1, sourceText.length);
        if (lenDelta < 0.20 && trimmed.toLowerCase() === sourceText.toLowerCase().trim()) {
          return true;
        }
      }

      const hasCjkResidual = /[\uAC00-\uD7A3\u3040-\u30FF\u4E00-\u9FFF]/.test(trimmed);
      if (hasCjkResidual) return true;

      const sourceHasHangul = /[\uAC00-\uD7AF]/.test(sourceText);
      if (hasKoreanTranslationCarryover(trimmed) && (normSource === 'ko' || normSource === 'kor' || sourceHasHangul)) return true;
      const hasKana = /[\u3040-\u30FF]/.test(trimmed);
      const sourceHasKana = /[\u3040-\u30FF]/.test(sourceText);
      if (hasKana && (normSource === 'ja' || normSource === 'jpn' || sourceHasKana)) return true;
      const hasHan = /[\u3400-\u4DBF\u4E00-\u9FFF]/.test(trimmed);
      const sourceHasHan = /[\u3400-\u4DBF\u4E00-\u9FFF]/.test(sourceText);
      if (hasHan && sourceHasHan) return true;

      const sourceLen = sourceText.trim().length;
      const resultLen = trimmed.length;
      if (sourceLen > 15 && resultLen < 4) return true;
      const resultHasOnlyDots = /^[\s.·•\-_]+$/.test(trimmed);
      if (resultHasOnlyDots && sourceLen > 5) return true;

      const isCjkSource = /[\uAC00-\uD7AF\u3040-\u30FF\u4E00-\u9FFF]/.test(sourceText);
      const isActualBoilerplateSource = /회사\s*소개|이용\s*약관|개인정보|서비스\s*약관/.test(sourceText);
      if (isCjkSource && !isActualBoilerplateSource) {
        const boilerplateTerms = [
          'เกี่ยวกับเรา',
          'เงื่อนไขการบริการ',
          'นโยบายความเป็นส่วนตัว',
          'ข้อตกลงในการให้บริการ',
          'ผมตกลงในเงื่อนไข',
          'ฉันตกลงในเงื่อนไข',
          'ข้อมูลส่วนบุคคล'
        ];
        const hasBoilerplate = boilerplateTerms.some(term => trimmed.includes(term));
        if (hasBoilerplate) return true;
      }

      return false;
    };

    for (const res of cachedLookup) {
      if (res.cachedText !== null && !isCachedUntranslated(res.cachedText, res.item.text, options.targetLanguage, options.sourceLanguage)) {
        cachedItems.push({ item: res.item, cachedText: res.cachedText });
      } else {
        uncachedItems.push(res.item);
      }
    }

    let engineResults: TranslationResult[] = [];
    if (uncachedItems.length > 0) {
      engineResults = await engine.translate(uncachedItems, options);

      const savePromises = engineResults.map(async (res) => {
        if (res.success && res.translatedText) {
          const matchedItem = uncachedItems.find((ui) => ui.id === res.id);
          if (matchedItem) {
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

              const cacheKey = `${options.sourceLanguage}:${options.targetLanguage}:${engineId}:${options.translationMode}:${matchedItem.text}`;
              this.memoryCache.delete(cacheKey);
              this.memoryCache.set(cacheKey, res.translatedText);
              
              while (this.memoryCache.size > this.maxCacheSize) {
                const firstKey = this.memoryCache.keys().next().value;
                if (firstKey !== undefined) {
                  this.memoryCache.delete(firstKey);
                }
              }
            } catch (saveError) {
              console.warn('[TranslationCoordinator] Failed to save sentence to cache:', matchedItem.text, saveError);
            }
          }
        }
      });
      await Promise.all(savePromises);
    }

    const cachedResults: TranslationResult[] = cachedItems.map((c) => ({
      id: c.item.id,
      translatedText: c.cachedText,
      success: true,
      engineUsed: `${engineId}-sentence-cache`,
    }));

    results.push(...engineResults, ...cachedResults);

    emptyItems.forEach((item) => {
      results.push({
        id: item.id,
        translatedText: '',
        success: true,
        engineUsed: 'empty',
      });
    });

    return results;
  }

  async runTranslation(
    engineId: string,
    items: TranslatableItem[],
    options: {
      sourceLanguage: string;
      targetLanguage: string;
      translationMode: string;
      translateBatchOffline: (texts: string[], type: string, mode: any, src: string, tgt: string, engine?: string) => Promise<string[]>;
      translateBatchGemini?: (texts: string[], type: string, mode: any, src: string, tgt: string) => Promise<string[]>;
    }
  ): Promise<TranslationResult[]> {
    const engine = this.engines.get(engineId);
    if (!engine) {
      throw new Error(`Engine with ID "${engineId}" not registered.`);
    }

    // Partition items by their resolved source language
    const itemsByLang = new Map<string, TranslatableItem[]>();
    for (const item of items) {
      const itemLang = item.sourceLanguage || options.sourceLanguage;
      if (!itemsByLang.has(itemLang)) {
        itemsByLang.set(itemLang, []);
      }
      itemsByLang.get(itemLang)!.push(item);
    }

    const results: TranslationResult[] = [];

    for (const [itemLang, groupItems] of itemsByLang.entries()) {
      if (itemLang === options.targetLanguage) {
        // Short-circuit for this language group only
        const shortCircuitResults = groupItems.map((item) => ({
          id: item.id,
          translatedText: item.text,
          success: true,
          engineUsed: 'short-circuit-same-lang',
        }));
        results.push(...shortCircuitResults);
        continue;
      }

      const groupOptions = {
        ...options,
        sourceLanguage: itemLang,
      };

      const groupResults = await this.translateGroup(engineId, groupItems, groupOptions);
      results.push(...groupResults);
    }

    // Sort results to match original items order
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

/**
 * ชำระล้างสัญลักษณ์จัดรูปแบบและอักขระขยะที่โมเดลแปลภาษาอาจแทรกกลับคืนมา (เช่น #คำแปล#, **คำแปล**, หรืออัญประกาศหัวท้าย)
 */
export const sanitizeTranslationResult = (text: string): string => {
  if (!text) return '';
  let cleaned = text.trim();
  
  // [FIX] Strip ASS/SSA subtitle override tags e.g. {\cHFFFFFF} {\an8} that can leak into cached results.
  cleaned = cleaned.replace(/\{[^}]*\}/g, '').trim();
  
  // ล้างการครอบด้วย Markdown หรือ Hash (เช่น #คำแปล# หรือ *คำแปล*)
  cleaned = cleaned.replace(/^(\*+|_|#+)(.*?)\1$/, '$2').trim();
  
  // ล้างเครื่องหมายอัญประกาศครอบหัวท้ายที่โมเดลชอบเติมมา
  cleaned = cleaned.replace(/^["'“‘](.*?)["'”’]$/, '$2').trim();
  
  // ล้างเครื่องหมายแฮชที่อาจหลงเหลือเดี่ยว ๆ ที่จุดเริ่มต้นหรือจุดสิ้นสุด
  cleaned = cleaned.replace(/^#+(.*?)$/, '$1').replace(/^(.*?)#+$/, '$1').trim();
  
  return cleaned;
};
