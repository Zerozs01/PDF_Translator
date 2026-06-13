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
