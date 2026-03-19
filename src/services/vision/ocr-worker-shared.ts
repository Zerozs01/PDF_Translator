export type OCRProgressPayload = {
  status: string;
  progress: number;
  workerId?: string;
};

type OCRLoggerMessage = {
  status?: string;
  progress?: number;
  workerId?: string;
};

export function sendOCRProgress(payload: OCRProgressPayload): void {
  self.postMessage({
    type: 'OCR_PROGRESS',
    payload,
  });
}

export function createOCRLogger(
  sendUpdates: boolean,
  progressSender: (payload: OCRProgressPayload) => void = sendOCRProgress
): (message: OCRLoggerMessage) => void {
  return (message: OCRLoggerMessage): void => {
    if (!sendUpdates || !message.status || typeof message.progress !== 'number') return;
    progressSender({
      status: message.status,
      progress: message.progress,
      workerId: message.workerId,
    });
  };
}

export async function withWorkerInitLock(
  getCurrentInit: () => Promise<void> | null,
  setCurrentInit: (promise: Promise<void> | null) => void,
  initTask: () => Promise<void>
): Promise<void> {
  while (getCurrentInit()) {
    await getCurrentInit();
  }

  const initPromise = (async () => {
    await initTask();
  })();

  setCurrentInit(initPromise);
  try {
    await initPromise;
  } finally {
    if (getCurrentInit() === initPromise) {
      setCurrentInit(null);
    }
  }
}

type WorkerState<TWorker> = {
  worker: TWorker | null;
  lang: string;
};

export async function ensureWorkerForLanguage<TWorker>(
  targetLang: string,
  getState: () => WorkerState<TWorker>,
  setState: (state: WorkerState<TWorker>) => void,
  getCurrentInit: () => Promise<void> | null,
  setCurrentInit: (promise: Promise<void> | null) => void,
  createWorkerForLanguage: (targetLang: string, previous: WorkerState<TWorker>) => Promise<TWorker>
): Promise<TWorker> {
  const current = getState();
  if (current.worker && current.lang === targetLang) {
    return current.worker;
  }

  await withWorkerInitLock(
    getCurrentInit,
    setCurrentInit,
    async () => {
      const latest = getState();
      if (latest.worker && latest.lang === targetLang) return;
      const worker = await createWorkerForLanguage(targetLang, latest);
      setState({ worker, lang: targetLang });
    }
  );

  const next = getState().worker;
  if (!next) {
    throw new Error(`Worker initialization failed for language: ${targetLang}`);
  }

  return next;
}

/**
 * Get image dimensions without heavy pixel processing.
 * Uses createImageBitmap, which is available in web workers.
 */
export async function getWorkerImageDimensions(imageUrl: string): Promise<{ width: number; height: number }> {
  const response = await fetch(imageUrl);
  const blob = await response.blob();
  const bmp = await createImageBitmap(blob);
  const result = { width: bmp.width, height: bmp.height };
  bmp.close();
  return result;
}
