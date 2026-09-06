import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { translationCoordinator, M2M100TranslationEngine } from './translationCoordinator';
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
        { id: '75', text: '\'aight.D', groupType: 'balloon' },
        { id: '76', text: 'SNA', groupType: 'sfx' },
        { id: '77', text: 'CRACK', groupType: 'sfx' },
        { id: '78', text: 'Iburrpe', groupType: 'sfx' },
        { id: '79', text: 'pipun', groupType: 'sfx' },
        { id: '80', text: 'witeh', groupType: 'balloon' },
        { id: '81', text: 'AM A ZINGR', groupType: 'balloon' },
        { id: '82', text: 'wonbooo', groupType: 'balloon' },
        { id: '83', text: 'sostrange', groupType: 'balloon' },
        { id: '84', text: 'piston pounded!', groupType: 'balloon' },
        { id: '85', text: 'Kunk', groupType: 'sfx' },
        { id: '86', text: 'Holam', groupType: 'balloon' },
        { id: '87', text: 'Wipe...', groupType: 'sfx' },
        { id: '88', text: 'good+grief...', groupType: 'balloon' },
        { id: '89', text: 'Srind', groupType: 'sfx' },
        { id: '90', text: 'SPLRG', groupType: 'sfx' },
        { id: '91', text: 'Splurcct', groupType: 'sfx' },
        { id: '92', text: 'Suky', groupType: 'sfx' },
        { id: '93', text: 'Miss Makima\'s womb', groupType: 'balloon' },
        { id: '94', text: 'more honest+with me~!', groupType: 'balloon' },
        { id: '95', text: 'buuuut', groupType: 'balloon' },
        { id: '96', text: 'Just from licking her nips', groupType: 'balloon' },
        { id: '97', text: 'THIS A DULTVIDEO', groupType: 'balloon' },
        { id: '98', text: 'circulated all', groupType: 'balloon' },
        { id: '99', text: 'around Tokyo,', groupType: 'balloon' },
        { id: '100', text: 'Mioro', groupType: 'sfx' }
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
        '48': 'น้ำกาม...',
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
        '76': 'ตอด',
        '77': 'แคร๊ก',
        '78': 'บล๊ออบบ',
        '79': 'พั่บ..พลั่บ',
        '80': 'กระตุก',
        '81': 'ยอดเยี่ยม',
        '82': 'มดลูก...',
        '83': 'แปลกจัง',
        '84': 'ลูกสูบกระแทก!',
        '85': 'ค...คั่ก',
        '86': 'ถือไว้',
        '87': 'เช็ด...',
        '88': 'โอ้ พระเจ้า...',
        '89': 'บดด',
        '90': 'บลั่กก',
        '91': 'พรู๊ดดด!',
        '92': 'จล๊วบ',
        '93': 'มดลูกของคุณมากิมา',
        '94': 'ซื่อสัตย์กับฉันมากกว่านี้หน่อย~!',
        '95': 'แต่ว่าาาา',
        '96': 'แค่เพียงเลียหัวนมของเธอเท่านั้น',
        '97': 'วิดีโอสำหรับผู้ใหญ่นี้',
        '98': 'เผยแพร่ทั้งหมด',
        '99': 'รอบๆ โตเกียว,',
        '100': 'กล็อบ',
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
        { id: 'es15', text: 'TEANDOLE?', groupType: 'balloon' },
        { id: 'es16', text: 'TENTARLO?', groupType: 'balloon' },
        { id: 'es17', text: 'BROS...', groupType: 'balloon' },
        { id: 'es18', text: 'TREVISTARON', groupType: 'balloon' },
        { id: 'es19', text: 'SOLACION...', groupType: 'balloon' },
        { id: 'es20', text: 'CREIBLE.SiUNNIESE', groupType: 'balloon' },
        { id: 'es21', text: 'CANSANDO...', groupType: 'balloon' },
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
        'es15': 'เย้ายวนเขาเหรอ?',
        'es16': 'ลองดูไหม?',
        'es17': 'พวกพ้อง...',
        'es18': 'สัมภาษณ์แล้ว',
        'es19': 'ความสิ้นหวัง...',
        'es20': 'น่าเชื่อถือ ถ้าหากรวมตัวกัน',
        'es21': 'เหนื่อยล้า...',
      };

      Object.entries(expected).forEach(([id, val]) => {
        const item = results.find(r => r.id === id);
        expect(item?.translatedText).toBe(val);
        expect(item?.success).toBe(true);
      });

      const spanishNewItems: Array<{ id: string; text: string; groupType: 'balloon' | 'sfx' }> = [
        { id: 'sn1', text: 'TRAJE DE SIRVIENTA?', groupType: 'balloon' },
        { id: 'sn2', text: 'LAPRIVACIDADDEERICH.', groupType: 'balloon' },
        { id: 'sn3', text: 'EDAD:DESCONOCIDA.', groupType: 'balloon' },
        { id: 'sn4', text: 'MADRUGADA?', groupType: 'balloon' },
        { id: 'sn5', text: 'SOLO UNA', groupType: 'balloon' },
        { id: 'sn6', text: 'SECORRA', groupType: 'balloon' },
        { id: 'sn7', text: 'DENTRODETI', groupType: 'balloon' },
        { id: 'sn8', text: 'TECREERE.', groupType: 'balloon' },
        { id: 'sn9', text: 'ESCAPA!', groupType: 'balloon' },
        { id: 'sn10', text: 'COSA QLE', groupType: 'balloon' },
        { id: 'sn11', text: 'CONEL', groupType: 'balloon' },
        { id: 'sn12', text: 'METERTELA!O', groupType: 'balloon' },
        { id: 'sn13', text: 'ANTOJO.', groupType: 'balloon' },
        { id: 'sn14', text: 'iTE JURO QUE', groupType: 'balloon' },
        { id: 'sn15', text: 'iOH!,iAHi!', groupType: 'balloon' },
        { id: 'sn16', text: 'DEUNA', groupType: 'balloon' },
        { id: 'sn17', text: 'MANANA3', groupType: 'balloon' },
        { id: 'sn18', text: 'MEHAGA', groupType: 'balloon' },
        { id: 'sn19', text: 'QUE TU', groupType: 'balloon' },
        { id: 'sn20', text: 'DE CERA ES', groupType: 'balloon' },
        { id: 'sn21', text: 'HACERME', groupType: 'balloon' },
        { id: 'sn22', text: 'ESPERAR', groupType: 'balloon' },
        { id: 'sn23', text: 'HiAHHHOO!!', groupType: 'balloon' },
        { id: 'sn24', text: 'iiiiPOR,QUE?!!!', groupType: 'balloon' },
        { id: 'sn25', text: 'VERDAD?Y', groupType: 'balloon' },
        { id: 'sn26', text: 'GANAR CONTRA', groupType: 'balloon' },
        { id: 'sn27', text: 'POR QLEDAR', groupType: 'balloon' },
        { id: 'sn28', text: 'QUEINMADURO.', groupType: 'balloon' },
        { id: 'sn29', text: 'SEDEDICO', groupType: 'balloon' },
        { id: 'sn30', text: 'DEVECES', groupType: 'balloon' },
        { id: 'sn31', text: 'CABEZA', groupType: 'balloon' },
        { id: 'sn32', text: 'AMOVY', groupType: 'balloon' },
        { id: 'sn33', text: 'CUERPO...?', groupType: 'balloon' },
        { id: 'sn34', text: 'YMANTENEL', groupType: 'balloon' },
        { id: 'sn35', text: 'RITMO!', groupType: 'balloon' },
        { id: 'sn36', text: 'LLEGAR.', groupType: 'balloon' },
        { id: 'sn37', text: 'iME VENGO', groupType: 'balloon' },
        { id: 'sn38', text: 'QUSES', groupType: 'balloon' },
        { id: 'sn39', text: 'SIENTO,LO,SIENTO!', groupType: 'balloon' },
        { id: 'sn40', text: 'VENIRME!', groupType: 'balloon' },
        { id: 'sn41', text: 'AHOSER', groupType: 'balloon' },
        { id: 'sn42', text: 'PASA.', groupType: 'balloon' },
        { id: 'sn43', text: 'DEL PAiS...', groupType: 'balloon' },
        { id: 'sn44', text: 'POLLA?!', groupType: 'balloon' },
        { id: 'sn45', text: 'MI CONO', groupType: 'balloon' },
        { id: 'sn46', text: 'SUPUESTO.', groupType: 'balloon' },
        { id: 'sn47', text: 'DEMINI', groupType: 'balloon' },
        { id: 'sn48', text: 'CELA.', groupType: 'balloon' },
        { id: 'sn49', text: 'QUELLEVABA', groupType: 'balloon' },
        { id: 'sn50', text: 'CUERDO...?.', groupType: 'balloon' },
        { id: 'sn51', text: 'VENGO', groupType: 'balloon' },
        { id: 'sn52', text: 'CADERAS', groupType: 'balloon' },
        { id: 'sn53', text: 'VENGOD', groupType: 'balloon' },
        { id: 'sn54', text: 'IDEFINITIVAMENTE', groupType: 'balloon' },
        { id: 'sn55', text: 'ASiQUENO', groupType: 'balloon' },
        { id: 'sn56', text: 'HUMILLANTE!', groupType: 'balloon' },
        { id: 'sn57', text: 'CONLAS', groupType: 'balloon' },
        { id: 'sn58', text: 'SIENTO.', groupType: 'balloon' },
        { id: 'sn59', text: 'iAH...QUE', groupType: 'balloon' },
        { id: 'sn60', text: 'CORRO!', groupType: 'balloon' },
        { id: 'sn61', text: 'RUEGO...', groupType: 'balloon' },
        { id: 'sn62', text: 'DBNADA...', groupType: 'balloon' },
        { id: 'sn63', text: 'JUGANDO', groupType: 'balloon' },
        { id: 'sn64', text: 'CARICIAS', groupType: 'balloon' },
        { id: 'sn65', text: 'ORGASMO.', groupType: 'balloon' },
        { id: 'sn66', text: 'MEVENGO', groupType: 'balloon' },
        { id: 'sn67', text: 'SIENTO, LO', groupType: 'balloon' },
        { id: 'sn68', text: 'MEVENGOME', groupType: 'balloon' },
        { id: 'sn69', text: 'UNAPOLLA', groupType: 'balloon' },
        { id: 'sn70', text: 'HABITACION?', groupType: 'balloon' },
        { id: 'sn71', text: 'AHORAMISMONO', groupType: 'balloon' },
        { id: 'sn72', text: 'ESCENARIO', groupType: 'balloon' },
        { id: 'sn73', text: 'ELSENOR', groupType: 'balloon' },
      ];

      const spanishNewResults = await translationCoordinator.runTranslation('argos', spanishNewItems, {
        sourceLanguage: 'es',
        targetLanguage: 'th',
        translationMode: 'manga',
        translateBatchOffline: vi.fn(),
      });

      const newExpected: Record<string, string> = {
        'sn1': 'ชุดเมดเหรอ?',
        'sn2': 'เรื่องส่วนตัวของเอริช',
        'sn3': 'อายุ: ไม่ระบุ',
        'sn4': 'ตอนเช้ามืดเหรอ?',
        'sn5': 'แค่ครั้งเดียว',
        'sn6': 'เสร็จข้างใน',
        'sn7': 'ข้างในตัวเธอ',
        'sn8': 'ฉันถึงจะเชื่อเธอ',
        'sn9': 'หนีไป!',
        'sn10': 'สิ่งที่',
        'sn11': 'กับเขา',
        'sn12': 'ยัดเข้าไปในตัวเธอ!',
        'sn13': 'ตามใจอยาก',
        'sn14': 'ฉันขอสาบานเลยว่า',
        'sn15': 'โอ้!, ตรงนั้นแหละ!',
        'sn16': 'ในครั้งเดียว',
        'sn17': 'พรุ่งนี้',
        'sn18': 'ทำให้ฉัน',
        'sn19': 'ให้เธอ',
        'sn20': 'เป็นหุ่นขี้ผึ้ง',
        'sn21': 'ทำให้ฉัน',
        'sn22': 'รอ',
        'sn23': 'ฮิอ๊าาา!!',
        'sn24': 'ทำไมกัน?!!!',
        'sn25': 'จริงไหม? และ',
        'sn26': 'เอาชนะ',
        'sn27': 'เพื่อให้อยู่',
        'sn28': 'ช่างไม่รู้จักโตเลย.',
        'sn29': 'ทุ่มเทให้กับ',
        'sn30': 'เท่า / หลายครั้ง',
        'sn31': 'หัว',
        'sn32': 'นายท่าน',
        'sn33': 'ร่างกาย...?',
        'sn34': 'และรักษา',
        'sn35': 'จังหวะไว้!',
        'sn36': 'เข้าไปถึง.',
        'sn37': 'ฉันจะเสร็จแล้ว',
        'sn38': 'คืออะไร',
        'sn39': 'ขอโทษนะ ขอโทษจริงๆ!',
        'sn40': 'เสร็จข้างในฉัน!',
        'sn41': 'ถ้าไม่ใช่',
        'sn42': 'เกิดอะไรขึ้น.',
        'sn43': 'ของประเทศ...',
        'sn44': 'ควยเหรอ?!',
        'sn45': 'หีของฉัน',
        'sn46': 'แน่นอนอยู่แล้ว.',
        'sn47': 'ของฉัน',
        'sn48': 'เซร่า.',
        'sn49': 'ที่ใส่อยู่',
        'sn50': 'มีสติอยู่...?',
        'sn51': 'ฉันกำลังจะเสร็จ',
        'sn52': 'สะโพก',
        'sn53': 'ฉันกำลังจะเสร็จ',
        'sn54': 'อย่างแน่นอนที่สุด / ชัดเจนเลย',
        'sn55': 'เพราะฉะนั้นไม่',
        'sn56': 'น่าอับอายขายหน้า!',
        'sn57': 'ด้วย / กับ',
        'sn58': 'รู้สึก / ขอโทษ.',
        'sn59': 'อ๊า... ช่าง',
        'sn60': 'ฉันกำลังจะเสร็จ!',
        'sn61': 'ขอร้องล่ะ...',
        'sn62': 'ไม่เป็นไร...',
        'sn63': 'กำลังเล่น',
        'sn64': 'การลูบไล้',
        'sn65': 'ถึงจุดสุดยอด.',
        'sn66': 'ฉันจะเสร็จแล้ว',
        'sn67': 'ขอโทษนะ ฉัน',
        'sn68': 'ฉันจะเสร็จแล้ว ฉัน...',
        'sn69': 'ควย',
        'sn70': 'ห้องเหรอ?',
        'sn71': 'ตอนนี้ยังไม่',
        'sn72': 'ฉาก / สถานการณ์',
        'sn73': 'นายท่าน',
      };

      Object.entries(newExpected).forEach(([id, val]) => {
        const item = spanishNewResults.find(r => r.id === id);
        expect(item?.translatedText).toBe(val);
        expect(item?.success).toBe(true);
      });
    });

    it('successfully translates newly requested medical/erotic manga phrases and SFX', async () => {
      const items: Array<{ id: string; text: string; groupType: 'balloon' | 'sfx' }> = [
        { id: 'm1', text: 'GH...!', groupType: 'sfx' },
        { id: 'm2', text: 'MOVING!!', groupType: 'sfx' },
        { id: 'm3', text: 'CAME...', groupType: 'sfx' },
        { id: 'm4', text: 'THEN WHY', groupType: 'balloon' },
        { id: 'm5', text: 'SEXUAL INTERCOURSE DEFICIENCY OF THE GENITALS DISEASE', groupType: 'balloon' },
        { id: 'm6', text: "IT'S A DISEASE IN WHICH YOU HAVE TO RELEASE A LOT OF SPERM OR IT COULD BE FATAL", groupType: 'balloon' },
        { id: 'm7', text: "it's more efficient and produces high quality sperm.", groupType: 'balloon' },
        { id: 'm8', text: 'BY HAVING SEX WITH A WOMAN,', groupType: 'balloon' },
        { id: 'm9', text: 'What the hell kind of convenient straight out of an ero-manga disease is that ..!?', groupType: 'balloon' },
        { id: 'm10', text: 'CONTINUE THE TREATMENT', groupType: 'balloon' },
        { id: 'm11', text: 'I MADE A FEW MODIFICATIONS TO THE ROOM', groupType: 'balloon' },
        { id: 'm12', text: 'A-All RIGHT!', groupType: 'balloon' },
        { id: 'm13', text: 'so good', groupType: 'balloon' },
        { id: 'm14', text: 'TREATMENT', groupType: 'balloon' },
        { id: 'm15', text: 'SUCKING', groupType: 'balloon' },
        { id: 'm16', text: 'DISCOUR-', groupType: 'balloon' },
        { id: 'm17', text: '(ME,THERE)', groupType: 'balloon' },
        { id: 'm18', text: 'THEN.WE SHOULD', groupType: 'balloon' },
        { id: 'm19', text: 'Suvvenlya', groupType: 'balloon' },
        { id: 'm20', text: 'Bvt', groupType: 'balloon' },
        { id: 'm21', text: 'BOYFRIEND', groupType: 'balloon' },
        { id: 'm22', text: 'BOYFRIEND!', groupType: 'balloon' },
        { id: 'm23', text: 'BIG', groupType: 'balloon' },
        { id: 'm24', text: 'INTERESTING', groupType: 'balloon' },
        { id: 'm25', text: 'TO ME tOVAy.', groupType: 'balloon' },
        { id: 'm26', text: 'SATISFY', groupType: 'balloon' },
        { id: 'm27', text: 'Miki Yuka (28).', groupType: 'balloon' },
        { id: 'm28', text: 'LET IT OUT', groupType: 'balloon' },
        { id: 'm29', text: 'LOOSE', groupType: 'balloon' },
        { id: 'm30', text: 'AIr bath.', groupType: 'balloon' },
        { id: 'm31', text: "YUKA-CHAN, I'LL", groupType: 'balloon' },
        { id: 'm32', text: 'CHAN', groupType: 'balloon' },
        { id: 'm33', text: 'LIMIT', groupType: 'balloon' },
        { id: 'm34', text: 'LOL SO LEWD', groupType: 'balloon' },
        { id: 'm35', text: 'WHAAAT', groupType: 'balloon' },
        { id: 'm36', text: 'Y-YES...', groupType: 'balloon' },
        { id: 'm37', text: 'PAINFUL', groupType: 'balloon' },
        { id: 'm38', text: 'THICK', groupType: 'balloon' },
        { id: 'm39', text: 'SOME-THING I SAID-', groupType: 'balloon' },
      ];

      const results = await translationCoordinator.runTranslation('argos', items, {
        sourceLanguage: 'en',
        targetLanguage: 'th',
        translationMode: 'official',
        translateBatchOffline: vi.fn(),
      });

      const expected: Record<string, string> = {
        'm1': 'อึ่ก!...',
        'm2': 'ขยับเขยื้อน!',
        'm3': 'เสร็จแล้ว...',
        'm4': 'แล้วทำไม',
        'm5': 'โรคความบกพร่องทางเพศของอวัยวะเพศ',
        'm6': 'นี่เป็นโรคที่คุณต้องหลั่งอสุจิออกมาเป็นจำนวนมาก มิเช่นนั้นอาจถึงแก่ชีวิตได้',
        'm7': 'วิธีนี้มีประสิทธิภาพมากกว่าและได้อสุจิคุณภาพสูง',
        'm8': 'โดยการมีเพศสัมพันธ์กับผู้หญิง,',
        'm9': 'โรคอะไรวะเนี่ย โรคที่เหมือนหลุดออกมาจากมังงะอีโรติกเลย...!?',
        'm10': 'ดำเนินการรักษาต่อไป',
        'm11': 'ฉันได้ทำการปรับเปลี่ยนห้องเล็กน้อย',
        'm12': 'ช-ชะ ใช่แล้ว!',
        'm13': 'รู้สึกดีมาก',
        'm14': 'การรักษา',
        'm15': 'ดูด',
        'm16': 'การสนทนา',
        'm17': '(ฉัน, ตรงนั้น)',
        'm18': 'ถ้าอย่างนั้นเราควรจะ',
        'm19': 'ทันใดนั้น',
        'm20': 'แต่',
        'm21': 'แฟน',
        'm22': 'แฟนหนุ่ม!',
        'm23': 'ใหญ่',
        'm24': 'น่าสนใจ',
        'm25': 'ให้ฉันในวันนี้.',
        'm26': 'ทำให้พึงพอใจ',
        'm27': 'มิกิ ยูกะ (28)',
        'm28': 'ปล่อยมันออกมา',
        'm29': 'โหลยโท่ย',
        'm30': 'อ่างตากอากาศ',
        'm31': 'ยูกะ-จัง ฉันจะ',
        'm32': 'จัง',
        'm33': 'ขีดจำกัด',
        'm34': 'ฮ่าๆๆ ลามกจังเลย',
        'm35': 'อ..อะไร',
        'm36': 'ช-ใช่...',
        'm37': 'เจ็บปวด',
        'm38': 'หนา',
        'm39': 'บางสิ่ง ที่ฉัน พูด-',
      };

      Object.entries(expected).forEach(([id, val]) => {
        const item = results.find(r => r.id === id);
        expect(item?.translatedText).toBe(val);
        expect(item?.success).toBe(true);
      });
    });

    it('successfully translates user requested batch including phrases, OCR repairs and SFX', async () => {
      const items: Array<{ id: string; text: string; groupType: 'balloon' | 'sfx' }> = [
        { id: 'u1', text: "WHAT'S THAT", groupType: 'balloon' },
        { id: 'u2', text: 'WHAT CUP SIZE', groupType: 'balloon' },
        { id: 'u3', text: 'NGH...', groupType: 'sfx' },
        { id: 'u4', text: 'MILITARY', groupType: 'balloon' },
        { id: 'u5', text: 'STOP', groupType: 'balloon' },
        { id: 'u6', text: "I'M FINE!", groupType: 'balloon' },
        { id: 'u7', text: 'SHUT IT!!', groupType: 'balloon' },
        { id: 'u8', text: 'Spread', groupType: 'sfx' },
        { id: 'u9', text: 'Shudder.s', groupType: 'sfx' },
        { id: 'u10', text: 'CUMMING AGAIN', groupType: 'balloon' },
        { id: 'u11', text: 'Pat', groupType: 'sfx' },
        { id: 'u12', text: 'Blurge', groupType: 'sfx' },
        { id: 'u13', text: 'PERHAPS?', groupType: 'balloon' },
        { id: 'u14', text: 'Pwah', groupType: 'sfx' },
        { id: 'u15', text: "TEACHER'S OFFICE", groupType: 'balloon' },
        { id: 'u16', text: 'YOU EJACULATE', groupType: 'balloon' },
        { id: 'u17', text: 'Splurge', groupType: 'sfx' },
        { id: 'u18', text: 'Twitcht', groupType: 'sfx' },
        { id: 'u19', text: 'HISSEMEN', groupType: 'balloon' },
        { id: 'u20', text: 'ISSTILLEAKING', groupType: 'balloon' },
        { id: 'u21', text: 'OUTOPME..', groupType: 'balloon' },
        { id: 'u22', text: 'HIS SEMEN IS STILL LEAKING OUT OF ME', groupType: 'balloon' },
        { id: 'u23', text: 'REALLY WANNA', groupType: 'balloon' },
        { id: 'u24', text: "(OUT, YUUTO! DON'T)", groupType: 'balloon' },
        { id: 'u25', text: '(SO, BASICALLY...)', groupType: 'balloon' },
        { id: 'u26', text: 'THIS..COULD BE...', groupType: 'balloon' },
        { id: 'u27', text: "YUUTO I'M SURE", groupType: 'balloon' },
        { id: 'u28', text: 'PRODUCT OF LUST', groupType: 'balloon' },
        { id: 'u29', text: "YUUTO'S MOM", groupType: 'balloon' },
        { id: 'u30', text: '(POSSESS, SEEMS)', groupType: 'balloon' },
        { id: 'u31', text: 'AHH..HOLY', groupType: 'balloon' },
        { id: 'u32', text: '(YO, YUUTO~)', groupType: 'balloon' },
        { id: 'u33', text: 'AH.. THIS', groupType: 'balloon' },
        { id: 'u34', text: 'THE PiG YOU ARE', groupType: 'balloon' },
        { id: 'u35', text: 'WOULD', groupType: 'balloon' },
        { id: 'u36', text: 'Smacky', groupType: 'sfx' },
        { id: 'u37', text: 'Slapy', groupType: 'sfx' },
        { id: 'u38', text: 'Rubr', groupType: 'sfx' },
        { id: 'u39', text: 'Coughe', groupType: 'sfx' },
        { id: 'u40', text: 'Pate', groupType: 'sfx' },
        { id: 'u41', text: 'MVFiutter', groupType: 'sfx' },
        { id: 'u42', text: 'IBET IVE', groupType: 'balloon' },
        { id: 'u43', text: 'THE SENSAT ...', groupType: 'balloon' },
        { id: 'u44', text: "OWON'TSAYNAUGHTY", groupType: 'balloon' },
        { id: 'u45', text: 'yyt', groupType: 'balloon' },
        { id: 'u46', text: 'QLIET!', groupType: 'balloon' },
        { id: 'u47', text: 'ACOWARD', groupType: 'balloon' },
        { id: 'u48', text: 'HER POSIT I ON', groupType: 'balloon' },
        { id: 'u49', text: 'SO.. BASICALLY...', groupType: 'balloon' },
        { id: 'u50', text: "GOING.. WE'LL LEAVE", groupType: 'balloon' },
        { id: 'u51', text: "(GOING.. WE'LL LEAVE)", groupType: 'balloon' },
        { id: 'u52', text: "SHIT.. THIS'", groupType: 'balloon' },
        { id: 'u53', text: 'PLEASURABLE… TO TAKE', groupType: 'balloon' },
        { id: 'u54', text: 'Sourge', groupType: 'sfx' },
        { id: 'u55', text: 'tAhn', groupType: 'sfx' },
        { id: 'u56', text: 'WHAT IS IT~~', groupType: 'balloon' },
        { id: 'u57', text: '..REALLY WANNA', groupType: 'balloon' },
        { id: 'u58', text: 'POSSESS, SEEMS', groupType: 'balloon' },
        { id: 'u59', text: '69', groupType: 'balloon' },
        { id: 'u60', text: "(YUUTO'S MOM)", groupType: 'balloon' },
      ];

      const results = await translationCoordinator.runTranslation('argos', items, {
        sourceLanguage: 'en',
        targetLanguage: 'th',
        translationMode: 'official',
        translateBatchOffline: vi.fn(),
      });

      const expected: Record<string, string> = {
        'u1': 'นั่นอะไรน่ะ',
        'u2': 'คัพไซส์อะไร',
        'u3': 'อึก...',
        'u4': 'ทหาร',
        'u5': 'หยุด',
        'u6': 'ฉันสบายดี!',
        'u7': 'หุบปากซะ!!',
        'u8': 'แหวก',
        'u9': 'สั่นสะท้าน',
        'u10': 'เสร็จอีกแล้ว',
        'u11': 'แปะ',
        'u12': 'บลั๊กก',
        'u13': 'บางทีนะ?',
        'u14': 'พวาห์',
        'u15': 'ห้องพักครู',
        'u16': 'คุณพุ่งน้ำกามออกมา',
        'u17': 'พรวดดด',
        'u18': 'กระตุก',
        'u19': 'น้ำอสุจิของเขา',
        'u20': 'ยังคงไหลออกมา',
        'u21': 'ออกมาจากฉัน..',
        'u22': 'น้ำอสุจิของเขายังคงไหลออกมาจากตัวฉัน',
        'u23': 'อยากจริงๆ',
        'u24': '(ออกไป ยูโตะ! อย่า)',
        'u25': '(สรุปก็คือ...)',
        'u26': 'นี่มัน..อาจจะเป็น...',
        'u27': 'ยูโตะ ฉันแน่ใจว่า',
        'u28': 'ผลผลิตแห่งราคะ',
        'u29': 'แม่ของยูโตะ',
        'u30': '(ดูเหมือนจะครอบงำ)',
        'u31': 'อ๊า..พระเจ้า',
        'u32': '(โย่ ยูโตะ~)',
        'u33': 'อ๊ะ.. นี่มัน',
        'u34': 'ไอ้หมูตอนอย่างแก',
        'u35': 'คงจะ',
        'u36': 'ตั่บ',
        'u37': 'แป๊ะ',
        'u38': 'ถู',
        'u39': 'ค่อก',
        'u40': 'แปะ',
        'u41': 'ฟลิ้ว',
        'u42': 'ฉันพนันได้เลยว่าฉันเคย',
        'u43': 'ความรู้สึก',
        'u44': 'ฉันจะไม่พูดว่า "ซุกซน"',
        'u45': 'อ๊าา',
        'u46': 'เงียบ!',
        'u47': 'คนขี้ขลาด',
        'u48': 'ตำแหน่งของเธอ',
        'u49': 'สรุปก็คือ...',
        'u50': 'ไปกันเถอะ.. เราจะปล่อยให้',
        'u51': '(ไปกันเถอะ.. เราจะปล่อยให้)',
        'u52': 'เชี่ยเอ๊ย.. นี่มัน',
        'u53': 'สุขสมเหลือเกิน...ที่จะได้รับ',
        'u54': 'พรวดดด',
        'u55': 'อ๊าา',
        'u56': 'อะไรเหรอ~~',
        'u57': 'อยากจริงๆ',
        'u58': 'ดูเหมือนจะครอบงำ',
        'u59': '69',
        'u60': '(แม่ของยูโตะ)',
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

  describe('Latest User-Requested Phrases & OCR Normalization', () => {
    it('translates Sciously, MINISCING, FWINE!, BRINGHER, DOESnt GEt, T-TAYAMA, YA-MA-DA, SASAKI, AMAZING', async () => {
      const items: TranslatableItem[] = [
        { id: '1', text: 'Sciously', groupType: 'balloon' },
        { id: '2', text: 'MINISCING', groupType: 'balloon' },
        { id: '3', text: 'FWINE!', groupType: 'balloon' },
        { id: '4', text: 'BRINGHER', groupType: 'balloon' },
        { id: '5', text: "DOESn't GEt", groupType: 'balloon' },
        { id: '6', text: 'T-TAYAMA-', groupType: 'balloon' },
        { id: '7', text: '(YA-MA-DA)', groupType: 'balloon' },
        { id: '8', text: 'SASAKI-', groupType: 'balloon' },
        { id: '9', text: 'AMAZING~', groupType: 'balloon' },
        { id: '10', text: 'FORTUNATE.HEAR.', groupType: 'balloon' },
        { id: '11', text: 'APOLOGIZE', groupType: 'balloon' },
        { id: '12', text: 'REGARDING', groupType: 'balloon' },
        { id: '13', text: 'ASSURED.', groupType: 'balloon' },
        { id: '14', text: 'OLD SENPAI', groupType: 'balloon' },
        { id: '15', text: 'CONFUSING', groupType: 'balloon' },
        { id: '16', text: 'NON-EXISTENTWELL...', groupType: 'balloon' },
        { id: '17', text: 'PRECIOUS', groupType: 'balloon' },
        { id: '18', text: 'now.a Married', groupType: 'balloon' },
        { id: '19', text: 'GOODMOOD', groupType: 'balloon' },
        { id: '20', text: 'THANKSFOR', groupType: 'balloon' },
        { id: '21', text: 'ONEE-SAN!', groupType: 'balloon' },
        { id: '22', text: 'SENPAI', groupType: 'balloon' },
        { id: '23', text: 'ALL THE Time...', groupType: 'balloon' },
        { id: '24', text: 'Ba-dum', groupType: 'sfx' },
        { id: '25', text: 'Mar-ried', groupType: 'balloon' },
        { id: '26', text: 'SORRY', groupType: 'balloon' },
        { id: '27', text: 'EVEN THOUGH', groupType: 'balloon' },
        { id: '28', text: "I DIDN'T", groupType: 'balloon' },
        { id: '29', text: 'IWASIN', groupType: 'balloon' },
        { id: '30', text: 'RumeL', groupType: 'sfx' },
        { id: '31', text: 'TAYAMA-', groupType: 'balloon' },
        { id: '32', text: 'SENPAL', groupType: 'balloon' },
        { id: '33', text: 'BLOCKHEAD', groupType: 'balloon' },
        { id: '34', text: '(GOOD,YOU)', groupType: 'balloon' },
        { id: '35', text: 'TOBUYSTUFF', groupType: 'balloon' },
        { id: '36', text: 'GRATEFLL', groupType: 'balloon' },
        { id: '37', text: 'DOINGP', groupType: 'balloon' },
        { id: '38', text: 'SAsaki-sanP', groupType: 'balloon' },
        { id: '39', text: 'RESOLUTE', groupType: 'balloon' },
        { id: '40', text: 'WELL', groupType: 'balloon' },
        { id: '41', text: 'HOW ABOUT', groupType: 'balloon' },
        { id: '42', text: 'HUH?', groupType: 'balloon' },
        { id: '43', text: 'AH~', groupType: 'balloon' },
        { id: '44', text: 'HMMM?', groupType: 'balloon' },
        { id: '45', text: 'LightLy', groupType: 'balloon' },
        { id: '46', text: "UM-BRELLA'S", groupType: 'balloon' },
        { id: '47', text: 'FILRTING', groupType: 'balloon' },
        { id: '48', text: 'TOMUSIC', groupType: 'balloon' },
        { id: '49', text: 'TOSONGS', groupType: 'balloon' },
        { id: '50', text: '(WAY,WHY)', groupType: 'balloon' },
        { id: '51', text: 'SHOULDI', groupType: 'balloon' },
        { id: '52', text: 'CORDIS', groupType: 'balloon' },
        { id: '53', text: 'Flick', groupType: 'sfx' },
        { id: '54', text: 'MYSELF"THEN', groupType: 'balloon' },
        { id: '55', text: 'ANDSTARTED', groupType: 'balloon' },
        { id: '56', text: 'MANAGER', groupType: 'balloon' },
        { id: '57', text: 'TOCOMPLETE', groupType: 'balloon' },
        { id: '58', text: "NEXTMONTH'S", groupType: 'balloon' },
        { id: '59', text: 'HASMADE', groupType: 'balloon' },
        { id: '60', text: 'EARTHIS', groupType: 'balloon' },
        { id: '61', text: 'FINIShED', groupType: 'balloon' },
        { id: '62', text: '(ROOM,WAS)', groupType: 'balloon' },
        { id: '63', text: 'teresting', groupType: 'balloon' },
        { id: '64', text: '"IT\'SFASTER', groupType: 'balloon' },
      ];

      const results = await translationCoordinator.runTranslation('argos', items, {
        sourceLanguage: 'en',
        targetLanguage: 'th',
        translationMode: 'official',
        translateBatchOffline: vi.fn(),
      });

      const resMap = new Map(results.map(r => [r.id, r.translatedText]));
      expect(resMap.get('1')).toBe('อย่างมีสติ');
      expect(resMap.get('2')).toBe('รำลึกความหลัง');
      expect(resMap.get('3')).toBe('ส-สบายดี๊!');
      expect(resMap.get('4')).toBe('พาเธอมา');
      expect(resMap.get('5')).toBe('ไม่เข้าใจ');
      expect(resMap.get('6')).toBe('ท-ทายามะ-');
      expect(resMap.get('7')).toBe('(ยา-มา-ดะ)');
      expect(resMap.get('8')).toBe('ซาซากิ-');
      expect(resMap.get('9')).toBe('สุดยอดเลย~');
      expect(resMap.get('10')).toBe('โชคดีที่ได้ยิน');
      expect(resMap.get('11')).toBe('ขอโทษ');
      expect(resMap.get('12')).toBe('เกี่ยวกับ');
      expect(resMap.get('13')).toBe('วางใจได้.');
      expect(resMap.get('14')).toBe('รุ่นพี่ที่เคยรู้จัก');
      expect(resMap.get('15')).toBe('สับสน');
      expect(resMap.get('16')).toBe('ไม่มีอยู่จริง...');
      expect(resMap.get('17')).toBe('ล้ำค่า');
      expect(resMap.get('18')).toBe('ตอนนี้แต่งงานแล้ว');
      expect(resMap.get('19')).toBe('อารมณ์ดี');
      expect(resMap.get('20')).toBe('ขอบคุณสำหรับ');
      expect(resMap.get('21')).toBe('พี่สาว!');
      expect(resMap.get('22')).toBe('รุ่นพี่');
      expect(resMap.get('23')).toBe('ตลอดเวลา...');
      expect(resMap.get('24')).toBe('ตึก-ตัก');
      expect(resMap.get('25')).toBe('แต่ง-งาน');
      expect(resMap.get('26')).toBe('ขอโทษ');
      expect(resMap.get('27')).toBe('ถึงแม้ว่า');
      expect(resMap.get('28')).toBe('ฉันไม่ได้ทำ');
      expect(resMap.get('29')).toBe('ฉันอยู่ใน');
      expect(resMap.get('30')).toBe('ครืน');
      expect(resMap.get('31')).toBe('ทายามะ-');
      expect(resMap.get('32')).toBe('รุ่นพี่');
      expect(resMap.get('33')).toBe('คนทึ่ม');
      expect(resMap.get('34')).toBe('(ดี, คุณ)');
      expect(resMap.get('35')).toBe('เพื่อซื้อของ');
      expect(resMap.get('36')).toBe('รู้สึกขอบคุณ');
      expect(resMap.get('37')).toBe('กำลังทำอะไรอยู่?');
      expect(resMap.get('38')).toBe('ซาซากิซัง?');
      expect(resMap.get('39')).toBe('เด็ดเดี่ยว');
      expect(resMap.get('40')).toBe('เอาล่ะ');
      expect(resMap.get('41')).toBe('แล้ว...ล่ะ');
      expect(resMap.get('42')).toBe('หา?');
      expect(resMap.get('43')).toBe('อ๊ะ~');
      expect(resMap.get('44')).toBe('หืมมม?');
      expect(resMap.get('45')).toBe('เบาๆ');
      expect(resMap.get('46')).toBe('ของร่ม');
      expect(resMap.get('47')).toBe('กำลังจีบ');
      expect(resMap.get('48')).toBe('กับเสียงเพลง');
      expect(resMap.get('49')).toBe('กับบทเพลง');
      expect(resMap.get('50')).toBe('(ทาง, ทำไม)');
      expect(resMap.get('51')).toBe('ฉันควรจะ');
      expect(resMap.get('52')).toBe('สายคือ');
      expect(resMap.get('53')).toBe('สะบัด');
      expect(resMap.get('54')).toBe('ตัวเอง" จากนั้น');
      expect(resMap.get('55')).toBe('และเริ่ม');
      expect(resMap.get('56')).toBe('ผู้จัดการ');
      expect(resMap.get('57')).toBe('เพื่อให้เสร็จสิ้น');
      expect(resMap.get('58')).toBe('ของเดือนหน้า');
      expect(resMap.get('59')).toBe('ได้ทำ');
      expect(resMap.get('60')).toBe('โลกคือ');
      expect(resMap.get('61')).toBe('เสร็จสิ้นแล้ว');
      expect(resMap.get('62')).toBe('(ห้อง, เคยเป็น)');
      expect(resMap.get('63')).toBe('น่าสนใจ');
      expect(resMap.get('64')).toBe('"มันเร็วกว่า');
    });
  });

  describe('M2M100TranslationEngine', () => {
    it('translates balloon layers with M2M100 and bypasses SFX using local dict', async () => {
      const mockTranslateBatchOffline = vi.fn().mockResolvedValue(['สวัสดี', 'โลก']);

      const items: TranslatableItem[] = [
        { id: '1', text: 'Hello', groupType: 'balloon' },
        { id: '2', text: 'BOOM', groupType: 'sfx' },
        { id: '3', text: 'World', groupType: 'balloon' },
      ];

      const results = await translationCoordinator.runTranslation('m2m100', items, {
        sourceLanguage: 'en',
        targetLanguage: 'th',
        translationMode: 'official',
        translateBatchOffline: mockTranslateBatchOffline,
      });

      expect(mockTranslateBatchOffline).toHaveBeenCalledWith(
        ['Hello', 'World'],
        'text',
        'official',
        'en',
        'th',
        'm2m100'
      );

      const sfxResult = results.find((r) => r.id === '2');
      expect(sfxResult?.translatedText).toBe('ตูม!');
      expect(sfxResult?.engineUsed).toBe('sfx-dict');

      const helloResult = results.find((r) => r.id === '1');
      expect(helloResult?.translatedText).toBe('สวัสดี');
      expect(helloResult?.engineUsed).toBe('m2m100');
    });

    it('applies Korean fallback when M2M100 returns untranslated Korean for Thai target', async () => {
      const engine = new M2M100TranslationEngine();
      // Mock M2M100 returning raw Korean untranslated
      const mockTranslateBatchOffline = vi.fn().mockResolvedValue(['오빠']);

      const items: TranslatableItem[] = [
        { id: '1', text: '오빠', groupType: 'balloon' },
      ];

      const results = await engine.translate(items, {
        sourceLanguage: 'ko',
        targetLanguage: 'th',
        translationMode: 'manhwa',
        translateBatchOffline: mockTranslateBatchOffline,
      });

      // Should fallback via applyKoreanConversationalFallback / lookupShortPhraseTh to 'พี่ชาย/โอปป้า'
      expect(results[0]?.translatedText).toMatch(/[\u0E00-\u0E7F]/);
      expect(results[0]?.engineUsed).toBe('m2m100');
    });
  });
});

