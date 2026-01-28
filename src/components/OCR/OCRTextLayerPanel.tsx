/**
 * OCRTextLayerPanel - UI สำหรับสร้าง Searchable PDF ด้วย OCR
 * 
 * Features:
 * - เลือกภาษา OCR
 * - เลือก Quality Profile (DPI)
 * - แสดง Progress
 * - Export PDF
 */

import React, { useCallback, useRef } from 'react';
import { 
  FileText, 
  Settings, 
  Play, 
  Download, 
  RefreshCw,
  Languages,
  Zap,
  CheckCircle,
  AlertCircle
} from 'lucide-react';
import { useOCRTextLayerStore, SUPPORTED_LANGUAGES, OCR_PROFILES } from '../../stores/useOCRTextLayerStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { searchablePDFService } from '../../services/pdf';

// PDF.js will be imported dynamically when needed

export const OCRTextLayerPanel: React.FC = () => {
  const { file, fileUrl } = useProjectStore();
  const {
    options,
    setOptions,
    isProcessing,
    progress,
    setProgress,
    setIsProcessing,
    searchablePDFBlob,
    setSearchablePDFBlob,
    reset
  } = useOCRTextLayerStore();

  const canvasRef = useRef<HTMLCanvasElement>(null);

  /**
   * Render PDF page to canvas at specified DPI
   * 
   * Strategy: Capture the existing canvas from react-pdf if it exists,
   * otherwise fall back to manual pdfjs rendering
   */
  const renderPageToCanvas = useCallback(async (pageNum: number, targetDpi: number) => {
    if (!file) throw new Error('No PDF loaded');

    console.log(`[OCRPanel] Rendering page ${pageNum} at ${targetDpi} DPI...`);

    // Strategy 1: Try to capture existing canvas from react-pdf
    // This is more reliable because react-pdf already handles JPEG decoding
    const existingCanvas = document.querySelector(
      `.react-pdf__Page[data-page-number="${pageNum}"] canvas`
    ) as HTMLCanvasElement | null;

    if (existingCanvas && existingCanvas.width > 0 && existingCanvas.height > 0) {
      console.log(`[OCRPanel] Found existing canvas for page ${pageNum}: ${existingCanvas.width}x${existingCanvas.height}`);
      
      // DEBUG: Check if existing canvas has actual content (sample CENTER of canvas)
      const debugCtx = existingCanvas.getContext('2d');
      if (debugCtx) {
        // Sample from center of canvas instead of top-left
        const centerX = Math.floor(existingCanvas.width / 2) - 50;
        const centerY = Math.floor(existingCanvas.height / 2) - 50;
        const sampleData = debugCtx.getImageData(
          Math.max(0, centerX), 
          Math.max(0, centerY), 
          100, 
          100
        );
        let nonWhitePixels = 0;
        for (let i = 0; i < sampleData.data.length; i += 4) {
          if (sampleData.data[i] !== 255 || sampleData.data[i+1] !== 255 || sampleData.data[i+2] !== 255) {
            nonWhitePixels++;
          }
        }
        console.log(`[OCRPanel] Canvas CENTER sample: ${nonWhitePixels} non-white pixels`);
        
        if (nonWhitePixels < 100) {
          console.warn('[OCRPanel] WARNING: Canvas center appears mostly empty!');
        }
      }
      
      // Calculate current DPI estimate
      const currentWidth = existingCanvas.width;
      const currentHeight = existingCanvas.height;
      const estimatedCurrentDpi = Math.round((currentWidth / 595) * 72);
      
      console.log(`[OCRPanel] Existing canvas estimated DPI: ${estimatedCurrentDpi}`);

      // Upscale if DPI is too low (< 200) or user requested higher
      // Tesseract works best at 300 DPI
      const shouldUpscale = estimatedCurrentDpi < 200 || targetDpi > estimatedCurrentDpi;
      
      let outputWidth = currentWidth;
      let outputHeight = currentHeight;
      
      if (shouldUpscale) {
        const scaleFactor = Math.min(targetDpi / Math.max(estimatedCurrentDpi, 72), 4.0); // Cap at 4x
        outputWidth = Math.round(currentWidth * scaleFactor);
        outputHeight = Math.round(currentHeight * scaleFactor);
        console.log(`[OCRPanel] Upscaling by ${scaleFactor.toFixed(2)}x to ${outputWidth}x${outputHeight} (${targetDpi} DPI target)`);
      } else {
        console.log(`[OCRPanel] Using original size ${outputWidth}x${outputHeight} (Sufficient DPI)`);
      }
      
      const outputCanvas = document.createElement('canvas');
      outputCanvas.width = outputWidth;
      outputCanvas.height = outputHeight;
      const ctx = outputCanvas.getContext('2d');
      
      if (!ctx) throw new Error('Cannot get canvas context');
      
      // Fill with white background first
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, outputWidth, outputHeight);
      
      // Draw existing canvas (scaled or 1:1)
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(existingCanvas, 0, 0, outputWidth, outputHeight);
      
      return {
        canvas: outputCanvas,
        width: outputWidth,
        height: outputHeight
      };
    }

    // Strategy 2: Navigate to the page and wait for canvas to appear
    console.log(`[OCRPanel] Navigating to page ${pageNum} and waiting for canvas...`);
    
    const { setPage } = useProjectStore.getState();
    const previousPage = useProjectStore.getState().currentPage;
    
    // Navigate to target page
    setPage(pageNum);
    
    // Wait for canvas to appear (with timeout)
    const startTime = Date.now();
    const maxWaitTime = 10000; // 10 seconds
    
    while (Date.now() - startTime < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms
      
      const newCanvas = document.querySelector(
        `.react-pdf__Page[data-page-number="${pageNum}"] canvas`
      ) as HTMLCanvasElement | null;
      
      if (newCanvas && newCanvas.width > 0 && newCanvas.height > 0) {
        console.log(`[OCRPanel] Canvas appeared for page ${pageNum}: ${newCanvas.width}x${newCanvas.height}`);
        
        // Calculate scaling
        const currentWidth = newCanvas.width;
        const currentHeight = newCanvas.height;
        const estimatedCurrentDpi = Math.round((currentWidth / 595) * 72);
        const scaleFactor = targetDpi / Math.max(estimatedCurrentDpi, 72);
        
        const outputWidth = Math.round(currentWidth * scaleFactor);
        const outputHeight = Math.round(currentHeight * scaleFactor);
        
        const outputCanvas = document.createElement('canvas');
        outputCanvas.width = outputWidth;
        outputCanvas.height = outputHeight;
        const ctx = outputCanvas.getContext('2d');
        
        if (!ctx) throw new Error('Cannot get canvas context');
        
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, outputWidth, outputHeight);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(newCanvas, 0, 0, outputWidth, outputHeight);
        
        console.log(`[OCRPanel] Page ${pageNum} upscaled to ${outputWidth}x${outputHeight}`);
        
        // Restore previous page (optional, can comment out if not needed)
        // setPage(previousPage);
        
        return {
          canvas: outputCanvas,
          width: outputWidth,
          height: outputHeight
        };
      }
    }
    
    // Timeout - restore previous page
    setPage(previousPage);
    throw new Error(`Timeout waiting for page ${pageNum} canvas to render`);
  }, [file]);

  /**
   * Start OCR processing
   */
  const handleStartOCR = useCallback(async (targetPages?: number[]) => {
    if (!file || !fileUrl) {
      console.error('No file loaded');
      return;
    }

    try {
      setIsProcessing(true);
      
      // Set initial progress (don't call reset() here!)
      setProgress({
        stage: 'init',
        currentPage: 0,
        totalPages: 0,
        message: 'กำลังเริ่มต้น...',
        progress: 0
      });

      // Set up progress callback
      searchablePDFService.setProgressCallback(setProgress);

      // Read file as ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();

      // Create searchable PDF
      const resultBytes = await searchablePDFService.createSearchablePDF(
        arrayBuffer,
        options,
        renderPageToCanvas,
        targetPages
      );

      // Convert to Blob (cast for TypeScript compatibility)
      const blob = new Blob([resultBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
      setSearchablePDFBlob(blob);

      console.log('[OCRPanel] Searchable PDF created successfully!');
    } catch (error) {
      console.error('[OCRPanel] OCR processing failed:', error);
      setProgress({
        stage: 'complete',
        currentPage: 0,
        totalPages: 0,
        message: `เกิดข้อผิดพลาด: ${error instanceof Error ? error.message : 'Unknown error'}`,
        progress: 0
      });
    } finally {
      setIsProcessing(false);
    }
  }, [file, fileUrl, options, renderPageToCanvas, setIsProcessing, setProgress, setSearchablePDFBlob]);

  /**
   * Download the searchable PDF
   */
  const handleDownload = useCallback(() => {
    if (!searchablePDFBlob || !file) return;

    const url = URL.createObjectURL(searchablePDFBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name.replace('.pdf', '_searchable.pdf');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [searchablePDFBlob, file]);

  // Current profile
  const currentProfile = OCR_PROFILES.find(p => p.dpi === options.dpi) || OCR_PROFILES[2];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 text-sm font-bold text-slate-200">
        <FileText size={16} className="text-cyan-400" />
        OCR Text Layer
      </div>

      {/* Language Selector */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <Languages size={12} />
          OCR Language
        </label>
        <select
          value={options.language}
          onChange={(e) => setOptions({ language: e.target.value })}
          disabled={isProcessing}
          className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500 disabled:opacity-50"
        >
          {SUPPORTED_LANGUAGES.map(lang => (
            <option key={lang.code} value={lang.code}>
              {lang.name}
            </option>
          ))}
        </select>
      </div>

      {/* Quality Profile */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <Settings size={12} />
          Quality Profile
        </label>
        <div className="grid grid-cols-3 gap-1">
          {OCR_PROFILES.map(profile => (
            <button
              key={profile.id}
              onClick={() => setOptions({ dpi: profile.dpi, profile: profile.id as any })}
              disabled={isProcessing}
              className={`px-2 py-1.5 rounded-lg text-[10px] font-medium transition-all ${
                currentProfile.id === profile.id
                  ? 'bg-cyan-600 text-white shadow-lg'
                  : 'bg-slate-700 text-slate-400 hover:bg-slate-600 border border-slate-600'
              } disabled:opacity-50`}
              title={profile.description}
            >
              {profile.name}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-slate-500 italic">
          DPI: {options.dpi} • {currentProfile.description}
        </p>
      </div>

      {/* Progress Bar */}
      {isProcessing && (
        <div className="space-y-2 bg-slate-700/50 rounded-lg p-3 border border-slate-600">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-300 truncate max-w-[180px]">
              {progress?.message || 'กำลังเริ่มต้น...'}
            </span>
            <span className="text-cyan-400 font-mono">
              {progress ? Math.round(progress.progress) : 0}%
            </span>
          </div>
          <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-150"
              style={{ width: `${progress?.progress || 0}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>
              {progress?.stage === 'rendering' && '📄 Rendering...'}
              {progress?.stage === 'ocr' && '🔍 OCR Processing...'}
              {progress?.stage === 'text-layer' && '✍️ Adding Text...'}
              {progress?.stage === 'saving' && '💾 Saving...'}
              {!progress && '⏳ Initializing...'}
            </span>
            <span>
              {progress?.currentPage || 0} / {progress?.totalPages || '?'}
            </span>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="space-y-2">
        <div className="flex gap-2">
          {/* Main Button - All Pages */}
          <button
            onClick={() => handleStartOCR()}
            disabled={isProcessing || !file}
            className="flex-1 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2.5 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg"
            title="Process all pages"
          >
            {isProcessing ? (
              <>
                <RefreshCw size={16} className="animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Play size={16} fill="currentColor" />
                All Pages
              </>
            )}
          </button>

          {/* Current Page Button */}
          <button
            onClick={() => handleStartOCR([useProjectStore.getState().currentPage])}
            disabled={isProcessing || !file}
            className="w-12 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2.5 rounded-lg flex items-center justify-center transition-all shadow-lg border border-slate-600"
            title="Process current page only"
          >
            <span className="text-xs font-bold">Curr</span>
          </button>
        </div>

        {searchablePDFBlob && !isProcessing && (
          <button
            onClick={handleDownload}
            className="w-full bg-green-600 hover:bg-green-500 text-white py-2.5 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg"
          >
            <Download size={16} />
            Download Searchable PDF
          </button>
        )}
      </div>

      {/* Success Message */}
      {searchablePDFBlob && !isProcessing && (
        <div className="flex items-start gap-2 bg-green-900/30 border border-green-700 rounded-lg p-3">
          <CheckCircle size={16} className="text-green-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs">
            <p className="text-green-300 font-medium">สร้าง Searchable PDF สำเร็จ!</p>
            <p className="text-green-400/70 mt-1">
              คุณสามารถ select และ copy ข้อความจาก PDF ได้แล้ว
            </p>
          </div>
        </div>
      )}

      {/* Info */}
      <div className="text-[10px] text-slate-500 leading-relaxed">
        <p className="flex items-start gap-1">
          <Zap size={10} className="flex-shrink-0 mt-0.5 text-yellow-500" />
          <span>
            ฟีเจอร์นี้จะเพิ่ม invisible text layer บน PDF ทำให้ค้นหาและ copy ข้อความได้ เหมือน PDF24
          </span>
        </p>
      </div>

      {/* Hidden canvas for rendering */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};
