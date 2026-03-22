import { pdfjs } from './pdf/pdfjsWorker';

type ThumbnailSource = {
  name: string;
  mimeType: string;
  data: Uint8Array | ArrayBuffer | string;
};

export type ThumbnailResult = {
  dataUrl: string;
  totalPages?: number;
};

const THUMBNAIL_WIDTH = 320;
const THUMBNAIL_HEIGHT = 420;

const decodeBinary = (data: Uint8Array | ArrayBuffer | string): Uint8Array => {
  if (typeof data === 'string') {
    const binaryString = atob(data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  return data;
};

const drawCoverFrame = (
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number
): void => {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas context unavailable');
  }

  canvas.width = THUMBNAIL_WIDTH;
  canvas.height = THUMBNAIL_HEIGHT;

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const scale = Math.max(canvas.width / sourceWidth, canvas.height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const offsetX = (canvas.width - drawWidth) / 2;
  const offsetY = (canvas.height - drawHeight) / 2;

  ctx.drawImage(source, offsetX, offsetY, drawWidth, drawHeight);

  ctx.fillStyle = 'rgba(15, 23, 42, 0.18)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
};

const canvasToDataUrl = (canvas: HTMLCanvasElement): string =>
  canvas.toDataURL('image/jpeg', 0.78);

const renderImageThumbnail = async (mimeType: string, bytes: Uint8Array): Promise<ThumbnailResult> => {
  const byteCopy = new Uint8Array(bytes.byteLength);
  byteCopy.set(bytes);
  const blob = new Blob([byteCopy.buffer], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to decode image preview'));
      img.src = objectUrl;
    });

    const canvas = document.createElement('canvas');
    drawCoverFrame(canvas, image, image.naturalWidth || image.width, image.naturalHeight || image.height);

    return { dataUrl: canvasToDataUrl(canvas), totalPages: 1 };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const renderPdfThumbnail = async (bytes: Uint8Array): Promise<ThumbnailResult> => {
  const loadingTask = pdfjs.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;

  try {
    const page = await pdf.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const renderScale = Math.min(2, Math.max(1.15, 960 / baseViewport.width));
    const viewport = page.getViewport({ scale: renderScale });

    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = Math.ceil(viewport.width);
    sourceCanvas.height = Math.ceil(viewport.height);
    const context = sourceCanvas.getContext('2d', { alpha: false });
    if (!context) {
      throw new Error('Canvas context unavailable');
    }

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, sourceCanvas.width, sourceCanvas.height);

    await page.render({
      canvas: sourceCanvas,
      canvasContext: context,
      viewport
    }).promise;

    const thumbnailCanvas = document.createElement('canvas');
    drawCoverFrame(thumbnailCanvas, sourceCanvas, sourceCanvas.width, sourceCanvas.height);

    return {
      dataUrl: canvasToDataUrl(thumbnailCanvas),
      totalPages: pdf.numPages
    };
  } finally {
    await loadingTask.destroy();
  }
};

export const generateDocumentThumbnail = async ({
  mimeType,
  data
}: ThumbnailSource): Promise<ThumbnailResult> => {
  const bytes = decodeBinary(data);
  if (mimeType === 'application/pdf') {
    return renderPdfThumbnail(bytes);
  }
  if (mimeType.startsWith('image/')) {
    return renderImageThumbnail(mimeType, bytes);
  }
  throw new Error('Unsupported thumbnail source');
};
