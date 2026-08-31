import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { dbService } from '../services/dbService';

export interface GlossaryEntry {
  id: string;
  dbId?: number;
  sourceText: string;
  targetText: string;
  sourceLang?: string;
  targetLang?: string;
  type: 'TERM' | 'SFX';
  isActive: boolean;
  createdAt?: number;
  updatedAt?: number;
}

interface GlossaryState {
  entries: GlossaryEntry[];
  isLoaded: boolean;
  initSync: () => Promise<void>;
  addEntry: (entry: Omit<GlossaryEntry, 'id' | 'isActive'> & { isActive?: boolean }) => Promise<void>;
  updateEntry: (id: string, updates: Partial<Omit<GlossaryEntry, 'id'>>) => Promise<void>;
  removeEntry: (id: string) => Promise<void>;
  toggleEntry: (id: string) => Promise<void>;
  importEntries: (newEntries: Array<{
    sourceText: string;
    targetText: string;
    sourceLang?: string;
    targetLang?: string;
    type?: 'TERM' | 'SFX';
    isActive?: boolean;
  }>) => Promise<{ count: number }>;
  exportEntries: (format?: 'json' | 'csv') => string;
}

const generateUUID = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

export const useGlossaryStore = create<GlossaryState>()(
  persist(
    (set, get) => ({
      entries: [],
      isLoaded: false,

      initSync: async () => {
        try {
          if (typeof window === 'undefined') return;
          const dbRows = await dbService.getGlossaryEntries();
          if (dbRows && dbRows.length > 0) {
            const mappedEntries: GlossaryEntry[] = dbRows.map((row) => ({
              id: String(row.id || generateUUID()),
              dbId: row.id,
              sourceText: row.source_text,
              targetText: row.target_text,
              sourceLang: row.source_lang || 'all',
              targetLang: row.target_lang || 'th',
              type: (row.type as 'TERM' | 'SFX') || 'TERM',
              isActive: Boolean(row.is_active ?? true),
              createdAt: row.created_at,
              updatedAt: row.updated_at,
            }));
            set({ entries: mappedEntries, isLoaded: true });
            return;
          }

          // If DB is empty but localStorage has entries, migrate them to DB
          const currentLocal = get().entries;
          if (currentLocal.length > 0) {
            await dbService.importGlossaryBatch(
              currentLocal.map((e) => ({
                sourceText: e.sourceText,
                targetText: e.targetText,
                sourceLang: e.sourceLang || 'all',
                targetLang: e.targetLang || 'th',
                type: e.type,
                isActive: e.isActive,
              }))
            );
            const syncedRows = await dbService.getGlossaryEntries();
            if (syncedRows && syncedRows.length > 0) {
              const mappedEntries: GlossaryEntry[] = syncedRows.map((row) => ({
                id: String(row.id || generateUUID()),
                dbId: row.id,
                sourceText: row.source_text,
                targetText: row.target_text,
                sourceLang: row.source_lang || 'all',
                targetLang: row.target_lang || 'th',
                type: (row.type as 'TERM' | 'SFX') || 'TERM',
                isActive: Boolean(row.is_active ?? true),
                createdAt: row.created_at,
                updatedAt: row.updated_at,
              }));
              set({ entries: mappedEntries, isLoaded: true });
              return;
            }
          }
          set({ isLoaded: true });
        } catch (error) {
          console.warn('[useGlossaryStore] Failed to sync glossary with DB, using local fallback:', error);
          set({ isLoaded: true });
        }
      },

      addEntry: async (entry) => {
        const tempId = generateUUID();
        const newEntry: GlossaryEntry = {
          ...entry,
          id: tempId,
          sourceLang: entry.sourceLang || 'all',
          targetLang: entry.targetLang || 'th',
          isActive: entry.isActive ?? true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        // Optimistic update
        set((state) => ({
          entries: [newEntry, ...state.entries.filter((e) => e.sourceText.toLowerCase() !== entry.sourceText.trim().toLowerCase())],
        }));

        try {
          const saved = await dbService.saveGlossaryEntry({
            sourceText: entry.sourceText,
            targetText: entry.targetText,
            sourceLang: entry.sourceLang,
            targetLang: entry.targetLang,
            type: entry.type,
            isActive: entry.isActive ?? true,
          });

          if (saved && saved.id) {
            set((state) => ({
              entries: state.entries.map((e) =>
                e.id === tempId ? { ...e, id: String(saved.id), dbId: saved.id } : e
              ),
            }));
          }
        } catch (err) {
          console.error('[useGlossaryStore] Error saving entry to DB:', err);
        }
      },

      updateEntry: async (id, updates) => {
        const target = get().entries.find((e) => e.id === id);
        if (!target) return;

        set((state) => ({
          entries: state.entries.map((e) =>
            e.id === id ? { ...e, ...updates, updatedAt: Date.now() } : e
          ),
        }));

        try {
          const updatedTarget = get().entries.find((e) => e.id === id);
          if (updatedTarget) {
            await dbService.saveGlossaryEntry({
              id: updatedTarget.dbId,
              sourceText: updatedTarget.sourceText,
              targetText: updatedTarget.targetText,
              sourceLang: updatedTarget.sourceLang,
              targetLang: updatedTarget.targetLang,
              type: updatedTarget.type,
              isActive: updatedTarget.isActive,
            });
          }
        } catch (err) {
          console.error('[useGlossaryStore] Error updating entry in DB:', err);
        }
      },

      removeEntry: async (id) => {
        const target = get().entries.find((e) => e.id === id);
        const dbId = target?.dbId || (Number.isFinite(Number(id)) ? Number(id) : undefined);

        set((state) => ({
          entries: state.entries.filter((e) => e.id !== id),
        }));

        if (dbId) {
          try {
            await dbService.deleteGlossaryEntry(dbId);
          } catch (err) {
            console.error('[useGlossaryStore] Error deleting entry from DB:', err);
          }
        }
      },

      toggleEntry: async (id) => {
        const target = get().entries.find((e) => e.id === id);
        if (!target) return;

        const nextActive = !target.isActive;
        const dbId = target.dbId || (Number.isFinite(Number(id)) ? Number(id) : undefined);

        set((state) => ({
          entries: state.entries.map((e) =>
            e.id === id ? { ...e, isActive: nextActive, updatedAt: Date.now() } : e
          ),
        }));

        if (dbId) {
          try {
            await dbService.toggleGlossaryEntry(dbId, nextActive);
          } catch (err) {
            console.error('[useGlossaryStore] Error toggling entry in DB:', err);
          }
        }
      },

      importEntries: async (newEntries) => {
        if (!newEntries || newEntries.length === 0) return { count: 0 };

        try {
          await dbService.importGlossaryBatch(newEntries);
          const syncedRows = await dbService.getGlossaryEntries();
          if (syncedRows && syncedRows.length > 0) {
            const mappedEntries: GlossaryEntry[] = syncedRows.map((row) => ({
              id: String(row.id || generateUUID()),
              dbId: row.id,
              sourceText: row.source_text,
              targetText: row.target_text,
              sourceLang: row.source_lang || 'all',
              targetLang: row.target_lang || 'th',
              type: (row.type as 'TERM' | 'SFX') || 'TERM',
              isActive: Boolean(row.is_active ?? true),
              createdAt: row.created_at,
              updatedAt: row.updated_at,
            }));
            set({ entries: mappedEntries });
            return { count: mappedEntries.length };
          }
        } catch (err) {
          console.warn('[useGlossaryStore] DB batch import failed, merging locally:', err);
        }

        // Fallback local merge
        let addedCount = 0;
        set((state) => {
          const map = new Map<string, GlossaryEntry>();
          state.entries.forEach((e) => map.set(e.sourceText.toLowerCase(), e));
          newEntries.forEach((item) => {
            const key = item.sourceText.toLowerCase();
            map.set(key, {
              id: generateUUID(),
              sourceText: item.sourceText.trim(),
              targetText: item.targetText.trim(),
              sourceLang: item.sourceLang || 'all',
              targetLang: item.targetLang || 'th',
              type: item.type || 'TERM',
              isActive: item.isActive ?? true,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });
            addedCount++;
          });
          return { entries: Array.from(map.values()) };
        });

        return { count: addedCount };
      },

      exportEntries: (format = 'json') => {
        const entries = get().entries;
        if (format === 'csv') {
          const header = 'source_text,target_text,source_lang,target_lang,type,is_active\n';
          const rows = entries.map((e) => {
            const escapeCsv = (str: string) => `"${(str || '').replace(/"/g, '""')}"`;
            return `${escapeCsv(e.sourceText)},${escapeCsv(e.targetText)},${escapeCsv(e.sourceLang || 'all')},${escapeCsv(e.targetLang || 'th')},${e.type},${e.isActive ? 1 : 0}`;
          }).join('\n');
          return header + rows;
        }

        return JSON.stringify(
          entries.map((e) => ({
            sourceText: e.sourceText,
            targetText: e.targetText,
            sourceLang: e.sourceLang || 'all',
            targetLang: e.targetLang || 'th',
            type: e.type,
            isActive: e.isActive,
          })),
          null,
          2
        );
      },
    }),
    {
      name: 'pdf-translator-user-glossary',
    }
  )
);
