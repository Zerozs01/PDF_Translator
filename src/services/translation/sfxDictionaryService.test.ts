import { describe, it, expect, beforeEach } from 'vitest';
import {
  getLevenshteinDistance,
  getStringSimilarity,
  translateSFX,
  getUserDictionary,
  saveUserDictionary,
  getMergedDictionary,
} from './sfxDictionaryService';

// Polyfill localStorage for node environment
if (typeof localStorage === 'undefined') {
  const store: Record<string, string> = {};
  const mockLocalStorage = {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = String(value); },
    clear: () => { for (const key in store) delete store[key]; },
    removeItem: (key: string) => { delete store[key]; },
    key: (index: number) => Object.keys(store)[index] || null,
    get length() { return Object.keys(store).length; },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: mockLocalStorage, writable: true });
}

describe('sfxDictionaryService', () => {
  beforeEach(() => {
    // ล้าง localStorage ก่อนการทดสอบแต่ละครั้ง
    localStorage.clear();
  });

  describe('Levenshtein Distance', () => {
    it('calculates distance correctly', () => {
      expect(getLevenshteinDistance('cat', 'cat')).toBe(0);
      expect(getLevenshteinDistance('cat', 'bat')).toBe(1);
      expect(getLevenshteinDistance('boom', 'boomm')).toBe(1);
      expect(getLevenshteinDistance('crash', 'clash')).toBe(1);
      expect(getLevenshteinDistance('bang', 'bing')).toBe(1);
      expect(getLevenshteinDistance('', 'abc')).toBe(3);
    });
  });

  describe('String Similarity', () => {
    it('calculates similarity score correctly', () => {
      expect(getStringSimilarity('boom', 'boom')).toBe(1.0);
      expect(getStringSimilarity('boom', 'boomm')).toBe(0.8); // 4/5 similarity
      expect(getStringSimilarity('crash', 'crashh')).toBe(5/6);
      expect(getStringSimilarity('dog', 'cat')).toBe(0.0); // complete mismatch
    });
  });

  describe('SFX Translation Lookup', () => {
    it('resolves exact match correctly', () => {
      expect(translateSFX('BOOM', 'en')).toBe('ตูม!');
      expect(translateSFX('ドン', 'jp')).toBe('ตึง!');
      expect(translateSFX('쿵', 'ko')).toBe('ตึง!');
    });

    it('resolves exact match case-insensitively', () => {
      expect(translateSFX('boom', 'en')).toBe('ตูม!');
      expect(translateSFX('Crash', 'en')).toBe('โครม!');
    });

    it('resolves fuzzy match for slight spelling variations', () => {
      // BOOMM -> BOOM (similarity = 0.8 >= 0.75)
      expect(translateSFX('BOOMM', 'en')).toBe('ตูม!');
      // CRASHH -> CRASH (similarity = 5/6 >= 0.75)
      expect(translateSFX('CRASHH', 'en')).toBe('โครม!');
    });

    it('returns null for completely unrelated words (no false positive)', () => {
      expect(translateSFX('HELLO', 'en')).toBeNull();
      expect(translateSFX('DOG', 'en')).toBeNull();
    });
  });

  describe('User Custom SFX Dictionary', () => {
    it('saves and loads user custom dictionary from localStorage', () => {
      const userDict = {
        en: [{ source: 'ZAP', target: 'เปรี้ยง!', notes: 'สายฟ้าฟาด' }],
        jp: [],
        ko: [],
        es: [],
      };

      saveUserDictionary(userDict);
      expect(getUserDictionary()).toEqual(userDict);
    });

    it('merges user custom dictionary with default dictionary correctly', () => {
      const userDict = {
        en: [{ source: 'ZAP', target: 'เปรี้ยง!', notes: 'สายฟ้าฟาด' }],
        jp: [],
        ko: [],
        es: [],
      };

      saveUserDictionary(userDict);
      const merged = getMergedDictionary();

      // ต้องมีคำทับจาก user dict
      expect(merged.data.en.find(e => e.source === 'ZAP')).toBeDefined();
      // และยังต้องมีคำเริ่มต้นจาก default dict
      expect(merged.data.en.find(e => e.source === 'BOOM')).toBeDefined();
    });

    it('allows user dictionary to override default dictionary entries', () => {
      // พยายามทับคำว่า "BOOM" จากเดิม "ตูม!" ให้กลายเป็น "บึ้ม!"
      const userDict = {
        en: [{ source: 'BOOM', target: 'บึ้ม!', notes: 'ทับของเดิม' }],
        jp: [],
        ko: [],
        es: [],
      };

      saveUserDictionary(userDict);
      expect(translateSFX('BOOM', 'en')).toBe('บึ้ม!');
    });
  });
});
