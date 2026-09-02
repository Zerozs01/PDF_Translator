import { describe, it, expect, beforeEach } from 'vitest';

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
  Object.defineProperty(global, 'window', { value: { localStorage: mockLocalStorage }, writable: true });
}

import { useUIStore } from './useUIStore';

describe('useUIStore - Accordion Toggle Persistence', () => {
  const OCR_LANGUAGES_KEY = 'pdf_translator.ocr_languages_section_open';
  const OCR_MODEL_KEY = 'pdf_translator.ocr_model_section_open';
  const OCR_TEXT_LAYER_KEY = 'pdf_translator.ocr_text_layer_open';

  beforeEach(() => {
    localStorage.clear();
  });

  it('should toggle and persist OCR Languages section state', () => {
    useUIStore.getState().setOcrLanguagesSectionOpen(false);
    expect(useUIStore.getState().isOcrLanguagesSectionOpen).toBe(false);
    expect(localStorage.getItem(OCR_LANGUAGES_KEY)).toBe('0');

    useUIStore.getState().toggleOcrLanguagesSection();
    expect(useUIStore.getState().isOcrLanguagesSectionOpen).toBe(true);
    expect(localStorage.getItem(OCR_LANGUAGES_KEY)).toBe('1');

    useUIStore.getState().toggleOcrLanguagesSection();
    expect(useUIStore.getState().isOcrLanguagesSectionOpen).toBe(false);
    expect(localStorage.getItem(OCR_LANGUAGES_KEY)).toBe('0');
  });

  it('should toggle and persist OCR Model section state', () => {
    useUIStore.getState().setOcrModelSectionOpen(false);
    expect(useUIStore.getState().isOcrModelSectionOpen).toBe(false);
    expect(localStorage.getItem(OCR_MODEL_KEY)).toBe('0');

    useUIStore.getState().toggleOcrModelSection();
    expect(useUIStore.getState().isOcrModelSectionOpen).toBe(true);
    expect(localStorage.getItem(OCR_MODEL_KEY)).toBe('1');

    useUIStore.getState().setOcrModelSectionOpen(false);
    expect(useUIStore.getState().isOcrModelSectionOpen).toBe(false);
    expect(localStorage.getItem(OCR_MODEL_KEY)).toBe('0');
  });

  it('should toggle and persist OCR Text Layer section state', () => {
    useUIStore.getState().setOcrTextLayerSectionOpen(false);
    expect(useUIStore.getState().isOcrTextLayerSectionOpen).toBe(false);
    expect(localStorage.getItem(OCR_TEXT_LAYER_KEY)).toBe('0');

    useUIStore.getState().toggleOcrTextLayerSection();
    expect(useUIStore.getState().isOcrTextLayerSectionOpen).toBe(true);
    expect(localStorage.getItem(OCR_TEXT_LAYER_KEY)).toBe('1');

    useUIStore.getState().toggleOcrTextLayerSection();
    expect(useUIStore.getState().isOcrTextLayerSectionOpen).toBe(false);
    expect(localStorage.getItem(OCR_TEXT_LAYER_KEY)).toBe('0');
  });
});
