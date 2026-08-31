import { app, ipcMain } from 'electron';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  getExternalOcrEngineStatuses,
  prewarmExternalOcrEngine,
  writeOcrTempImage,
  deleteOcrTempImage,
  runExternalOcr,
  runExternalOcrRaw,
  cancelExternalOcr,
  clearExternalOcrCudaCache
} from '../ocrBridge';
import { isValidString, isValidNumber } from './ipcUtils';

const execAsync = promisify(exec);

export function registerOcrIpcHandlers() {
  ipcMain.handle('ocr:get-engine-status', async () => {
    try {
      return await getExternalOcrEngineStatuses();
    } catch (error) {
      console.error('ocr:get-engine-status error:', error);
      return [];
    }
  });

  ipcMain.handle('ocr:get-gpu-info', async () => {
    try {
      let gpuNames: string[] = [];
      if (process.platform === 'win32') {
        try {
          const { stdout } = await execAsync('powershell -Command "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"', { windowsHide: true });
          gpuNames = stdout.split('\n').map((x: string) => x.trim()).filter(Boolean);
          if (gpuNames.length === 0) {
            const { stdout: wmiStdout } = await execAsync('powershell -Command "Get-WmiObject Win32_VideoController | Select-Object -ExpandProperty Name"', { windowsHide: true });
            gpuNames = wmiStdout.split('\n').map((x: string) => x.trim()).filter(Boolean);
          }
        } catch (err) {
          console.warn('[Main] Failed to query GPU names via PowerShell:', err);
        }
      }

      if (gpuNames.length === 0) {
        try {
          const gpuInfo: any = await app.getGPUInfo('basic');
          if (gpuInfo?.gpuDevice) {
            gpuNames = gpuInfo.gpuDevice.map((device: any) => device.deviceString || device.vendorString || 'Unknown GPU');
          }
        } catch (err) {
          console.warn('[Main] Failed to query GPU info via Electron getGPUInfo:', err);
        }
      }

      // Filter out duplicate or empty values
      gpuNames = Array.from(new Set(gpuNames.map(g => g.trim()))).filter(Boolean);

      const hasNvidia = gpuNames.some(g => g.toLowerCase().includes('nvidia'));
      const hasIntel = gpuNames.some(g => g.toLowerCase().includes('intel'));
      const hasAmd = gpuNames.some(g => {
        const lower = g.toLowerCase();
        return lower.includes('amd') || lower.includes('radeon');
      });

      // Determine primary GPU vendor (priority: nvidia > amd > intel)
      let gpuVendor: 'nvidia' | 'amd' | 'intel' | 'unknown' = 'unknown';
      if (hasNvidia) {
        gpuVendor = 'nvidia';
      } else if (hasAmd) {
        gpuVendor = 'amd';
      } else if (hasIntel) {
        gpuVendor = 'intel';
      }

      // Find local virtualenv path to check if DirectML / CUDA is installed
      let hasDirectML = false;
      let hasCuda = false;

      const seen = new Set<string>();
      const searchRoots = [
        process.cwd(),
        app.getAppPath(),
        path.resolve(app.getAppPath(), '..'),
        path.resolve(__dirname, '..'),
        path.dirname(process.execPath),
        path.resolve(path.dirname(process.execPath), '..'),
        path.resolve(path.dirname(process.execPath), '../..'),
        process.resourcesPath,
        process.resourcesPath ? path.resolve(process.resourcesPath, '..') : null,
        process.env.PORTABLE_EXECUTABLE_DIR,
      ];
      if (typeof (global as any).__DEV_PROJECT_ROOT__ !== 'undefined' && (global as any).__DEV_PROJECT_ROOT__) {
        searchRoots.push((global as any).__DEV_PROJECT_ROOT__);
      }

      // Add roots from environment variables if present
      const envPythonPaths = [
        process.env.OCR_PYTHON_PATH,
        process.env.PADDLE_OCR_PYTHON_PATH,
        process.env.EASY_YOLO_OCR_PYTHON_PATH,
      ];
      for (const envPath of envPythonPaths) {
        if (envPath) {
          const resolvedEnv = path.resolve(envPath);
          if (resolvedEnv.toLowerCase().endsWith('python.exe') || resolvedEnv.toLowerCase().endsWith('python')) {
            const venvRoot = path.resolve(path.dirname(resolvedEnv), '..');
            searchRoots.push(venvRoot);
            searchRoots.push(path.resolve(venvRoot, '..'));
          } else {
            searchRoots.push(resolvedEnv);
          }
        }
      }

      for (const root of searchRoots) {
        if (!root) continue;
        const resolvedRoot = path.resolve(root);
        if (seen.has(resolvedRoot)) continue;
        seen.add(resolvedRoot);

        // Check if the resolvedRoot is directly a virtual environment itself
        const directSitePackages = path.join(resolvedRoot, 'Lib', 'site-packages');
        if (fs.existsSync(directSitePackages)) {
          const hasTorchDml = fs.existsSync(path.join(directSitePackages, 'torch_directml'));
          const hasOnnxDml1 = fs.existsSync(path.join(directSitePackages, 'onnxruntime_directml'));
          const hasOnnxDml2 = fs.existsSync(path.join(directSitePackages, 'onnxruntime-directml'));
          if (hasTorchDml || hasOnnxDml1 || hasOnnxDml2) {
            hasDirectML = true;
          }
          if (fs.existsSync(path.join(directSitePackages, 'torch', 'cuda'))) {
            hasCuda = true;
          }
        }

        for (const venvDir of ['.venv-ocr', '.venv']) {
          const venvPath = path.join(resolvedRoot, venvDir);
          if (fs.existsSync(venvPath)) {
            const sitePackagesPath = path.join(venvPath, 'Lib', 'site-packages');
            if (fs.existsSync(sitePackagesPath)) {
              const hasTorchDml = fs.existsSync(path.join(sitePackagesPath, 'torch_directml'));
              const hasOnnxDml1 = fs.existsSync(path.join(sitePackagesPath, 'onnxruntime_directml'));
              const hasOnnxDml2 = fs.existsSync(path.join(sitePackagesPath, 'onnxruntime-directml'));
              if (hasTorchDml || hasOnnxDml1 || hasOnnxDml2) {
                hasDirectML = true;
              }
              if (fs.existsSync(path.join(sitePackagesPath, 'torch', 'cuda'))) {
                hasCuda = true;
              }
            }
          }
        }
      }

      // Check environment override
      if (process.env.OCR_USE_DIRECTML === '1') {
        hasDirectML = true;
      }
      if (process.env.OCR_USE_GPU === '1') {
        hasCuda = true;
      }

      let mode: 'CUDA' | 'DirectML' | 'CPU' = 'CPU';
      if (hasCuda && hasNvidia) {
        mode = 'CUDA';
      } else if (hasDirectML) {
        mode = 'DirectML';
      }

      console.log(`[ocr:get-gpu-info] Mode resolved: ${mode} (gpus: ${gpuNames.join(', ') || 'none'})`);

      return {
        gpus: gpuNames.length > 0 ? gpuNames : ['CPU Display Adapter'],
        hasDirectML,
        hasCuda: hasCuda && hasNvidia,
        mode,
        gpuVendor,
      };
    } catch (error) {
      console.error('ocr:get-gpu-info error:', error);
      return {
        gpus: ['Unknown GPU'],
        hasDirectML: false,
        hasCuda: false,
        mode: 'CPU' as const,
        gpuVendor: 'unknown' as const,
      };
    }
  });

  ipcMain.handle('ocr:prewarm-engine', async (_, payload: { engine: string; language?: string }) => {
    if (!payload || typeof payload !== 'object' || !isValidString(payload.engine)) {
      throw new Error('Invalid OCR prewarm payload');
    }

    if (payload.engine !== 'paddleocr' && payload.engine !== 'easyocr') {
      throw new Error(`Unsupported OCR engine: ${payload.engine}`);
    }

    try {
      return await prewarmExternalOcrEngine(payload.engine, isValidString(payload.language) ? payload.language : 'eng');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/canceled|stopped unexpectedly|daemon process died/i.test(message)) {
        console.warn(`ocr:prewarm-engine safely canceled for ${payload.engine}: ${message}`);
        return {
          ok: false,
          engine: payload.engine,
          runtime: 'none',
          description: `Prewarm canceled (${message})`,
        };
      }
      console.error('ocr:prewarm-engine error:', error);
      return {
        ok: false,
        engine: payload.engine,
        runtime: 'none',
        description: message,
      };
    }
  });

  ipcMain.handle('ocr:write-temp-image', async (_, payload: {
    imageData: Uint8Array | ArrayBuffer;
    imageMimeType: string;
  }) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid ocr:write-temp-image payload');
    }
    if (!isValidString(payload.imageMimeType)) {
      throw new Error('Invalid ocr:write-temp-image payload: imageMimeType is required');
    }
    if (!payload.imageData) {
      throw new Error('Invalid ocr:write-temp-image payload: imageData is required');
    }
    try {
      const imagePath = await writeOcrTempImage(payload.imageData, payload.imageMimeType);
      return { imagePath };
    } catch (error) {
      console.error('ocr:write-temp-image error:', error);
      throw error;
    }
  });

  ipcMain.handle('ocr:delete-temp-image', async (_, payload: {
    imagePath: string;
  }) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid ocr:delete-temp-image payload');
    }
    if (!isValidString(payload.imagePath)) {
      throw new Error('Invalid ocr:delete-temp-image payload: imagePath is required');
    }
    try {
      await deleteOcrTempImage(payload.imagePath);
      return { ok: true };
    } catch (error) {
      console.error('ocr:delete-temp-image error:', error);
      throw error;
    }
  });

  ipcMain.handle('ocr:run-external', async (_, payload: {
    engine: string;
    imagePath?: string;
    imageData?: Uint8Array | ArrayBuffer;
    imageMimeType: string;
    imageWidth: number;
    imageHeight: number;
    language: string;
    dpi: number;
    pageSegMode?: number;
    pipelineProfile?: string;
    ocrQualityProfile?: string;
    maxSideLen?: number;
    chunkIndex?: number;
    totalChunks?: number;
  }) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid OCR payload');
    }
    if (!isValidString(payload.engine) || !isValidString(payload.imageMimeType) || !isValidString(payload.language)) {
      throw new Error('Invalid OCR payload: engine, imageMimeType, and language are required');
    }
    if (!isValidNumber(payload.imageWidth) || !isValidNumber(payload.imageHeight) || !isValidNumber(payload.dpi)) {
      throw new Error('Invalid OCR payload: imageWidth, imageHeight, and dpi must be positive numbers');
    }
    if (!payload.imagePath && !payload.imageData) {
      throw new Error('Invalid OCR payload: either imagePath or imageData must be provided');
    }
    if (payload.imagePath) {
      const resolvedPath = path.resolve(payload.imagePath);
      const tempRoot = path.join(os.tmpdir(), 'pdf-translator-ocr');
      if (!resolvedPath.startsWith(tempRoot)) {
        throw new Error('Invalid OCR payload: imagePath must be within the OCR temp directory');
      }
    }

    try {
      return await runExternalOcr(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/External OCR canceled for (paddleocr|easyocr)/i.test(message)) {
        console.warn(`ocr:run-external canceled: ${message}`);
      } else {
        console.error('ocr:run-external error:', error);
      }
      throw error;
    }
  });

  ipcMain.handle('ocr:run-raw-direct', async (_, payload: {
    imagePath?: string;
    imageData?: Uint8Array | ArrayBuffer;
    imageMimeType: string;
    imageWidth: number;
    imageHeight: number;
    language: string;
  }) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid OCR payload');
    }
    if (!isValidString(payload.imageMimeType) || !isValidString(payload.language)) {
      throw new Error('Invalid OCR payload: imageMimeType and language are required');
    }
    if (!isValidNumber(payload.imageWidth) || !isValidNumber(payload.imageHeight)) {
      throw new Error('Invalid OCR payload: imageWidth and imageHeight must be positive numbers');
    }
    if (!payload.imagePath && !payload.imageData) {
      throw new Error('Invalid OCR payload: either imagePath or imageData must be provided');
    }

    try {
      return await runExternalOcrRaw(payload);
    } catch (error) {
      console.error('ocr:run-raw-direct error:', error);
      throw error;
    }
  });

  ipcMain.handle('ocr:cancel-external', async (_, payload?: { engine?: string }) => {
    try {
      const engine = payload?.engine;
      if (engine && engine !== 'paddleocr' && engine !== 'easyocr') {
        throw new Error(`Unsupported OCR engine: ${engine}`);
      }
      cancelExternalOcr(engine as 'paddleocr' | 'easyocr' | undefined);
      return true;
    } catch (error) {
      console.error('ocr:cancel-external error:', error);
      return false;
    }
  });

  ipcMain.handle('ocr:clear-cuda-cache', async (_, payload: { engine: string }) => {
    try {
      const engine = payload?.engine;
      if (engine !== 'paddleocr' && engine !== 'easyocr') {
        throw new Error(`Unsupported OCR engine for CUDA clear: ${engine}`);
      }
      await clearExternalOcrCudaCache(engine);
      return true;
    } catch (error) {
      console.error('ocr:clear-cuda-cache error:', error);
      return false;
    }
  });
}
