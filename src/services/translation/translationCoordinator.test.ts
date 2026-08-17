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
    translationCoordinator.clearMemoryCache();
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
        { id: '9', text: 'SO...', groupType: 'balloon' },
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
        { id: '27', text: 'PLEEA +AASEEE!', groupType: 'balloon' },
        { id: '28', text: 'TELL HiS', groupType: 'balloon' },
        { id: '29', text: 'THE BARBA', groupType: 'balloon' },
        { id: '30', text: 'SCREAMS', groupType: 'balloon' },
        { id: '31', text: 'STOOOOP', groupType: 'balloon' },
        { id: '32', text: 'ST0000P', groupType: 'balloon' },
        { id: '33', text: 'THAT iTS', groupType: 'balloon' },
        { id: '34', text: 'YOU,FRONT', groupType: 'balloon' },
        { id: '35', text: 'YOU, FRONT', groupType: 'balloon' },
        { id: '36', text: 'TATED!', groupType: 'balloon' },
        { id: '37', text: 'WEIGHT', groupType: 'balloon' },
        { id: '38', text: 'BURSTiNG', groupType: 'balloon' },
        { id: '39', text: 'I MPREGNATED PiG', groupType: 'balloon' },
        { id: '40', text: 'SORRYY', groupType: 'balloon' },
        { id: '41', text: 'NOOOO', groupType: 'balloon' },
        { id: '42', text: 'YOUVE GOT A', groupType: 'balloon' },
        { id: '43', text: 'OHHH!OH!', groupType: 'balloon' },
        { id: '44', text: 'FIELD', groupType: 'balloon' },
        { id: '45', text: 'MSMAK IM A', groupType: 'balloon' },
        { id: '46', text: 'PLAP', groupType: 'sfx' },
        { id: '47', text: 'BREE DING SACK', groupType: 'balloon' },
        { id: '48', text: 'SEMEN...', groupType: 'balloon' },
        { id: '49', text: 'THIS BLACK-MARKET AV', groupType: 'balloon' },
        { id: '50', text: 'Sochacan', groupType: 'balloon' },
        { id: '51', text: 'Cummngi', groupType: 'balloon' },
        { id: '52', text: 'Creak', groupType: 'sfx' },
        { id: '53', text: 'rool', groupType: 'sfx' },
        { id: '54', text: 'Boing', groupType: 'sfx' },
        { id: '55', text: 'SPLURCH', groupType: 'sfx' },
        { id: '56', text: 'Splooge', groupType: 'sfx' },
        { id: '57', text: 'S-sory..,,', groupType: 'balloon' },
        { id: '58', text: 'Grinc', groupType: 'sfx' },
        { id: '59', text: 'Twire', groupType: 'balloon' },
        { id: '60', text: 'flowing...', groupType: 'balloon' },
        { id: '61', text: 'SPlAT', groupType: 'sfx' },
        { id: '62', text: 'PSV', groupType: 'sfx' },
        { id: '63', text: 'Splurty', groupType: 'sfx' },
        { id: '64', text: 'Splorgey', groupType: 'sfx' },
        { id: '65', text: 'Splooge\'v', groupType: 'sfx' },
        { id: '66', text: 'seueeze', groupType: 'sfx' },
        { id: '67', text: 'qweleh', groupType: 'sfx' },
        { id: '68', text: 'CiCK', groupType: 'sfx' },
        { id: '69', text: 'suchthick', groupType: 'balloon' },
        { id: '70', text: 'My cervix.', groupType: 'balloon' },
        { id: '71', text: 'Waiggle', groupType: 'balloon' },
        { id: '72', text: 'nstrict..', groupType: 'balloon' },
        { id: '73', text: 'LMAO', groupType: 'balloon' },
        { id: '74', text: 'sluttiest', groupType: 'balloon' },
        { id: '75', text: '\'aight.D', groupType: 'balloon' }
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
        '25': 'แต่ในทุกยุคสมัย...',
        '26': 'มากกกกว่าาาานี้',
        '27': 'ได้โปรด ดดดดดด',
        '28': 'บอกเรื่องของเขา',
        '29': 'พวกบาบาเรียน',
        '30': 'กรีดร้อง',
        '31': 'หยุดดดด!',
        '32': 'หยุดดดด',
        '33': 'ว่ามัน',
        '34': 'แกอยู่ข้างหน้า',
        '35': 'แกอยู่ข้างหน้า',
        '36': 'ท้องแล้ว!',
        '37': 'น้ำหนัก',
        '38': 'จะระเบิดแล้ว',
        '39': 'หมูแม่พันธุ์ที่กำลังตั้งท้อง',
        '40': 'ขอโทษษษ',
        '41': 'ไม่นะะะะ',
        '42': 'เธอมี...',
        '43': 'โอ้! โอ้!',
        '44': 'สนาม',
        '45': 'คุณมากิมะ',
        '46': 'ตับบ',
        '47': 'กระสอบแม่พันธุ์',
        '48': 'น้ำอสุจิ...',
        '49': 'หนังโป๊ตลาดมืดเรื่องนี้',
        '50': 'เพื่อให้เขาสามารถ',
        '51': 'จะแตกแล้ว!',
        '52': 'เอี๊ยดด',
        '53': 'กลิ้งง',
        '54': 'ดึ๋งง',
        '55': 'พรวดด',
        '56': 'พรวดดด',
        '57': 'ข-ขอโทษนะ...',
        '58': 'บดด',
        '59': 'กระตุก',
        '60': 'ไหลริน...',
        '61': 'แปะะ',
        '62': 'ฟู่...',
        '63': 'พรวดด',
        '64': 'พรวดดด',
        '65': 'พรวดดด',
        '66': 'บีบเค้น',
        '67': 'ปรื๊ด',
        '68': 'แพล๊บ',
        '69': 'ข้นขนาดนี้',
        '70': 'มดลูกของฉัน.',
        '71': 'ดิ้นไปมา',
        '72': 'บีบรัด...',
        '73': 'ก๊ากๆ',
        '74': 'อีตัวที่สุด',
        '75': 'โอเค๊',
      };

      Object.entries(expected).forEach(([id, val]) => {
        const item = results.find(r => r.id === id);
        expect(item?.translatedText).toBe(val);
        expect(item?.success).toBe(true);
      });
    });

    it('successfully translates all user-reported Spanish manga phrases', async () => {
      const items: Array<{ id: string; text: string; groupType: 'balloon' | 'sfx' }> = [
        { id: 'es1', text: 'BANAS...', groupType: 'balloon' },
        { id: 'es2', text: 'TELO..', groupType: 'balloon' },
        { id: 'es3', text: 'ZARME...', groupType: 'balloon' },
        { id: 'es4', text: 'MEEE...!!', groupType: 'balloon' },
        { id: 'es5', text: 'CHO...', groupType: 'balloon' },
        { id: 'es6', text: 'E-ES QUE', groupType: 'balloon' },
        { id: 'es7', text: 'MONTON..', groupType: 'balloon' },
        { id: 'es8', text: 'CIONANTE...', groupType: 'balloon' },
        { id: 'es9', text: 'MENTE ODIOSO...', groupType: 'balloon' },
        { id: 'es10', text: 'GUENZA, NO', groupType: 'balloon' },
        { id: 'es11', text: 'ZAS...', groupType: 'sfx' },
        { id: 'es12', text: 'MENTE CALIENTES Y', groupType: 'balloon' },
        { id: 'es13', text: 'TELO', groupType: 'balloon' },
        { id: 'es14', text: 'ZARME', groupType: 'balloon' },
      ];

      const results = await translationCoordinator.runTranslation('argos', items, {
        sourceLanguage: 'es',
        targetLanguage: 'th',
        translationMode: 'official',
        translateBatchOffline: vi.fn(),
      });

      const expected: Record<string, string> = {
        'es1': 'อาบน้ำ...',
        'es2': 'บอกคุณ..',
        'es3': 'กอดฉัน...',
        'es4': 'ฉันนน...!!',
        'es5': 'มาก...',
        'es6': 'คื-คือว่า...',
        'es7': 'ตั้งเยอะ..',
        'es8': 'น่าตื่นเต้น...',
        'es9': 'น่าเกลียดจริงๆ...',
        'es10': 'น่าอับอาย ไม่นะ',
        'es11': 'ฉับ!...',
        'es12': 'รู้สึกอุ่นและ...',
        'es13': 'บอกคุณ',
        'es14': 'กอดฉัน',
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
        '<page_dialogue>\n<balloon id="1">สวัสดี</balloon>\n<sfx id="2">เฟี้ยว!</sfx>\n</page_dialogue>',
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

      // translateBatchGemini should receive single bundled XML payload containing 'Hello' (as <balloon>) and 'ZOOM' (as <sfx>)
      // 'BOOM' should be resolved locally
      expect(mockTranslateBatchGemini).toHaveBeenCalledWith(
        ['<page_dialogue>\n<balloon id="1">Hello</balloon>\n<sfx id="2">ZOOM</sfx>\n</page_dialogue>'],
        'batch-markdown',
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
