import { useOCRTextLayerStore } from '../../stores/useOCRTextLayerStore';

export interface OcrAdapterInfo {
  index: number;
  name: string;
  id: string;
}

export interface OcrBackendBridge {
  setBackend?: (args: { backend: string; adapterName?: string; forceRestart?: boolean }) => Promise<unknown> | unknown;
  listAdapters?: () => Promise<OcrAdapterInfo[]>;
  verifyDmlReady?: (adapterName?: string) => Promise<{ ready?: boolean; reason?: string } | undefined>;
}

export type BootstrapOutcome =
  | 'no_bridge'
  | 'restored_user_choice'
  | 'kept_current'
  | 'auto_promoted'
  | 'promotion_skipped';

export function isDedicatedAdapter(name: string | undefined): boolean {
  const n = (name || '').toLowerCase();
  return n.length > 0 && !n.includes('basic render') && !n.includes('microsoft basic');
}

let inFlightBootstrap: Promise<BootstrapOutcome> | null = null;

/**
 * Ordered startup: (1) push persisted backend to Rust BEFORE anything may wake the worker,
 * (2) only then list adapters, (3) auto-promote to ort_dml iff the user never chose manually.
 * Uses a single-flight in-flight promise so concurrent callers (e.g. App and OCREngineSelector)
 * share a single execution.
 */
export async function bootstrapOcrBackend(bridge: OcrBackendBridge | undefined): Promise<BootstrapOutcome> {
  if (inFlightBootstrap) {
    return inFlightBootstrap;
  }
  inFlightBootstrap = doBootstrapOcrBackend(bridge).finally(() => {
    inFlightBootstrap = null;
  });
  return inFlightBootstrap;
}

async function doBootstrapOcrBackend(bridge: OcrBackendBridge | undefined): Promise<BootstrapOutcome> {
  if (!bridge?.setBackend || !bridge.listAdapters) return 'no_bridge';

  const store = useOCRTextLayerStore.getState();
  const { backend, dmlAdapterName } = store.options;
  const currentBackend = backend || 'paddle';

  // Rust defaults to 'paddle' on every boot, so a persisted choice must be re-pushed.
  if (store.hasUserManuallySelectedBackend || currentBackend !== 'paddle') {
    await bridge.setBackend({ backend: currentBackend, adapterName: dmlAdapterName || undefined });
  }

  let adapters: OcrAdapterInfo[] = [];
  try {
    const list = await bridge.listAdapters();
    adapters = Array.isArray(list) ? list : [];
  } catch {
    adapters = [];
  }

  const dedicated = adapters.find((a) => isDedicatedAdapter(a.name));

  if (store.hasUserManuallySelectedBackend) {
    if (!dmlAdapterName && dedicated) store.setOptions({ dmlAdapterName: dedicated.name });
    return 'restored_user_choice';
  }
  if (currentBackend !== 'paddle') return 'kept_current';
  if (!dedicated) return 'promotion_skipped';

  try {
    const verifyPromise = bridge.verifyDmlReady?.(dedicated.name);
    const timeoutPromise = new Promise<{ ready?: boolean; reason?: string }>((_, reject) => {
      setTimeout(() => reject(new Error('DirectML verification timed out after 10s')), 10000);
    });
    const res = await Promise.race([verifyPromise, timeoutPromise]);
    if (!res?.ready) return 'promotion_skipped';
  } catch {
    await bridge.setBackend?.({ backend: 'paddle', forceRestart: true });
    return 'promotion_skipped';
  }

  const targetAdapter = dmlAdapterName || dedicated.name;
  await bridge.setBackend({ backend: 'ort_dml', adapterName: targetAdapter });
  useOCRTextLayerStore.getState().applyAutoPromotedBackend('ort_dml', targetAdapter);
  return 'auto_promoted';
}
