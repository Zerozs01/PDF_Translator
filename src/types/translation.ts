/**
 * Translation Types — สำหรับระบบตัวแปลภาษาแบบบูรณาการร่วมกับกลุ่มเลเยอร์ (Group-Aware Translation Engine)
 */

import { LayerGroupType } from './layers';

export interface TranslatableItem {
  id: string; // Layer ID
  text: string; // ข้อความเดิมที่ต้องการแปล
  groupType: LayerGroupType; // ประเภทกลุ่มเลเยอร์ เช่น balloon, sfx, narration
  lineIndex?: number;
  sourceLanguage?: string; // ภาษาต้นทางของกล่องข้อความย่อยนี้
}

export interface TranslationResult {
  id: string;
  translatedText: string;
  success: boolean;
  error?: string;
  engineUsed?: string;
}

export interface TranslationEngine {
  readonly id: string;
  readonly name: string;
  translate(
    items: TranslatableItem[],
    options: {
      sourceLanguage: string;
      targetLanguage: string;
      translationMode: string;
      translateBatchOffline: (texts: string[], type: string, mode: any, src: string, tgt: string) => Promise<string[]>;
      translateBatchGemini?: (texts: string[], type: string, mode: any, src: string, tgt: string) => Promise<string[]>;
    }
  ): Promise<TranslationResult[]>;
}
