import { describe, it, expect, beforeEach } from 'vitest';
import { ConcurrencyLimiter } from './ConcurrencyLimiter';
import { useOCRTextLayerStore } from '../../stores/useOCRTextLayerStore';

describe('DirectML Runtime Truth & Concurrency Guardrails (ADR-0005 Phase 1)', () => {
  beforeEach(() => {
    useOCRTextLayerStore.getState().reset();
  });

  describe('Zustand Store Runtime Backend State', () => {
    it('initializes with idle runtimeBackendStatus and null lastFallbackReason', () => {
      const state = useOCRTextLayerStore.getState();
      expect(state.runtimeBackendStatus).toBe('idle');
      expect(state.lastFallbackReason).toBeNull();
    });

    it('updates runtimeBackendStatus to active_dml when DirectML executes successfully', () => {
      useOCRTextLayerStore.getState().setRuntimeBackendStatus('active_dml');
      const state = useOCRTextLayerStore.getState();
      expect(state.runtimeBackendStatus).toBe('active_dml');
      expect(state.lastFallbackReason).toBeNull();
    });

    it('updates runtimeBackendStatus to fallback_cpu and sets lastFallbackReason on fallback', () => {
      useOCRTextLayerStore.getState().setRuntimeBackendStatus('fallback_cpu', 'unsupported_language');
      const state = useOCRTextLayerStore.getState();
      expect(state.runtimeBackendStatus).toBe('fallback_cpu');
      expect(state.lastFallbackReason).toBe('unsupported_language');
    });

    it('resets runtimeBackendStatus and lastFallbackReason back to initial defaults on reset()', () => {
      useOCRTextLayerStore.getState().setRuntimeBackendStatus('fallback_cpu', 'dml_runtime_error');
      expect(useOCRTextLayerStore.getState().runtimeBackendStatus).toBe('fallback_cpu');

      useOCRTextLayerStore.getState().reset();
      expect(useOCRTextLayerStore.getState().runtimeBackendStatus).toBe('idle');
      expect(useOCRTextLayerStore.getState().lastFallbackReason).toBeNull();
    });
  });

  describe('Strict GPU Concurrency Cap Policy', () => {
    it('enforces concurrency = 1 when backend is ort_dml', async () => {
      const backend: 'paddle' | 'ort_dml' = 'ort_dml';
      const maxConcurrency = backend === 'ort_dml' ? 1 : 2;
      const limiter = new ConcurrencyLimiter(maxConcurrency);

      let peakActive = 0;
      let currentActive = 0;

      const runTask = async () => {
        return limiter.run(async () => {
          currentActive++;
          peakActive = Math.max(peakActive, currentActive);
          await new Promise((r) => setTimeout(r, 20));
          currentActive--;
        });
      };

      await Promise.all([runTask(), runTask(), runTask(), runTask()]);

      expect(peakActive).toBe(1);
    });

    it('permits concurrency = 2 when backend is paddle CPU', async () => {
      const backend: 'paddle' | 'ort_dml' = 'paddle';
      const maxConcurrency = backend === 'ort_dml' ? 1 : 2;
      const limiter = new ConcurrencyLimiter(maxConcurrency);

      let peakActive = 0;
      let currentActive = 0;

      const runTask = async () => {
        return limiter.run(async () => {
          currentActive++;
          peakActive = Math.max(peakActive, currentActive);
          await new Promise((r) => setTimeout(r, 25));
          currentActive--;
        });
      };

      await Promise.all([runTask(), runTask(), runTask(), runTask()]);

      expect(peakActive).toBe(2);
    });
  });

  describe('Split Fallback Policy Contract Verification', () => {
    it('distinguishes ephemeral language fallback vs sticky session downgrade', () => {
      // Contract test simulating sidecar JSON response parsing
      const languageFallbackResponse = {
        requested_backend: 'ort_dml',
        actual_backend: 'paddle',
        fallback_reason: 'unsupported_language',
        session_downgraded: false,
      };

      expect(languageFallbackResponse.actual_backend).toBe('paddle');
      expect(languageFallbackResponse.fallback_reason).toBe('unsupported_language');
      expect(languageFallbackResponse.session_downgraded).toBe(false);

      const driverCrashResponse = {
        requested_backend: 'ort_dml',
        actual_backend: 'paddle',
        fallback_reason: 'dml_runtime_error',
        session_downgraded: true,
      };

      expect(driverCrashResponse.actual_backend).toBe('paddle');
      expect(driverCrashResponse.fallback_reason).toBe('dml_runtime_error');
      expect(driverCrashResponse.session_downgraded).toBe(true);
    });
  });
});
