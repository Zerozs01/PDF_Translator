import { SPANISH_DICTIONARY_TH } from './spanishDictionary';
import { KOREAN_DICTIONARY_TH } from './koreanDictionary';
import { JAPANESE_DICTIONARY_TH } from './japaneseDictionary';
import { FRENCH_DICTIONARY_TH } from './frenchDictionary';
import { CHINESE_DICTIONARY_TH } from './chineseDictionary';
import { ENGLISH_DICTIONARY_TH } from './englishDictionary';

export {
  SPANISH_DICTIONARY_TH,
  KOREAN_DICTIONARY_TH,
  JAPANESE_DICTIONARY_TH,
  FRENCH_DICTIONARY_TH,
  CHINESE_DICTIONARY_TH,
  ENGLISH_DICTIONARY_TH,
};

/**
 * Universal composite lookup map for zero-overhead backwards compatibility.
 */
export const ARGOS_SHORT_PHRASE_LOOKUP_TH: Record<string, string> = {
  ...ENGLISH_DICTIONARY_TH,
  ...SPANISH_DICTIONARY_TH,
  ...KOREAN_DICTIONARY_TH,
  ...JAPANESE_DICTIONARY_TH,
  ...FRENCH_DICTIONARY_TH,
  ...CHINESE_DICTIONARY_TH,
};

export const GENERAL_ENGLISH_DICTIONARY_TH: Record<string, string> = ENGLISH_DICTIONARY_TH;

/**
 * Returns the scoped dictionary matching the source language for prioritized O(1) matching.
 */
export const getDictionaryByLanguage = (sourceLang?: string): Record<string, string> => {
  const lang = (sourceLang || '').toLowerCase().trim();
  switch (lang) {
    case 'es':
    case 'spa':
    case 'spanish':
      return SPANISH_DICTIONARY_TH;
    case 'ko':
    case 'kor':
    case 'korean':
      return KOREAN_DICTIONARY_TH;
    case 'ja':
    case 'jpn':
    case 'japanese':
      return JAPANESE_DICTIONARY_TH;
    case 'fr':
    case 'fra':
    case 'fre':
    case 'french':
      return FRENCH_DICTIONARY_TH;
    case 'zh':
    case 'zho':
    case 'chi':
    case 'chinese':
      return CHINESE_DICTIONARY_TH;
    case 'en':
    case 'eng':
    case 'english':
      return ENGLISH_DICTIONARY_TH;
    default:
      return ARGOS_SHORT_PHRASE_LOOKUP_TH;
  }
};
