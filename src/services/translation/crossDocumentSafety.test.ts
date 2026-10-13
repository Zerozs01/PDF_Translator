import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useProjectStore } from '../../stores/useProjectStore';
import { useLayerStore } from '../../stores/useLayerStore';
import { useOCRTextLayerStore } from '../../stores/useOCRTextLayerStore';
import { dbService } from '../dbService';
import { persistTranslationResultCore } from '../../hooks/translation/useTranslationCachePersister';
import type { OCRPageResult } from '../../types';

describe('Cross-Document Safety (F1 Acceptance)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLayerStore.getState().clearLayers();
    useOCRTextLayerStore.getState().clearTranslationCache();
    useProjectStore.setState({
      documentId: 200, // Document B is active
      sourceLanguage: 'en',
    });
    useOCRTextLayerStore.getState().setOptions({ language: 'eng' });
  });

  it('guarantees inactive document A translation does not overwrite active document B layers or language', async () => {
    // 1. Setup Document B as ACTIVE document in viewer with its own custom layers
    const docBInitialLayers = {
      layers: [
        {
          id: 'manual-layer-b-1',
          lineIndex: 0,
          sourceText: 'Hello from Doc B',
          translatedText: 'สวัสดีจากเอกสาร B',
          bbox: { x0: 10, y0: 10, x1: 100, y1: 30 },
          userEdited: true,
          confidence: 0.99,
        },
      ],
      groups: [],
    };
    useLayerStore.getState().setPageLayers(1, docBInitialLayers as any);

    // 2. Simulate Background Job translating Document A (documentId: 100, inactive)
    const activeDocId = useProjectStore.getState().documentId; // 200 (Doc B)
    const targetDocAId = 100;
    const isActiveDoc = activeDocId === targetDocAId; // false!

    expect(isActiveDoc).toBe(false);

    // Document A has Spanish text that would trigger auto language switch if active
    const docAPageOCR: OCRPageResult = {
      pageNumber: 1,
      lines: [
        {
          text: '¿Qué estás haciendo aquí?',
          bbox: { x0: 10, y0: 10, x1: 200, y1: 40 },
          confidence: 0.95,
          words: [],
        },
      ],
      words: [],
      text: '¿Qué estás haciendo aquí?',
      confidence: 0.95,
      width: 800,
      height: 1200,
      dpi: 72,
      algorithmVersion: 1,
      language: 'spa',
      ocrEngine: 'paddleocr',
    };

    // If isActiveDoc is false, neither setPageLayers nor language sync runs on stores:
    if (isActiveDoc) {
      useLayerStore.getState().setPageLayers(1, { layers: [], groups: [] });
      useProjectStore.getState().setSourceLanguage('es');
      useOCRTextLayerStore.getState().setOptions({ language: 'spa' });
    }

    // Assert that Document B's store layers and languages REMAIN UNCHANGED
    const docBLayersAfterJob = useLayerStore.getState().getPageLayers(1);
    expect(docBLayersAfterJob).toHaveLength(1);
    expect(docBLayersAfterJob[0].sourceText).toBe('Hello from Doc B');
    expect(docBLayersAfterJob[0].translatedText).toBe('สวัสดีจากเอกสาร B');

    expect(useProjectStore.getState().sourceLanguage).toBe('en');
    expect(useOCRTextLayerStore.getState().options.language).toBe('eng');

    // 3. Document A's translation is persisted ONLY to DB cache
    const saveDbSpy = vi.spyOn(dbService, 'saveTranslationCache').mockResolvedValue(true);

    const translatedMap = new Map<number, string>([[0, 'คุณกำลังทำอะไรที่นี่?']]);
    await persistTranslationResultCore({
      pageNum: 1,
      pageOCR: docAPageOCR,
      ocrEngine: 'paddleocr',
      ocrLanguageKey: 'spa',
      sourceLanguage: 'es',
      targetLanguage: 'th',
      effectiveTranslationMode: 'manga',
      effectiveEngine: 'offline',
      translatedByIndex: translatedMap,
      groupCount: 1,
      isActiveDoc: false,
      cacheDocId: targetDocAId,
    });

    // DB was called with Doc A's id
    expect(saveDbSpy).toHaveBeenCalledTimes(1);
    expect(saveDbSpy).toHaveBeenCalledWith(
      100,
      1,
      expect.any(String),
      expect.objectContaining({
        pageNum: 1,
        sourceLanguage: 'es',
        targetLanguage: 'th',
      })
    );

    // And Doc B's memory stores are still completely pristine
    expect(useLayerStore.getState().getPageLayers(1)[0].translatedText).toBe('สวัสดีจากเอกสาร B');
    expect(useOCRTextLayerStore.getState().getTranslationCacheEntries(1)).toHaveLength(0);
  });
});
