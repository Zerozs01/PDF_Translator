import { describe, it, expect, beforeEach, vi } from 'vitest';
import { translationCoordinator } from './translationCoordinator';
import { TranslatableItem } from '../../types/translation';

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
