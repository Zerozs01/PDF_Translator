export const OCR_PER_PAGE_TIMEOUT_SEC_DEFAULT = 120;
export const OCR_DIRECT_RENDER_TIMEOUT_MS_DEFAULT = 15000;
export const OCR_WORKER_REQUEST_TIMEOUT_MS_DEFAULT = 300000;
export const OCR_WORKER_RETRY_ATTEMPTS_DEFAULT = 2;
export const OCR_WORKER_RETRY_DELAY_MS_DEFAULT = 1000;

export function getPerPageTimeoutMs(timeoutSec?: number): number {
  if ((timeoutSec ?? 0) <= 0) return 0;
  return Math.max(0, Math.floor(timeoutSec as number * 1000));
}

export async function withPerPageOCRTimeout<T>(
  task: Promise<T>,
  pageNum: number,
  timeoutSec?: number,
  onTimeout?: () => void
): Promise<T> {
  const timeoutMs = getPerPageTimeoutMs(timeoutSec);
  if (timeoutMs <= 0) return task;

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      try {
        onTimeout?.();
      } catch {
        // Best effort timeout cancellation hook.
      }
      reject(new Error(`OCR timeout: page ${pageNum} exceeded ${timeoutSec}s`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([task, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
