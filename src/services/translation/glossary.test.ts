import { describe, it, expect, beforeEach } from 'vitest';
import { useGlossaryStore } from '../../stores/useGlossaryStore';
import { lookupShortPhraseTh } from './offlineTranslationService';

describe('Dynamic Glossary & Translation Memory System', () => {
  beforeEach(() => {
    useGlossaryStore.setState({ entries: [], isLoaded: true });
  });

  describe('useGlossaryStore Operations', () => {
    it('adds new glossary entry and stores it in state', async () => {
      const { addEntry } = useGlossaryStore.getState();

      await addEntry({
        sourceText: '선배',
        targetText: 'รุ่นพี่สุดหล่อ',
        sourceLang: 'ko',
        targetLang: 'th',
        type: 'TERM',
      });

      const entries = useGlossaryStore.getState().entries;
      expect(entries).toHaveLength(1);
      expect(entries[0].sourceText).toBe('선배');
      expect(entries[0].targetText).toBe('รุ่นพี่สุดหล่อ');
      expect(entries[0].sourceLang).toBe('ko');
      expect(entries[0].isActive).toBe(true);
    });

    it('toggles glossary entry active state', async () => {
      const { addEntry, toggleEntry } = useGlossaryStore.getState();

      await addEntry({
        sourceText: 'joder',
        targetText: 'เชี่ยเอ๊ย!',
        sourceLang: 'es',
        type: 'TERM',
      });

      const entryId = useGlossaryStore.getState().entries[0].id;
      await toggleEntry(entryId);
      expect(useGlossaryStore.getState().entries[0].isActive).toBe(false);

      await toggleEntry(entryId);
      expect(useGlossaryStore.getState().entries[0].isActive).toBe(true);
    });

    it('removes entry from store', async () => {
      const { addEntry, removeEntry } = useGlossaryStore.getState();

      await addEntry({
        sourceText: 'test word',
        targetText: 'คำทดสอบ',
        type: 'TERM',
      });

      const entryId = useGlossaryStore.getState().entries[0].id;
      await removeEntry(entryId);
      expect(useGlossaryStore.getState().entries).toHaveLength(0);
    });

    it('exports and imports entries as JSON and CSV', async () => {
      const { addEntry, exportEntries, importEntries } = useGlossaryStore.getState();

      await addEntry({
        sourceText: 'boom',
        targetText: 'ตู้มมม',
        type: 'SFX',
      });

      const jsonExport = exportEntries('json');
      expect(jsonExport).toContain('boom');
      expect(jsonExport).toContain('ตู้มมม');

      const csvExport = exportEntries('csv');
      expect(csvExport).toContain('"boom","ตู้มมม"');

      // Clear and re-import
      useGlossaryStore.setState({ entries: [] });
      await importEntries([
        {
          sourceText: 'imported word',
          targetText: 'คำนำเข้า',
          sourceLang: 'en',
          targetLang: 'th',
          type: 'TERM',
          isActive: true,
        },
      ]);

      expect(useGlossaryStore.getState().entries).toHaveLength(1);
      expect(useGlossaryStore.getState().entries[0].sourceText).toBe('imported word');
    });
  });

  describe('lookupShortPhraseTh with User Glossary Priority', () => {
    it('prioritizes user glossary entry over default dictionary', () => {
      useGlossaryStore.setState({
        entries: [
          {
            id: '1',
            sourceText: 'senpai',
            targetText: 'รุ่นพี่ที่เคารพรัก',
            sourceLang: 'en',
            targetLang: 'th',
            type: 'TERM',
            isActive: true,
          },
        ],
      });

      const result = lookupShortPhraseTh('senpai');
      expect(result).toBe('รุ่นพี่ที่เคารพรัก');
    });

    it('respects language filter when looking up short phrases', () => {
      useGlossaryStore.setState({
        entries: [
          {
            id: '1',
            sourceText: 'con',
            targetText: 'กับ / ด้วย (สเปน)',
            sourceLang: 'es',
            targetLang: 'th',
            type: 'TERM',
            isActive: true,
          },
        ],
      });

      // Matching sourceLang 'es' -> returns user translation
      expect(lookupShortPhraseTh('con', 'es')).toBe('กับ / ด้วย (สเปน)');

      // Not matching sourceLang 'en' -> falls back to standard dictionary or null
      const nonEsResult = lookupShortPhraseTh('con', 'en');
      expect(nonEsResult).not.toBe('กับ / ด้วย (สเปน)');
    });

    it('translates Spanish colloquialisms and OCR fragments correctly', () => {
      expect(lookupShortPhraseTh('da al agua', 'es')).toBe('ลงสู่น้ำ!');
      expect(lookupShortPhraseTh('mejor', 'es')).toBe('ดีกว่า');
      expect(lookupShortPhraseTh('montado', 'es')).toBe('ขี่แล้ว!');
      expect(lookupShortPhraseTh('recido!!', 'es')).toBe('ดูเหมือนว่า!!');
      expect(lookupShortPhraseTh('brepasaron', 'es')).toBe('ก้าวข้ามไปแล้ว');
      expect(lookupShortPhraseTh('miento...?', 'es')).toBe('ฉันโกหกเหรอ...?');
      expect(lookupShortPhraseTh('tadores', 'es')).toBe('ผู้ชม');
      expect(lookupShortPhraseTh('condidas', 'es')).toBe('แอบซ่อน');
      expect(lookupShortPhraseTh('tarlo?', 'es')).toBe('ทำมันเหรอ?');
    });

    it('ignores inactive glossary entries', () => {
      useGlossaryStore.setState({
        entries: [
          {
            id: '1',
            sourceText: 'custom_disabled',
            targetText: 'ปิดใช้งานอยู่',
            sourceLang: 'all',
            targetLang: 'th',
            type: 'TERM',
            isActive: false,
          },
        ],
      });

      const result = lookupShortPhraseTh('custom_disabled');
      expect(result).toBeNull();
    });
  });
});
