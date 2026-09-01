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
      expect(lookupShortPhraseTh('TRAJE DE SIRVIENTA?', 'es')).toBe('ชุดเมดเหรอ?');
      expect(lookupShortPhraseTh('LAPRIVACIDADDEERICH.', 'es')).toBe('เรื่องส่วนตัวของเอริช');
      expect(lookupShortPhraseTh('EDAD:DESCONOCIDA.', 'es')).toBe('อายุ: ไม่ระบุ');
      expect(lookupShortPhraseTh('MADRUGADA?', 'es')).toBe('ตอนเช้ามืดเหรอ?');
      expect(lookupShortPhraseTh('SOLO UNA', 'es')).toBe('แค่ครั้งเดียว');
      expect(lookupShortPhraseTh('SECORRA', 'es')).toBe('เสร็จข้างใน');
      expect(lookupShortPhraseTh('DENTRODETI', 'es')).toBe('ข้างในตัวเธอ');
      expect(lookupShortPhraseTh('TECREERE.', 'es')).toBe('ฉันถึงจะเชื่อเธอ');
      expect(lookupShortPhraseTh('ESCAPA!', 'es')).toBe('หนีไป!');
      expect(lookupShortPhraseTh('COSA QLE', 'es')).toBe('สิ่งที่');
      expect(lookupShortPhraseTh('METERTELA!O', 'es')).toBe('ยัดเข้าไปในตัวเธอ!');
       expect(lookupShortPhraseTh('ANTOJO.', 'es')).toBe('ตามใจอยาก');
      expect(lookupShortPhraseTh('iTE JURO QUE', 'es')).toBe('ฉันขอสาบานเลยว่า');
      expect(lookupShortPhraseTh('iOH!,iAHi!', 'es')).toBe('โอ้!, ตรงนั้นแหละ!');
      expect(lookupShortPhraseTh('DEUNA', 'es')).toBe('ในครั้งเดียว');
      expect(lookupShortPhraseTh('MANANA3', 'es')).toBe('พรุ่งนี้');
      expect(lookupShortPhraseTh('MEHAGA', 'es')).toBe('ทำให้ฉัน');
      expect(lookupShortPhraseTh('QUE TU', 'es')).toBe('ให้เธอ');
      expect(lookupShortPhraseTh('DE CERA ES', 'es')).toBe('เป็นหุ่นขี้ผึ้ง');
      expect(lookupShortPhraseTh('HACERME', 'es')).toBe('ทำให้ฉัน');
      expect(lookupShortPhraseTh('ESPERAR', 'es')).toBe('รอ');
      expect(lookupShortPhraseTh('HiAHHHOO!!', 'es')).toBe('ฮิอ๊าาา!!');
      expect(lookupShortPhraseTh('iiiiPOR,QUE?!!!', 'es')).toBe('ทำไมกัน?!!!');
      expect(lookupShortPhraseTh('VERDAD?Y', 'es')).toBe('จริงไหม? และ');
      expect(lookupShortPhraseTh('GANAR CONTRA', 'es')).toBe('เอาชนะ');
      expect(lookupShortPhraseTh('POR QLEDAR', 'es')).toBe('เพื่อให้อยู่');
      expect(lookupShortPhraseTh('QUEINMADURO.', 'es')).toBe('ช่างไม่รู้จักโตเลย.');
      expect(lookupShortPhraseTh('SEDEDICO', 'es')).toBe('ทุ่มเทให้กับ');
      expect(lookupShortPhraseTh('DEVECES', 'es')).toBe('เท่า / หลายครั้ง');
      expect(lookupShortPhraseTh('CABEZA', 'es')).toBe('หัว');
      expect(lookupShortPhraseTh('AMOVY', 'es')).toBe('นายท่าน');
      expect(lookupShortPhraseTh('CUERPO...?', 'es')).toBe('ร่างกาย...?');
      expect(lookupShortPhraseTh('YMANTENEL', 'es')).toBe('และรักษา');
      expect(lookupShortPhraseTh('RITMO!', 'es')).toBe('จังหวะไว้!');
      expect(lookupShortPhraseTh('LLEGAR.', 'es')).toBe('เข้าไปถึง.');
      expect(lookupShortPhraseTh('iME VENGO', 'es')).toBe('ฉันจะเสร็จแล้ว');
      expect(lookupShortPhraseTh('QUSES', 'es')).toBe('คืออะไร');
      expect(lookupShortPhraseTh('SIENTO,LO,SIENTO!', 'es')).toBe('ขอโทษนะ ขอโทษจริงๆ!');
      expect(lookupShortPhraseTh('VENIRME!', 'es')).toBe('เสร็จข้างในฉัน!');
      expect(lookupShortPhraseTh('AHOSER', 'es')).toBe('ถ้าไม่ใช่');
      expect(lookupShortPhraseTh('PASA.', 'es')).toBe('เกิดอะไรขึ้น.');
      expect(lookupShortPhraseTh('DEL PAiS...', 'es')).toBe('ของประเทศ...');
      expect(lookupShortPhraseTh('POLLA?!', 'es')).toBe('ควยเหรอ?!');
      expect(lookupShortPhraseTh('MI CONO', 'es')).toBe('หีของฉัน');
      expect(lookupShortPhraseTh('SUPUESTO.', 'es')).toBe('แน่นอนอยู่แล้ว.');
      expect(lookupShortPhraseTh('DEMINI', 'es')).toBe('ของฉัน');
      expect(lookupShortPhraseTh('CELA.', 'es')).toBe('เซร่า.');
      expect(lookupShortPhraseTh('QUELLEVABA', 'es')).toBe('ที่ใส่อยู่');
      expect(lookupShortPhraseTh('CUERDO...?.', 'es')).toBe('มีสติอยู่...?');
      expect(lookupShortPhraseTh('VENGO', 'es')).toBe('ฉันกำลังจะเสร็จ');
      expect(lookupShortPhraseTh('CADERAS', 'es')).toBe('สะโพก');
      expect(lookupShortPhraseTh('VENGOD', 'es')).toBe('ฉันกำลังจะเสร็จ');
      expect(lookupShortPhraseTh('IDEFINITIVAMENTE', 'es')).toBe('อย่างแน่นอนที่สุด / ชัดเจนเลย');
      expect(lookupShortPhraseTh('ASiQUENO', 'es')).toBe('เพราะฉะนั้นไม่');
      expect(lookupShortPhraseTh('HUMILLANTE!', 'es')).toBe('น่าอับอายขายหน้า!');
      expect(lookupShortPhraseTh('CONLAS', 'es')).toBe('ด้วย / กับ');
      expect(lookupShortPhraseTh('SIENTO.', 'es')).toBe('รู้สึก / ขอโทษ.');
      expect(lookupShortPhraseTh('iAH...QUE', 'es')).toBe('อ๊า... ช่าง');
      expect(lookupShortPhraseTh('CORRO!', 'es')).toBe('ฉันกำลังจะเสร็จ!');
      expect(lookupShortPhraseTh('RUEGO...', 'es')).toBe('ขอร้องล่ะ...');
      expect(lookupShortPhraseTh('DBNADA...', 'es')).toBe('ไม่เป็นไร...');
      expect(lookupShortPhraseTh('JUGANDO', 'es')).toBe('กำลังเล่น');
      expect(lookupShortPhraseTh('CARICIAS', 'es')).toBe('การลูบไล้');
      expect(lookupShortPhraseTh('ORGASMO.', 'es')).toBe('ถึงจุดสุดยอด.');
      expect(lookupShortPhraseTh('MEVENGO', 'es')).toBe('ฉันจะเสร็จแล้ว');
      expect(lookupShortPhraseTh('SIENTO, LO', 'es')).toBe('ขอโทษนะ ฉัน');
      expect(lookupShortPhraseTh('MEVENGOME', 'es')).toBe('ฉันจะเสร็จแล้ว ฉัน...');
      expect(lookupShortPhraseTh('UNAPOLLA', 'es')).toBe('ควย');
      expect(lookupShortPhraseTh('HABITACION?', 'es')).toBe('ห้องเหรอ?');
      expect(lookupShortPhraseTh('AHORAMISMONO', 'es')).toBe('ตอนนี้ยังไม่');
      expect(lookupShortPhraseTh('ESCENARIO', 'es')).toBe('ฉาก / สถานการณ์');
      expect(lookupShortPhraseTh('ELSENOR', 'es')).toBe('นายท่าน');
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
