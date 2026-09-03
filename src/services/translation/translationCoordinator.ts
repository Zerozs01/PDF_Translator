import { TranslatableItem, TranslationResult, TranslationEngine } from '../../types/translation';
import { translateSFX, SFXLanguage } from './sfxDictionaryService';
import { dbService } from '../dbService';
import { hasKoreanTranslationCarryover, applyKoreanConversationalFallback } from './koreanTranslationPolicy';
import { lookupShortPhraseTh } from './offlineTranslationService';
import { normalizeTranslationLanguage } from '../ocr/ocrTextNormalizer';

/**
 * [Scrutinize S8]: Shared SFX/Dictionary resolver — ใช้ร่วมกันระหว่าง 3 engines
 * แยก SFX items ออก → แปลด้วย Local Dict → คืนผลที่แปลได้ + items ที่ต้องส่งต่อ
 */
interface SfxResolveResult {
  /** ผลแปลที่ได้จาก SFX dict + short phrase dict */
  resolvedResults: TranslationResult[];
  /** Items ที่ SFX dict แปลไม่ได้ → ต้องส่งไป engine จริง */
  unresolvedSfxItems: TranslatableItem[];
}

function resolveSfxItems(
  items: TranslatableItem[],
  sourceLanguage: string,
): SfxResolveResult {
  const sfxItems = items.filter((item) => item.groupType === 'sfx');
  const resolvedResults: TranslationResult[] = [];
  const unresolvedSfxItems: TranslatableItem[] = [];

  const sfxLang = sourceLanguage.substring(0, 2).toLowerCase() as SFXLanguage;
  for (const item of sfxItems) {
    const sfxTranslated = translateSFX(item.text, sfxLang);
    if (sfxTranslated) {
      resolvedResults.push({
        id: item.id,
        translatedText: sfxTranslated,
        success: true,
        engineUsed: 'sfx-dict',
      });
    } else {
      const shortPhraseMatch = lookupShortPhraseTh(item.text, sourceLanguage);
      if (shortPhraseMatch) {
        resolvedResults.push({
          id: item.id,
          translatedText: shortPhraseMatch,
          success: true,
          engineUsed: 'short-phrase-dict',
        });
      } else {
        unresolvedSfxItems.push(item);
      }
    }
  }

  return { resolvedResults, unresolvedSfxItems };
}

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
    // [Scrutinize S8]: ใช้ shared SFX resolver แทน inline loop
    const { resolvedResults: sfxResults, unresolvedSfxItems } = resolveSfxItems(items, options.sourceLanguage);
    const results: TranslationResult[] = [...sfxResults];

    const batchItems: TranslatableItem[] = [];

    items.forEach((item) => {
      if (item.groupType === 'sfx') {
        // SFX ที่แปลไม่ได้จาก dict → รวมเข้า batch ส่งไป Argos
        if (unresolvedSfxItems.some((u) => u.id === item.id)) {
          batchItems.push(item);
        }
        return;
      }
      if (options.targetLanguage === 'th') {
        const directMatch = lookupShortPhraseTh(item.text, options.sourceLanguage);
        if (directMatch) {
          console.log(`[TranslationCoordinator] Direct dictionary hit for: "${item.text}" -> "${directMatch}"`);
          results.push({
            id: item.id,
            translatedText: directMatch,
            success: true,
            engineUsed: 'short-phrase-dict',
          });
          return;
        }
      }
      batchItems.push(item);
    });

    if (batchItems.length === 0) {
      return results;
    }

    try {
      const allTexts = batchItems.map((item) => item.text);

      // 4. สั่งแปล Batch ด้วยข้อความทั้งหมด (context-aware)
      const translatedTexts = await options.translateBatchOffline(
        allTexts,
        'text',
        options.translationMode,
        options.sourceLanguage,
        options.targetLanguage
      );

      // 5. Post-processing: คืนค่าไปตามลำดับ ID ตามลำดับของ items
      batchItems.forEach((item, index) => {
        let translatedText = (translatedTexts && translatedTexts[index]) || item.text;
        
        // Safety Fallback: ถ้าเป็นภาษาไทย แต่ Argos คืนผลลัพธ์ภาษาเกาหลี/ภาษาอังกฤษกลับมา ให้ลองระบบ Fallback ภาษาเกาหลี
        if (options.targetLanguage === 'th' && (!/[\u0E00-\u0E7F]/.test(translatedText) || /[\uAC00-\uD7AF]/.test(translatedText))) {
          const koreanFallback = applyKoreanConversationalFallback(item.text, translatedText);
          if (koreanFallback) {
            translatedText = koreanFallback;
          } else {
            const dictFallback = lookupShortPhraseTh(item.text, options.sourceLanguage);
            if (dictFallback) {
              translatedText = dictFallback;
            }
          }
        }

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
      batchItems.forEach((item) => {
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
    // [Scrutinize S8]: ใช้ shared SFX resolver แทน inline loop
    const { resolvedResults: sfxResults, unresolvedSfxItems } = resolveSfxItems(items, options.sourceLanguage);
    const results: TranslationResult[] = [...sfxResults];

    // รวบรวม non-SFX items + SFX ที่แปลไม่ได้เข้า batch เดียว
    const batchItems: TranslatableItem[] = [];
    items.forEach((item) => {
      if (item.groupType === 'sfx') {
        if (unresolvedSfxItems.some((u) => u.id === item.id)) {
          batchItems.push(item);
        }
        return;
      }
      batchItems.push(item);
    });

    if (batchItems.length === 0) {
      return results;
    }

    try {
      // ทำไมถึงเขียนแบบนี้: ไม่ Deduplicate ก่อนส่งแปล เพราะคำที่ซ้ำในหลายบอลลูนจำเป็นต้องได้รับบริบทแยกกันตาม Context
      // การกรองคำซ้ำออกแล้วเอาคำแปลไปแปะทำให้ตัว engine ไม่ได้เห็น Context ที่สมบูรณ์ ทำให้คำแปลทื่อหรือผิดความหมาย
      const allTexts = batchItems.map((item) => item.text);

      const translatedTexts = await options.translateBatchOffline(
        allTexts,
        'text',
        options.translationMode,
        options.sourceLanguage,
        options.targetLanguage,
        'm2m100'
      );

      batchItems.forEach((item, index) => {
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
      batchItems.forEach((item) => {
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

    // 1. [Scrutinize S8]: แยกกลุ่มและแปล SFX ด้วย Local Dict ผ่าน shared resolver
    const { resolvedResults: sfxResults, unresolvedSfxItems: sfxToTranslateViaLLM } = resolveSfxItems(items, options.sourceLanguage);
    const results: TranslationResult[] = [...sfxResults];
    const nonSfxItems = items.filter((item) => item.groupType !== 'sfx');

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
      
      const xmlTags = llmTargetItems.map((item) => {
        if (item.groupType === 'sfx') {
          return `<sfx id="${item.id}">${item.text}</sfx>`;
        } else if (item.groupType === 'narration') {
          return `<narration id="${item.id}">${item.text}</narration>`;
        } else {
          return `<balloon id="${item.id}">${item.text}</balloon>`;
        }
      });

      // Bundle all dialogue elements on the page into a single XML document payload to preserve context
      const singleXmlPayload = `<page_dialogue>\n${xmlTags.join('\n')}\n</page_dialogue>`;

      const translatedOutputs = await options.translateBatchGemini(
        [singleXmlPayload],
        'batch-markdown',
        options.translationMode,
        options.sourceLanguage,
        options.targetLanguage
      );

      const combinedResponse = translatedOutputs[0] || '';

      llmTargetItems.forEach((item, index) => {
        // Extract tag by ID using Regex
        const tagRegex = new RegExp(`<(?:balloon|sfx|narration)\\s+id=["']?${item.id}["']?[^>]*>([\\s\\S]*?)</(?:balloon|sfx|narration)>`, 'i');
        const match = combinedResponse.match(tagRegex);
        
        let cleanedText = '';
        if (match && match[1] !== undefined) {
          cleanedText = match[1].trim();
        } else {
          // Fallback: If single batch response didn't contain the specific tag, check array output
          const rawOutput = translatedOutputs[index] || item.text;
          cleanedText = rawOutput
            .replace(/<balloon[^>]*>([\s\S]*?)<\/balloon>/gi, '$1')
            .replace(/<sfx[^>]*>([\s\S]*?)<\/sfx>/gi, '$1')
            .replace(/<narration[^>]*>([\s\S]*?)<\/narration>/gi, '$1')
            .replace(/<\/?page_dialogue>/gi, '')
            .trim();
        }

        let sanitizedText = sanitizeTranslationResult(cleanedText);

        // Fallback for Korean conversational phrases when Gemini fails to translate or leaves untranslated
        if (options.targetLanguage === 'th' && (!sanitizedText || !/[\u0E00-\u0E7F]/.test(sanitizedText) || /[\uAC00-\uD7AF]/.test(sanitizedText))) {
          const koreanFallback = applyKoreanConversationalFallback(item.text, sanitizedText);
          if (koreanFallback) {
            sanitizedText = koreanFallback;
          } else {
            const dictFallback = lookupShortPhraseTh(item.text, options.sourceLanguage);
            if (dictFallback) {
              sanitizedText = dictFallback;
            }
          }
        }

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
        const directDictTranslation = lookupShortPhraseTh(item.text, options.sourceLanguage);
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
      let cachedText = batchCacheResults[item.text] || null;
      if (options.targetLanguage === 'th') {
        const dictFallback = lookupShortPhraseTh(item.text);
        if (dictFallback && (!cachedText || (/[a-zA-Z]/.test(cachedText) && !/[\u0E00-\u0E7F]/.test(cachedText)))) {
          cachedText = dictFallback;
        }
      }
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

      const normSource = normalizeTranslationLanguage(sourceLang, '').toLowerCase();
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

      const itemsToSave: Array<{
        sourceText: string;
        sourceLanguage: string;
        targetLanguage: string;
        translatorEngine: string;
        translationMode: string;
        translatedText: string;
      }> = [];

      for (const res of engineResults) {
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
              continue;
            }

            itemsToSave.push({
              sourceText: matchedItem.text,
              sourceLanguage: options.sourceLanguage,
              targetLanguage: options.targetLanguage,
              translatorEngine: engineId,
              translationMode: options.translationMode,
              translatedText: res.translatedText,
            });

            const cacheKey = `${options.sourceLanguage}:${options.targetLanguage}:${engineId}:${options.translationMode}:${matchedItem.text}`;
            this.memoryCache.delete(cacheKey);
            this.memoryCache.set(cacheKey, res.translatedText);
          }
        }
      }

      while (this.memoryCache.size > this.maxCacheSize) {
        const firstKey = this.memoryCache.keys().next().value;
        if (firstKey !== undefined) {
          this.memoryCache.delete(firstKey);
        } else {
          break;
        }
      }

      if (itemsToSave.length > 0) {
        try {
          await dbService.saveSentenceTranslationBatch(itemsToSave);
        } catch (saveError) {
          console.warn('[TranslationCoordinator] Failed to save batch sentences to cache:', saveError);
        }
      }
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
  cleaned = cleaned.replace(/^["'“‘](.*?)["'”’]$/, '$1').trim();
  
  // ล้างเครื่องหมายแฮชที่อาจหลงเหลือจากการแทนที่ Token เช่น # คำแปล # หรือ #...# ใดๆ
  cleaned = cleaned.replace(/#\s*(.*?)\s*#/g, '$1').replace(/#/g, '').trim();
  
  return cleaned;
};
