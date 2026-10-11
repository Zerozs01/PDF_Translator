import type { BBox } from '../../types';
import { lookupShortPhraseTh } from '../../services/translation/offlineTranslationService';

export interface RawTranslatedInput {
  index?: number;
  lineIndex?: number;
  sourceText?: string;
  text?: string;
  bbox?: BBox;
  [key: string]: unknown;
}

export interface TranslatedLineEntry {
  index: number;
  text: string;
  bbox?: BBox;
  sourceText?: string;
}

/**
 * Pure helper to sanitize translated line items using local short phrase / glossary
 */
export function normalizeTranslatedLineItem(
  item: RawTranslatedInput,
  fallbackIndex: number
): TranslatedLineEntry {
  const index = typeof item?.index === 'number'
    ? item.index
    : (typeof item?.lineIndex === 'number' ? item.lineIndex : fallbackIndex);
  const source = String(item?.sourceText || '').trim();
  let text = String(item?.text || '').trim();
  const cleanSource = source.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const cleanTrans = text.toUpperCase().replace(/[^A-Z0-9]/g, '');

  if (!text || cleanSource === cleanTrans || (/[a-zA-Z]/.test(text) && !/[\u0E00-\u0E7F]/.test(text))) {
    const glossaryMatch = lookupShortPhraseTh(source) || lookupShortPhraseTh(cleanSource);
    if (glossaryMatch) {
      text = glossaryMatch;
    } else {
      const words = source.trim().split(/\s+/);
      if (words.length > 1) {
        const translatedWords = words.map((w) => lookupShortPhraseTh(w) || lookupShortPhraseTh(w.replace(/[^A-Za-z0-9]/g, '')) || w);
        if (translatedWords.some((tw) => /[\u0E00-\u0E7F]/.test(tw))) {
          text = translatedWords.join(' ');
        }
      }
    }
  }

  return {
    index,
    text,
    bbox: item?.bbox,
    sourceText: item?.sourceText,
  };
}
