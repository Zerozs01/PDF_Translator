import { useState, useCallback, useRef, useEffect } from 'react';
import type { OCREngine } from '../../../types';
import { OCR_ENGINES } from '../../../stores/useOCRTextLayerStore';

export type EngineWarmPhase = 'idle' | 'checking' | 'warming' | 'ready' | 'error';

export type EngineWarmState = {
  phase: EngineWarmPhase;
  progress: number;
  runtime?: string;
  description?: string;
  etaSec?: number | null;
  languageKey?: string;
};

export const SESSION_ENGINE_WARM_STATES: Record<string, EngineWarmState> = {};
export const SESSION_PREWARM_REQUESTED = new Set<string>();
export const SESSION_ENGINE_WARM_PROMISES = new Map<string, Promise<boolean>>();
export const SESSION_ENGINE_READY_KEYS = new Set<string>();

export const normalizeWarmLanguageKey = (value: string): string =>
  String(value || '')
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .sort()
    .join('+') || 'eng';

export const getEngineWarmSessionKey = (engine: OCREngine, language: string): string =>
  `${engine}:${normalizeWarmLanguageKey(language)}`;

export interface UseEnginePrewarmOptions {
  currentEngine: OCREngine;
  language: string;
  onEngineReady?: (engine: OCREngine) => void;
}

export function useEnginePrewarm({
  currentEngine,
  language,
  onEngineReady,
}: UseEnginePrewarmOptions) {
  const [engineWarmStates, setEngineWarmStates] = useState<Record<string, EngineWarmState>>(
    () => ({ ...SESSION_ENGINE_WARM_STATES })
  );
  const warmAnimationTimersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const pendingEngineSelectionRef = useRef<OCREngine | null>(null);

  const setEngineWarmState = useCallback((engine: string, patch: Partial<EngineWarmState>) => {
    setEngineWarmStates((current) => {
      const previous = current[engine] || SESSION_ENGINE_WARM_STATES[engine] || { phase: 'idle' as EngineWarmPhase, progress: 0 };
      const nextState = Object.assign(
        { phase: 'idle' as EngineWarmPhase, progress: 0 },
        previous,
        patch
      );
      SESSION_ENGINE_WARM_STATES[engine] = nextState;
      return {
        ...current,
        [engine]: nextState,
      };
    });
  }, []);

  const ensureEngineReady = useCallback(
    async (
      engine: OCREngine,
      opts: { selectOnReady?: boolean; silent?: boolean } = {}
    ): Promise<boolean> => {
      const normalizedLanguage = normalizeWarmLanguageKey(language);
      const sessionKey = getEngineWarmSessionKey(engine, normalizedLanguage);

      if (opts.selectOnReady) {
        pendingEngineSelectionRef.current = engine;
      }

      if (SESSION_ENGINE_READY_KEYS.has(sessionKey)) {
        setEngineWarmState(engine, {
          phase: 'ready',
          progress: 100,
          description: 'Model ready in session',
          languageKey: normalizedLanguage,
        });
        if (opts.selectOnReady && onEngineReady) {
          onEngineReady(engine);
          pendingEngineSelectionRef.current = null;
        }
        return true;
      }

      const existingPromise = SESSION_ENGINE_WARM_PROMISES.get(sessionKey);
      if (existingPromise) {
        return existingPromise;
      }

      const runPromise = (async () => {
        setEngineWarmState(engine, {
          phase: 'warming',
          progress: 15,
          description: 'Prewarming OCR daemon...',
          languageKey: normalizedLanguage,
        });

        // Animation timer for smoother UX
        if (warmAnimationTimersRef.current.has(sessionKey)) {
          clearInterval(warmAnimationTimersRef.current.get(sessionKey)!);
        }
        const animTimer = setInterval(() => {
          setEngineWarmStates((prev) => {
            const cur = prev[engine];
            if (!cur || cur.phase !== 'warming' || cur.progress >= 90) return prev;
            return {
              ...prev,
              [engine]: {
                ...cur,
                progress: Math.min(90, cur.progress + 5),
              },
            };
          });
        }, 300);
        warmAnimationTimersRef.current.set(sessionKey, animTimer);

        try {
          const electronApi = typeof window !== 'undefined' ? (window as any).electronAPI : undefined;
          if (electronApi?.ocr?.prewarm) {
            await electronApi.ocr.prewarm({ engine, language: normalizedLanguage });
          } else if (electronApi?.prewarmEngine) {
            await electronApi.prewarmEngine(engine, normalizedLanguage);
          } else {
            // Fallback: simulated ready delay
            await new Promise((resolve) => setTimeout(resolve, 500));
          }

          clearInterval(animTimer);
          warmAnimationTimersRef.current.delete(sessionKey);

          SESSION_ENGINE_READY_KEYS.add(sessionKey);
          setEngineWarmState(engine, {
            phase: 'ready',
            progress: 100,
            description: 'Model ready',
            languageKey: normalizedLanguage,
          });

          if (pendingEngineSelectionRef.current === engine && onEngineReady) {
            onEngineReady(engine);
            pendingEngineSelectionRef.current = null;
          }
          return true;
        } catch (err) {
          clearInterval(animTimer);
          warmAnimationTimersRef.current.delete(sessionKey);

          const errorMessage = err instanceof Error ? err.message : 'Unknown prewarm error';
          console.warn(`[OCRPrewarm] Failed to warm engine ${engine}:`, err);
          setEngineWarmState(engine, {
            phase: 'error',
            progress: 0,
            description: `Prewarm failed: ${errorMessage}`,
            languageKey: normalizedLanguage,
          });
          return false;
        } finally {
          SESSION_ENGINE_WARM_PROMISES.delete(sessionKey);
        }
      })();

      SESSION_ENGINE_WARM_PROMISES.set(sessionKey, runPromise);
      return runPromise;
    },
    [language, onEngineReady, setEngineWarmState]
  );

  useEffect(() => {
    return () => {
      for (const timer of warmAnimationTimersRef.current.values()) {
        clearInterval(timer);
      }
      warmAnimationTimersRef.current.clear();
    };
  }, []);

  return {
    engineWarmStates,
    setEngineWarmState,
    ensureEngineReady,
  };
}
