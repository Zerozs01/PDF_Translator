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

/* eslint-disable @typescript-eslint/no-explicit-any */
const _self = self as any;

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
    } catch (err2: unknown) {
      const e2 = err2 as Error | undefined;
      console.error('[worker-boot] Stable worker ALSO failed:', e2?.message || String(err2));
    }
  }
})();
