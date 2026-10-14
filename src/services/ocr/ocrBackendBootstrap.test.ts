import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOCRTextLayerStore } from '../../stores/useOCRTextLayerStore';
import { bootstrapOcrBackend, type OcrBackendBridge } from './ocrBackendBootstrap';

const RX6700 = { index: 0, name: 'AMD Radeon RX 6700 XT', id: 'gpu0' };
const BASIC = { index: 1, name: 'Microsoft Basic Render Driver', id: 'gpu1' };

function makeBridge(overrides: Partial<OcrBackendBridge> = {}): OcrBackendBridge {
  return {
    setBackend: vi.fn().mockResolvedValue(undefined),
    listAdapters: vi.fn().mockResolvedValue([RX6700]),
    verifyDmlReady: vi.fn().mockResolvedValue({ ready: true }),
    ...overrides,
  };
}

describe('bootstrapOcrBackend (ADR-0006)', () => {
  beforeEach(() => {
    useOCRTextLayerStore.setState({
      hasUserManuallySelectedBackend: false,
      runtimeBackendStatus: 'idle',
      options: { ...useOCRTextLayerStore.getState().options, backend: 'paddle', dmlAdapterName: '' },
    });
  });

  it('keeps hard default paddle in the initial store state', () => {
    expect(useOCRTextLayerStore.getState().options.backend).toBe('paddle');
  });

  it('auto-promotes to ort_dml with a dedicated GPU and does not mark it manual', async () => {
    const bridge = makeBridge();
    expect(await bootstrapOcrBackend(bridge)).toBe('auto_promoted');
    const s = useOCRTextLayerStore.getState();
    expect(s.options.backend).toBe('ort_dml');
    expect(s.options.dmlAdapterName).toBe(RX6700.name);
    expect(s.hasUserManuallySelectedBackend).toBe(false);
    expect(s.runtimeBackendStatus).toBe('active_dml');
  });

  it('respects a manual paddle choice and syncs it to Rust before listing adapters', async () => {
    useOCRTextLayerStore.setState({ hasUserManuallySelectedBackend: true });
    const calls: string[] = [];
    const bridge = makeBridge({
      setBackend: vi.fn().mockImplementation(async () => void calls.push('setBackend')),
      listAdapters: vi.fn().mockImplementation(async () => {
        calls.push('listAdapters');
        return [RX6700];
      }),
    });
    expect(await bootstrapOcrBackend(bridge)).toBe('restored_user_choice');
    expect(calls).toEqual(['setBackend', 'listAdapters']);
    expect(useOCRTextLayerStore.getState().options.backend).toBe('paddle');
    expect(bridge.verifyDmlReady).not.toHaveBeenCalled();
  });

  it('skips promotion without a dedicated GPU', async () => {
    const bridge = makeBridge({ listAdapters: vi.fn().mockResolvedValue([BASIC]) });
    expect(await bootstrapOcrBackend(bridge)).toBe('promotion_skipped');
    expect(useOCRTextLayerStore.getState().options.backend).toBe('paddle');
  });

  it('skips promotion when verifyDmlReady fails', async () => {
    const bridge = makeBridge({ verifyDmlReady: vi.fn().mockResolvedValue({ ready: false }) });
    expect(await bootstrapOcrBackend(bridge)).toBe('promotion_skipped');
    expect(useOCRTextLayerStore.getState().options.backend).toBe('paddle');
  });

  it('setBackendFromUI marks the choice as manual', () => {
    useOCRTextLayerStore.getState().setBackendFromUI('ort_dml');
    expect(useOCRTextLayerStore.getState().hasUserManuallySelectedBackend).toBe(true);
  });

  it('reverts to paddle with forceRestart: true when verifyDmlReady throws an error (ADR-0007)', async () => {
    const bridge = makeBridge({
      verifyDmlReady: vi.fn().mockRejectedValue(new Error('Driver hung or worker crashed')),
    });
    expect(await bootstrapOcrBackend(bridge)).toBe('promotion_skipped');
    expect(bridge.setBackend).toHaveBeenCalledWith({ backend: 'paddle', forceRestart: true });
    expect(useOCRTextLayerStore.getState().options.backend).toBe('paddle');
  });

  it('reverts to paddle with forceRestart: true when verifyDmlReady times out after 10s (ADR-0007)', async () => {
    vi.useFakeTimers();
    try {
      const bridge = makeBridge({
        verifyDmlReady: vi.fn().mockImplementation(() => new Promise(() => {})), // Never resolves
      });
      const promise = bootstrapOcrBackend(bridge);
      // Advance past the 10s timeout guard
      await vi.advanceTimersByTimeAsync(10500);
      const outcome = await promise;
      expect(outcome).toBe('promotion_skipped');
      expect(bridge.setBackend).toHaveBeenCalledWith({ backend: 'paddle', forceRestart: true });
      expect(useOCRTextLayerStore.getState().options.backend).toBe('paddle');
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns no_bridge when no bridge exists (Vitest/CI safety)', async () => {
    expect(await bootstrapOcrBackend(undefined)).toBe('no_bridge');
  });
});
