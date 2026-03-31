/**
 * Worker Boot Loader
 *
 * Thin wrapper that dynamically imports the primary worker module.
 * If the primary worker fails to load (e.g. Vite dev-mode module resolution
 * issue with deep import trees), this catches the actual error, reports it
 * via postMessage, and falls back to the stable worker.
 *
 * VisionService loads this file instead of worker.ts directly.
 */

type BootWorkerScope = typeof globalThis & {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (message: unknown) => void;
};

const _self = self as unknown as BootWorkerScope;

// ── Buffer incoming messages while the real worker module loads ──
// The module worker port is enabled after this entry module evaluates,
// but self.onmessage is only set by worker.ts (or worker-stable.ts)
// inside the dynamic import below. Without buffering, any messages
// dispatched in the gap (e.g. INIT) are silently dropped.
const _bootBuffer: MessageEvent[] = [];
_self.onmessage = (e: MessageEvent) => {
  _bootBuffer.push(e);
};

console.log('[worker-boot] Starting module load...');

(async () => {
  try {
    // Dynamic import — if this fails we get a catchable error
    await import('./worker');
    console.log('[worker-boot] Primary worker loaded successfully.');
  } catch (err: unknown) {
    const e = err as Error | undefined;
    const message = e?.message || String(err);
    const stack = e?.stack || '';
    const name = e?.name || '';

    console.error('[worker-boot] ❌ FAILED to load primary worker.');
    console.error('[worker-boot] Error name:', name);
    console.error('[worker-boot] Error message:', message);
    console.error('[worker-boot] Stack trace:', stack);

    // Report the real error back to VisionService
    _self.postMessage({
      type: 'WORKER_BOOT_ERROR',
      payload: { message, stack, name },
    });

    // Fall back to the stable worker
    try {
      await import('./worker-stable');
      console.log('[worker-boot] ✅ Stable worker loaded as fallback.');
      // worker-stable doesn't post WORKER_BOOT itself, so we do it here
      _self.postMessage({ type: 'WORKER_BOOT', payload: { status: 'ok-fallback', ts: Date.now() } });
    } catch (err2: unknown) {
      const e2 = err2 as Error | undefined;
      console.error('[worker-boot] Stable worker ALSO failed:', e2?.message || String(err2));
    }
  }

  // worker.ts (or worker-stable.ts) has now set self.onmessage to the
  // real handler.  Replay any messages that arrived during module loading.
  if (_bootBuffer.length > 0) {
    console.log(`[worker-boot] Replaying ${_bootBuffer.length} buffered message(s)...`);
    const realHandler = _self.onmessage;
    if (typeof realHandler === 'function') {
      for (const msg of _bootBuffer) {
        realHandler(msg);
      }
    }
    _bootBuffer.length = 0;
  }
})();
