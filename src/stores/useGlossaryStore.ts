import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface GlossaryEntry {
  id: string;
  sourceText: string;
  targetText: string;
  type: 'TERM' | 'SFX';
  isActive: boolean;
}

interface GlossaryState {
  entries: GlossaryEntry[];
  addEntry: (entry: Omit<GlossaryEntry, 'id' | 'isActive'>) => void;
  removeEntry: (id: string) => void;
  toggleEntry: (id: string) => void;
}

const generateUUID = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

export const useGlossaryStore = create<GlossaryState>()(
  persist(
    (set) => ({
      entries: [], // Start empty for other users to fill in
      addEntry: (entry) =>
        set((state) => ({
          entries: [
            ...state.entries,
            { ...entry, id: generateUUID(), isActive: true },
          ],
        })),
      removeEntry: (id) =>
        set((state) => ({
          entries: state.entries.filter((e) => e.id !== id),
        })),
      toggleEntry: (id) =>
        set((state) => ({
          entries: state.entries.map((e) =>
            e.id === id ? { ...e, isActive: !e.isActive } : e
          ),
        })),
    }),
    {
      name: 'pdf-translator-user-glossary', // Stores automatically in localStorage
    }
  )
);
