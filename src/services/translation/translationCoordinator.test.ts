import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { translationCoordinator } from './translationCoordinator';
import { TranslatableItem } from '../../types/translation';
import { dbService } from '../dbService';

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
  Object.defineProperty(global, 'localStorage', { value: mockLocalStorage, writable: true });
}

describe('TranslationCoordinator & Engines', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(dbService, 'getSentenceTranslation').mockResolvedValue(null);
    vi.spyOn(dbService, 'saveSentenceTranslation').mockResolvedValue(undefined as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('ArgosTranslationEngine', () => {
    it('translates balloon layers and bypasses sfx layers using local dictionary', async () => {
      const mockTranslateBatchOffline = vi.fn().mockResolvedValue(['สวัสดี', 'ยินดีต้อนรับ']);

      const items: TranslatableItem[] = [
        { id: '1', text: 'Hello', groupType: 'balloon' },
        { id: '2', text: 'BOOM', groupType: 'sfx' }, // should be translated via local dict to 'ตูม!'
        { id: '3', text: 'Welcome', groupType: 'balloon' },
      ];

      const results = await translationCoordinator.runTranslation('argos', items, {
        sourceLanguage: 'en',
        targetLanguage: 'th',
        translationMode: 'official',
        translateBatchOffline: mockTranslateBatchOffline,
      });

      // translateBatchOffline should only receive 'Hello' and 'Welcome' (sfx is bypassed)
      expect(mockTranslateBatchOffline).toHaveBeenCalledWith(
        ['Hello', 'Welcome'],
        'text',
        'official',
        'en',
        'th'
      );

      // Check results mapping
      const helloResult = results.find((r) => r.id === '1');
      const sfxResult = results.find((r) => r.id === '2');
      const welcomeResult = results.find((r) => r.id === '3');

      expect(helloResult).toBeDefined();
      expect(helloResult?.translatedText).toBe('สวัสดี');
      expect(helloResult?.success).toBe(true);
      expect(helloResult?.engineUsed).toBe('argos');

      expect(sfxResult).toBeDefined();
      expect(sfxResult?.translatedText).toBe('ตูม!');
      expect(sfxResult?.success).toBe(true);
      expect(sfxResult?.engineUsed).toBe('sfx-dict');

      expect(welcomeResult).toBeDefined();
      expect(welcomeResult?.translatedText).toBe('ยินดีต้อนรับ');
      expect(welcomeResult?.success).toBe(true);
      expect(welcomeResult?.engineUsed).toBe('argos');
    });

    it('returns original text if offline translator fails', async () => {
      const mockTranslateBatchOffline = vi.fn().mockRejectedValue(new Error('Offline core error'));

      const items: TranslatableItem[] = [
        { id: '1', text: 'Hello', groupType: 'balloon' },
      ];

      const results = await translationCoordinator.runTranslation('argos', items, {
        sourceLanguage: 'en',
        targetLanguage: 'th',
        translationMode: 'official',
        translateBatchOffline: mockTranslateBatchOffline,
      });

      expect(results[0]?.translatedText).toBe('Hello');
      expect(results[0]?.success).toBe(false);
      expect(results[0]?.error).toBe('Offline core error');
    });

    it('bypasses database cache lookup for phrases found in ARGOS_SHORT_PHRASE_LOOKUP_TH', async () => {
      const mockGetSentenceTranslation = vi.fn().mockResolvedValue('แปลกๆ');
      const getSpy = vi.spyOn(dbService, 'getSentenceTranslation').mockImplementation(mockGetSentenceTranslation);

      const items: TranslatableItem[] = [
        { id: '1', text: 'YOU', groupType: 'balloon' },
        { id: '2', text: 'MOREEEEEE!', groupType: 'balloon' },
        { id: '3', text: 'PLEEA +AASEEE!', groupType: 'balloon' },
      ];

      const results = await translationCoordinator.runTranslation('argos', items, {
        sourceLanguage: 'en',
        targetLanguage: 'th',
        translationMode: 'official',
        translateBatchOffline: vi.fn(),
      });

      const youResult = results.find((r) => r.id === '1');
      const moreResult = results.find((r) => r.id === '2');
      const pleaseResult = results.find((r) => r.id === '3');

      expect(youResult?.translatedText).toBe('คุณ');
      expect(moreResult?.translatedText).toBe('มากกกกว่าาาานี้');
      expect(pleaseResult?.translatedText).toBe('ได้โปรด ดดดดดด');

      // dbService.getSentenceTranslation should not be called because all 3 items matched the dictionary/elongation bypass
      expect(getSpy).not.toHaveBeenCalled();
      
      getSpy.mockRestore();
    });

    it('successfully translates all user-reported short manga phrases', async () => {
      const items: TranslatableItem[] = [
        { id: '1', text: 'YOU', groupType: 'balloon' },
        { id: '2', text: 'FRONT', groupType: 'balloon' },
        { id: '3', text: 'NiPPLES', groupType: 'balloon' },
        { id: '4', text: 'LONGER', groupType: 'balloon' },
        { id: '5', text: 'TODAY AGAiN', groupType: 'balloon' },
        { id: '6', text: 'KNiiiiiGHT', groupType: 'balloon' },
        { id: '7', text: 'HER POSi-', groupType: 'balloon' },
        { id: '8', text: 'SUiTS', groupType: 'balloon' },
        { id: '9', text: 'SO', groupType: 'balloon' },
        { id: '10', text: 'NiPPLES AND', groupType: 'balloon' },
        { id: '11', text: 'CERVIX', groupType: 'balloon' },
        { id: '12', text: 'COCK', groupType: 'balloon' },
        { id: '13', text: 'US THE', groupType: 'balloon' },
        { id: '14', text: 'GENERAL', groupType: 'balloon' },
        { id: '15', text: 'DiE ALONG', groupType: 'balloon' },
        { id: '16', text: 'ALSO', groupType: 'balloon' },
        { id: '17', text: 'HER PLACE', groupType: 'balloon' },
        { id: '18', text: 'MAKE SURE', groupType: 'balloon' },
        { id: '19', text: 'and was at a', groupType: 'balloon' },
        { id: '20', text: 'recapturina', groupType: 'balloon' },
        { id: '21', text: 'sadness', groupType: 'balloon' },
        { id: '22', text: 'all arstocrats', groupType: 'balloon' },
        { id: '23', text: 'king and', groupType: 'balloon' },
        { id: '24', text: 'an all-out', groupType: 'balloon' },
        { id: '25', text: 'But in any age...', groupType: 'balloon' },
        { id: '26', text: 'MOREEEEEE!', groupType: 'balloon' },
        { id: '27', text: 'PLEEA +AASEEE!', groupType: 'balloon' }
      ];

      const results = await translationCoordinator.runTranslation('argos', items, {
        sourceLanguage: 'en',
        targetLanguage: 'th',
        translationMode: 'official',
        translateBatchOffline: vi.fn(),
      });

      const expected: Record<string, string> = {
        '1': 'คุณ',
        '2': 'ข้างหน้า',
        '3': 'หัวนม',
        '4': 'นานขึ้น',
        '5': 'วันนี้อีกแล้ว',
        '6': 'อัศวิน',
        '7': 'ท่าของเธอ',
        '8': 'เหมาะกับ',
        '9': 'ช่าง...',
        '10': 'หัวนมและ',
        '11': 'ปากมดลูก',
        '12': 'ควย',
        '13': 'พวกเรา',
        '14': 'นายพล',
        '15': 'ตายตามกันไป',
        '16': 'ด้วยเหมือนกัน',
        '17': 'ที่ของเธอ',
        '18': 'ให้แน่ใจ',
        '19': 'และกำลังตกอยู่ใน',
        '20': 'การยึดกลับคืน',
        '21': 'ความเศร้า',
        '22': 'เหล่าขุนนางทั้งหมด',
        '23': 'ราชาและ',
        '24': 'อย่างเต็มรูปแบบ',
        '25': 'แต่ไม่ว่าจะในยุคสมัยใด',
        '26': 'มากกกกว่าาาานี้',
        '27': 'ได้โปรด ดดดดดด'
      };

      Object.entries(expected).forEach(([id, val]) => {
        const item = results.find(r => r.id === id);
        expect(item?.translatedText).toBe(val);
        expect(item?.success).toBe(true);
      });
    });
  });

  describe('GeminiTranslationEngine', () => {
    it('translates balloon/narration layers using XML tags and local dict first for SFX', async () => {
      const mockTranslateBatchGemini = vi.fn().mockResolvedValue([
        '<balloon id="1">สวัสดี</balloon>',
        '<sfx id="2">เฟี้ยว!</sfx>', // mock for custom sfx not in local dictionary
      ]);

      const items: TranslatableItem[] = [
        { id: '1', text: 'Hello', groupType: 'balloon' },
        { id: '2', text: 'ZOOM', groupType: 'sfx' }, // not in default local dictionary, will be sent to Gemini
        { id: '3', text: 'BOOM', groupType: 'sfx' }, // in local dictionary, will use 'ตูม!' and not sent to Gemini
      ];

      const results = await translationCoordinator.runTranslation('gemini', items, {
        sourceLanguage: 'en',
        targetLanguage: 'th',
        translationMode: 'official',
        translateBatchOffline: vi.fn(),
        translateBatchGemini: mockTranslateBatchGemini,
      });

      // translateBatchGemini should only receive 'Hello' (as <balloon>) and 'ZOOM' (as <sfx>)
      // 'BOOM' should be resolved locally
      expect(mockTranslateBatchGemini).toHaveBeenCalledWith(
        ['<balloon id="1">Hello</balloon>', '<sfx id="2">ZOOM</sfx>'],
        'text',
        'official',
        'en',
        'th'
      );

      const helloResult = results.find((r) => r.id === '1');
      const zoomResult = results.find((r) => r.id === '2');
      const boomResult = results.find((r) => r.id === '3');

      expect(helloResult?.translatedText).toBe('สวัสดี');
      expect(helloResult?.engineUsed).toBe('gemini');

      expect(zoomResult?.translatedText).toBe('เฟี้ยว!');
      expect(zoomResult?.engineUsed).toBe('gemini');

      expect(boomResult?.translatedText).toBe('ตูม!');
      expect(boomResult?.engineUsed).toBe('sfx-dict');
    });
  });

  describe('Empty Items handling', () => {
    it('returns empty translatedText immediately without calling engines', async () => {
      const mockOffline = vi.fn();
      const items: TranslatableItem[] = [
        { id: '1', text: '   ', groupType: 'balloon' },
      ];

      const results = await translationCoordinator.runTranslation('argos', items, {
        sourceLanguage: 'en',
        targetLanguage: 'th',
        translationMode: 'official',
        translateBatchOffline: mockOffline,
      });

      expect(mockOffline).not.toHaveBeenCalled();
      expect(results[0]?.translatedText).toBe('');
      expect(results[0]?.engineUsed).toBe('empty');
    });
  });
});
