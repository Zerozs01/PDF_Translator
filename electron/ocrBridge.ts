import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { loadLocalEnv } from './pythonRuntime';
import {
  ExternalBridgeEngine,
  ExternalOcrEngineStatus,
  ExternalOcrWarmupResponse,
  ExternalOcrRequestPayload,
  ExternalOcrBridgeResponse,
  EXTERNAL_ENGINES,
} from './ocrBridgeTypes';
import {
  getExternalOcrTempRoot,
  writeOcrTempImage,
  deleteOcrTempImage,
  cleanupOrphanedOcrTempFiles,
  mimeTypeToExtension,
  coerceImageBuffer,
} from './ocrTempManager';
import {
  requestDaemon,
  teardownDaemon,
  disposeExternalOcrDaemons,
} from './ocrDaemonManager';

// Initialize local .env configuration
loadLocalEnv();

// Re-export public types and utilities for seamless backward compatibility
export * from './ocrBridgeTypes';
export {
  getExternalOcrTempRoot,
  writeOcrTempImage,
  deleteOcrTempImage,
  cleanupOrphanedOcrTempFiles,
  disposeExternalOcrDaemons,
};

function isRecoverableDaemonError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('daemon') ||
    message.includes('stdin is unavailable') ||
    message.includes('parse ocr bridge response') ||
    message.includes('exited') ||
    message.includes('timed out') ||
    message.includes('econnreset') ||
    message.includes('pipe') ||
    message.includes('killed')
  );
}

function isNoTextBoxesError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.toLowerCase().includes('no text boxes returned from paddleocr');
}

export async function getExternalOcrEngineStatuses(): Promise<ExternalOcrEngineStatus[]> {
  return await Promise.all(
    EXTERNAL_ENGINES.map(async (engine) => {
      try {
        const response = await requestDaemon(engine, { action: 'status', engine });
        return {
          engine,
          available: Boolean(response.available),
          runtime: response.runtime || (engine === 'paddleocr' ? 'Python bridge' : 'REST/adapter bridge'),
          description: response.description || response.reason || 'No status details returned',
        };
      } catch (error) {
        return {
          engine,
          available: false,
          runtime: engine === 'paddleocr' ? 'Python bridge' : 'REST/adapter bridge',
          description: error instanceof Error ? error.message : String(error),
        };
      }
    })
  );
}

export async function runExternalOcr(payload: ExternalOcrRequestPayload): Promise<ExternalOcrBridgeResponse> {
  if (payload.engine !== 'paddleocr' && payload.engine !== 'easyocr') {
    throw new Error(`Unsupported external OCR engine: ${payload.engine}`);
  }
  if (!payload.imagePath && !payload.imageData) {
    throw new Error('ExternalOcrRequestPayload must provide either imagePath or imageData');
  }

  const engine = payload.engine as ExternalBridgeEngine;

  // --- Zero-copy path: reuse a temp file that was already written by the caller ---
  let resolvedImagePath: string;
  let ownsTempFile: boolean;

  if (payload.imagePath) {
    resolvedImagePath = payload.imagePath;
    ownsTempFile = false; // Caller is responsible for cleanup
  } else {
    // Legacy path: write buffer to disk here (backward-compat)
    resolvedImagePath = path.join(
      getExternalOcrTempRoot(),
      `${engine}-${randomUUID()}${mimeTypeToExtension(payload.imageMimeType)}`
    );
    await fs.promises.writeFile(resolvedImagePath, coerceImageBuffer(payload.imageData!));
    ownsTempFile = true;
  }

  try {
    const requestPayload: Record<string, unknown> = {
      id: payload.id,
      action: 'ocr',
      engine,
      ...(typeof payload.chunkIndex === 'number' ? { chunkIndex: payload.chunkIndex } : {}),
      ...(typeof payload.totalChunks === 'number' ? { totalChunks: payload.totalChunks } : {}),
      image: resolvedImagePath,
      language: payload.language,
      width: Math.round(payload.imageWidth),
      height: Math.round(payload.imageHeight),
      dpi: Math.round(payload.dpi),
      ...(typeof payload.pageSegMode === 'number' ? { pageSegMode: payload.pageSegMode } : {}),
      ...(payload.pipelineProfile ? { pipelineProfile: payload.pipelineProfile } : {}),
      ...(payload.ocrQualityProfile ? { qualityProfile: payload.ocrQualityProfile } : {}),
      // Forward maxSideLen to Python bridge (capped at 6000 to prevent Donut Effect)
      ...(typeof payload.maxSideLen === 'number'
        ? { maxSideLen: Math.min(Math.max(1, payload.maxSideLen), 6000) }
        : {}),
      ...(typeof payload.maxPixels === 'number' ? { maxPixels: payload.maxPixels } : {}),
      ...(typeof payload.useAngleCls === 'boolean' ? { useAngleCls: payload.useAngleCls } : {}),
      ...(typeof payload.use_angle_cls === 'boolean' ? { use_angle_cls: payload.use_angle_cls } : {}),
    };

    let response: ExternalOcrBridgeResponse;
    const emptyNoTextResponse: ExternalOcrBridgeResponse = {
      ok: true,
      engine,
      words: [],
      lines: [],
      text: '',
      confidence: 0,
      ...(typeof payload.pageSegMode === 'number' ? { pageSegMode: payload.pageSegMode } : {}),
      debug: {
        dropCounts: {},
        droppedWords: [],
        skipReason: 'noTextBoxesFromPaddleOCR',
      },
    };

    try {
      try {
        response = await requestDaemon(engine, requestPayload);
      } catch (error) {
        if (isNoTextBoxesError(error)) {
          return emptyNoTextResponse;
        }
        if (!isRecoverableDaemonError(error)) {
          throw error;
        }
        teardownDaemon(
          engine,
          error instanceof Error ? error : new Error(String(error))
        );
        try {
          response = await requestDaemon(engine, requestPayload);
        } catch (retryError) {
          if (isNoTextBoxesError(retryError)) {
            return emptyNoTextResponse;
          }
          throw retryError;
        }
      }

      if (!response.ok) {
        throw new Error(response.reason || `External OCR engine "${engine}" failed`);
      }
    } catch (primaryError) {
      if (engine === 'paddleocr') {
        console.warn(
          `[ocrBridge] paddleocr failed with error: ${primaryError instanceof Error ? primaryError.message : String(primaryError)}. Performing seamless auto-fallback to easyocr...`
        );
        try {
          const fallbackPayload = {
            ...requestPayload,
            engine: 'easyocr',
          };
          response = await requestDaemon('easyocr', fallbackPayload);
          if (response.ok) {
            response.engine = 'easyocr';
            if (response.debug && typeof response.debug === 'object') {
              (response.debug as Record<string, unknown>).fallbackFromEngine = 'paddleocr';
              (response.debug as Record<string, unknown>).fallbackReason =
                primaryError instanceof Error ? primaryError.message : String(primaryError);
            }
            return response;
          }
        } catch (fallbackError) {
          console.error(
            `[ocrBridge] easyocr fallback also failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`
          );
        }
      }
      throw primaryError;
    }

    return response;
  } finally {
    if (ownsTempFile) {
      await fs.promises.rm(resolvedImagePath, { force: true });
    }
  }
}

export async function runExternalOcrRaw(payload: {
  imagePath?: string;
  imageData?: Uint8Array | ArrayBuffer;
  imageMimeType: string;
  imageWidth: number;
  imageHeight: number;
  language: string;
  engine?: string;
}): Promise<ExternalOcrBridgeResponse> {
  if (!payload.imagePath && !payload.imageData) {
    throw new Error('ExternalOcrRequestPayload must provide either imagePath or imageData');
  }

  const engine: ExternalBridgeEngine = payload.engine === 'easyocr' ? 'easyocr' : 'paddleocr';

  let resolvedImagePath: string;
  let ownsTempFile: boolean;

  if (payload.imagePath) {
    resolvedImagePath = payload.imagePath;
    ownsTempFile = false;
  } else {
    resolvedImagePath = path.join(
      getExternalOcrTempRoot(),
      `raw-${engine}-${randomUUID()}${mimeTypeToExtension(payload.imageMimeType)}`
    );
    await fs.promises.writeFile(resolvedImagePath, coerceImageBuffer(payload.imageData!));
    ownsTempFile = true;
  }

  try {
    const requestPayload: Record<string, unknown> = {
      action: 'raw_ocr',
      engine,
      image: resolvedImagePath,
      language: payload.language,
      width: Math.round(payload.imageWidth),
      height: Math.round(payload.imageHeight),
    };

    let response: ExternalOcrBridgeResponse;
    try {
      response = await requestDaemon(engine, requestPayload);
    } catch (error) {
      if (!isRecoverableDaemonError(error)) {
        throw error;
      }
      teardownDaemon(
        engine,
        error instanceof Error ? error : new Error(String(error))
      );
      try {
        response = await requestDaemon(engine, requestPayload);
      } catch (retryError) {
        throw retryError;
      }
    }

    if (!response.ok) {
      throw new Error(response.reason || `External OCR engine "${engine}" failed`);
    }

    return response;
  } finally {
    if (ownsTempFile) {
      await fs.promises.rm(resolvedImagePath, { force: true });
    }
  }
}

const activePrewarmPromises = new Map<string, Promise<ExternalOcrWarmupResponse>>();
const recentPrewarmTimestamps = new Map<string, number>();
const PREWARM_DEDUPE_TTL_MS = 60_000; // 60s cache window to prevent repeated warmups

export async function prewarmExternalOcrEngine(
  engine: ExternalBridgeEngine,
  language: string = 'eng'
): Promise<ExternalOcrWarmupResponse> {
  const cacheKey = `${engine}:${language}`;
  const now = Date.now();
  const lastPrewarmed = recentPrewarmTimestamps.get(cacheKey);

  // Return instantly if successfully prewarmed recently
  if (lastPrewarmed && now - lastPrewarmed < PREWARM_DEDUPE_TTL_MS) {
    return {
      ok: true,
      engine,
      runtime: 'Python bridge',
      description: `${engine} already warm (${language})`,
    };
  }

  // Deduplicate in-flight prewarm requests
  const existingPromise = activePrewarmPromises.get(cacheKey);
  if (existingPromise) {
    return await existingPromise;
  }

  const prewarmPromise = (async () => {
    try {
      const response = await requestDaemon(engine, {
        action: 'prewarm',
        engine,
        language,
      });

      if (!response.ok) {
        throw new Error(response.reason || `Failed to prewarm external OCR engine "${engine}"`);
      }

      recentPrewarmTimestamps.set(cacheKey, Date.now());

      return {
        ok: true,
        engine,
        runtime: response.runtime || 'Python bridge',
        description: response.description || `${engine} warmed`,
      };
    } finally {
      activePrewarmPromises.delete(cacheKey);
    }
  })();

  activePrewarmPromises.set(cacheKey, prewarmPromise);
  return await prewarmPromise;
}

export function cancelExternalOcr(engine?: ExternalBridgeEngine): void {
  if (engine) {
    for (const key of Array.from(recentPrewarmTimestamps.keys())) {
      if (key.startsWith(`${engine}:`)) {
        recentPrewarmTimestamps.delete(key);
      }
    }
    activePrewarmPromises.delete(engine);
    teardownDaemon(engine, new Error(`External OCR canceled for ${engine}`));
    return;
  }
  recentPrewarmTimestamps.clear();
  activePrewarmPromises.clear();
  disposeExternalOcrDaemons();
}

export async function clearExternalOcrCudaCache(engine: ExternalBridgeEngine): Promise<void> {
  const response = await requestDaemon(engine, { action: 'cleanup', engine });
  if (!response.ok) {
    throw new Error(response.reason || `Failed to clear CUDA cache for engine "${engine}"`);
  }
}
