/**
 * Enhanced Vision Worker - Smart OCR & Segmentation
 * 
 * Features:
 * - Stable Tesseract.js integration with error recovery
 * - Smart region classification (text, balloon, sfx)
 * - Improved TSV parsing for word-level OCR
 * - Document type aware segmentation
 */

import { createWorker, PSM, OEM } from 'tesseract.js';

// ============================================
// Types
// ============================================

interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface OCRBlock {
  text: string;
  confidence: number;
  bbox: BBox;
  blockType?: 'text' | 'image' | 'separator' | 'unknown';
}

interface TesseractResult {
  data: {
    text: string;
    confidence: number;
    blocks?: OCRBlock[];
    lines?: Array<{ text: string; confidence: number; bbox: BBox; words: unknown[] }>;
    words?: Array<{ text: string; confidence: number; bbox: BBox }>;
    hocr?: string;
    tsv?: string;
  };
}

type DocumentType = 'manga' | 'document';

// ============================================
// State
// ============================================

let tesseractWorker: Awaited<ReturnType<typeof createWorker>> | null = null;
let currentLang = 'eng';
let isInitializing = false;

// ============================================
// Configuration
// ============================================

const CONFIG = {
  // Tesseract WASM core URL (stable version)
  CORE_PATH: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0/tesseract-core.wasm.js',
  
  // Region classification thresholds
  MIN_REGION_AREA: 100, // Minimum pixel area to consider
  MIN_CONFIDENCE: 20, // Minimum OCR confidence (0-100)
  
  // Balloon detection (for manga)
  BALLOON_ASPECT_RATIO_MIN: 0.3,
  BALLOON_ASPECT_RATIO_MAX: 3.5,
  BALLOON_DENSITY_THRESHOLD: 0.15, // Text density in region
  
  // SFX detection
  SFX_MIN_FONT_SIZE_RATIO: 0.1, // Relative to page height
  SFX_MAX_WORDS: 3,
};

// ============================================
// Helper Functions
// ============================================

/**
 * Send progress to main thread
 */
function sendProgress(status: string, progress: number, workerId?: string): void {
  self.postMessage({
    type: 'OCR_PROGRESS',
    payload: { status, progress, workerId }
  });
}

/**
 * Preprocess image: Load, validate, and re-render through canvas
 * This fixes corrupted JPEG issues and ensures proper dimensions
 * NOTE: Uses fetch + createImageBitmap because Image is not available in Workers
 */
async function preprocessImage(imageUrl: string): Promise<{
  processedUrl: string;
  width: number;
  height: number;
}> {
  try {
    // Fetch the image as blob
    let blob: Blob;
    
    if (imageUrl.startsWith('data:')) {
      // Convert data URL to blob
      const response = await fetch(imageUrl);
      blob = await response.blob();
    } else {
      const response = await fetch(imageUrl);
      blob = await response.blob();
    }
    
    // Create ImageBitmap (works in Workers)
    const imageBitmap = await createImageBitmap(blob);
    
    const width = imageBitmap.width;
    const height = imageBitmap.height;
    
    // Validate minimum dimensions
    if (width < 10 || height < 10) {
      imageBitmap.close();
      throw new Error(`Image too small: ${width}x${height}`);
    }
    
    // Create canvas and re-render image (fixes corrupted JPEG)
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      imageBitmap.close();
      throw new Error('Failed to create canvas context');
    }
    
    // Draw with white background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(imageBitmap, 0, 0, width, height);
    
    // Close the bitmap to free memory
    imageBitmap.close();
    
    // ============================================
    // OCR PREPROCESSING - Enhance for Tesseract
    // ============================================
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    
    // Parameters for enhancement
    const gamma = 0.95;      // Slightly brighten dark areas
    const contrast = 1.15;   // Increase contrast
    const brightness = 5;    // Slight brightness boost
    
    // Build gamma lookup table
    const gammaLUT = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      gammaLUT[i] = Math.min(255, Math.max(0, Math.round(255 * Math.pow(i / 255, gamma))));
    }
    
    // Process each pixel
    for (let i = 0; i < data.length; i += 4) {
      // Get RGB
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];
      
      // Apply gamma correction
      r = gammaLUT[r];
      g = gammaLUT[g];
      b = gammaLUT[b];
      
      // Apply contrast and brightness
      r = Math.min(255, Math.max(0, (r - 128) * contrast + 128 + brightness));
      g = Math.min(255, Math.max(0, (g - 128) * contrast + 128 + brightness));
      b = Math.min(255, Math.max(0, (b - 128) * contrast + 128 + brightness));
      
      // Convert to grayscale (weighted average)
      const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      
      // Write back as grayscale (still RGB format for compatibility)
      data[i] = gray;
      data[i + 1] = gray;
      data[i + 2] = gray;
      // Keep alpha as is
    }
    
    // Put processed image back
    ctx.putImageData(imageData, 0, 0);
    
    console.log(`[Worker] Image preprocessed with gamma=${gamma}, contrast=${contrast}`);
    
    // Convert to PNG (lossless, no JPEG artifacts)
    const outputBlob = await canvas.convertToBlob({ type: 'image/png' });
    
    // Convert blob to data URL
    const arrayBuffer = await outputBlob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const base64 = btoa(binary);
    const processedUrl = `data:image/png;base64,${base64}`;
    
    return { processedUrl, width, height };
  } catch (error) {
    console.error('[Worker] preprocessImage error:', error);
    throw error;
  }
}

/**
 * Get image dimensions using createImageBitmap
 */
async function getImageDimensions(imageUrl: string): Promise<{ width: number; height: number }> {
  try {
    let blob: Blob;
    
    if (imageUrl.startsWith('data:')) {
      const response = await fetch(imageUrl);
      blob = await response.blob();
    } else {
      const response = await fetch(imageUrl);
      blob = await response.blob();
    }
    
    const imageBitmap = await createImageBitmap(blob);
    const result = {
      width: imageBitmap.width,
      height: imageBitmap.height
    };
    imageBitmap.close();
    return result;
  } catch (error) {
    console.error('[Worker] getImageDimensions error:', error);
    throw error;
  }
}

/**
 * Create Tesseract worker with specific language
 */
async function createWorkerWithLanguage(
  lang: string, 
  sendUpdates: boolean = false
): Promise<Awaited<ReturnType<typeof createWorker>>> {
  console.log(`[Worker] Creating Tesseract worker for: ${lang}`);
  
  try {
    const worker = await createWorker(lang, OEM.LSTM_ONLY, {
      corePath: CONFIG.CORE_PATH,
      logger: m => {
        if (sendUpdates && m.status && typeof m.progress === 'number') {
          sendProgress(m.status, m.progress, m.workerId);
        }
      }
    });
    
    console.log(`[Worker] Tesseract initialized for: ${lang}`);
    return worker;
  } catch (err) {
    console.error(`[Worker] Failed to initialize Tesseract for ${lang}:`, err);
    throw err;
  }
}

/**
 * Get or create Tesseract worker (with language switching)
 */
async function getOrCreateWorker(targetLang: string): Promise<Awaited<ReturnType<typeof createWorker>>> {
  // Prevent concurrent initialization
  while (isInitializing) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  if (!tesseractWorker || currentLang !== targetLang) {
    isInitializing = true;
    
    try {
      if (tesseractWorker) {
        console.log(`[Worker] Switching language from ${currentLang} to ${targetLang}`);
        await tesseractWorker.terminate();
      }
      
      tesseractWorker = await createWorkerWithLanguage(targetLang, false);
      currentLang = targetLang;
    } finally {
      isInitializing = false;
    }
  }
  
  return tesseractWorker;
}

/**
 * Classify region type based on characteristics
 */
function classifyRegion(
  text: string, 
  bbox: BBox, 
  confidence: number,
  pageWidth: number,
  pageHeight: number,
  documentType: DocumentType
): 'text' | 'balloon' | 'sfx' | 'panel' {
  const width = bbox.x1 - bbox.x0;
  const height = bbox.y1 - bbox.y0;
  const area = width * height;
  const aspectRatio = width / Math.max(height, 1);
  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
  
  // Calculate relative size
  const relativeHeight = height / pageHeight;
  const relativeWidth = width / pageWidth;
  
  // For documents: everything is text
  if (documentType === 'document') {
    return 'text';
  }
  
  // For manga: classify based on characteristics
  
  // SFX detection: Large text, few words, often diagonal or stylized
  if (
    wordCount <= CONFIG.SFX_MAX_WORDS &&
    relativeHeight > CONFIG.SFX_MIN_FONT_SIZE_RATIO &&
    confidence < 70 // SFX often has lower OCR confidence due to stylization
  ) {
    return 'sfx';
  }
  
  // Balloon detection: medium-sized regions with reasonable aspect ratio
  if (
    aspectRatio >= CONFIG.BALLOON_ASPECT_RATIO_MIN &&
    aspectRatio <= CONFIG.BALLOON_ASPECT_RATIO_MAX &&
    wordCount >= 1 &&
    confidence >= CONFIG.MIN_CONFIDENCE
  ) {
    return 'balloon';
  }
  
  // Default to text for regular text blocks
  return 'text';
}

/**
 * Parse TSV output for word-level data
 */
function parseTSV(tsv: string): {
  words: Array<{ text: string; confidence: number; bbox: BBox }>;
  lines: Array<{ text: string; confidence: number; bbox: BBox; words: unknown[] }>;
} {
  const words: Array<{ text: string; confidence: number; bbox: BBox }> = [];
  const lines: Array<{ text: string; confidence: number; bbox: BBox; words: unknown[] }> = [];
  
  if (!tsv || typeof tsv !== 'string') {
    return { words, lines };
  }
  
  const tsvLines = tsv.split('\n');
  if (tsvLines.length < 2) {
    return { words, lines };
  }
  
  // Parse header
  const header = tsvLines[0].split('\t');
  const indices = {
    level: header.indexOf('level'),
    left: header.indexOf('left'),
    top: header.indexOf('top'),
    width: header.indexOf('width'),
    height: header.indexOf('height'),
    conf: header.indexOf('conf'),
    text: header.indexOf('text'),
  };
  
  // Validate header
  if (Object.values(indices).some(i => i === -1)) {
    console.warn('[Worker] Invalid TSV header');
    return { words, lines };
  }
  
  // Parse data rows
  for (let i = 1; i < tsvLines.length; i++) {
    const cols = tsvLines[i].split('\t');
    if (cols.length <= indices.text) continue;
    
    const level = parseInt(cols[indices.level] || '0');
    const text = cols[indices.text]?.trim() || '';
    
    if (text.length === 0) continue;
    
    const left = parseInt(cols[indices.left] || '0');
    const top = parseInt(cols[indices.top] || '0');
    const width = parseInt(cols[indices.width] || '0');
    const height = parseInt(cols[indices.height] || '0');
    const conf = parseFloat(cols[indices.conf] || '0');
    
    const bbox: BBox = {
      x0: left,
      y0: top,
      x1: left + width,
      y1: top + height
    };
    
    // Level 5 = word
    if (level === 5) {
      words.push({ text, confidence: conf, bbox });
    }
    
    // Level 4 = line
    if (level === 4) {
      lines.push({ text, confidence: conf, bbox, words: [] });
    }
  }
  
  return { words, lines };
}

/**
 * Group words into logical blocks/regions
 */
function groupWordsIntoRegions(
  words: Array<{ text: string; confidence: number; bbox: BBox }>,
  pageWidth: number,
  pageHeight: number,
  documentType: DocumentType
): Array<{
  id: string;
  type: 'text' | 'balloon' | 'sfx' | 'panel';
  box: { x: number; y: number; w: number; h: number };
  originalText: string;
  confidence: number;
}> {
  if (words.length === 0) return [];
  
  // Simple grouping: Merge nearby words
  const merged: Array<{
    words: typeof words;
    bbox: BBox;
  }> = [];
  
  const GAP_THRESHOLD_X = pageWidth * 0.05; // 5% of page width
  const GAP_THRESHOLD_Y = pageHeight * 0.02; // 2% of page height
  
  // Sort words by position (top-to-bottom, left-to-right)
  const sortedWords = [...words].sort((a, b) => {
    const yDiff = a.bbox.y0 - b.bbox.y0;
    if (Math.abs(yDiff) > GAP_THRESHOLD_Y) return yDiff;
    return a.bbox.x0 - b.bbox.x0;
  });
  
  for (const word of sortedWords) {
    let addedToGroup = false;
    
    // Try to add to existing group
    for (const group of merged) {
      const lastWord = group.words[group.words.length - 1];
      
      // Check if word is close to this group
      const xGap = word.bbox.x0 - group.bbox.x1;
      const yOverlap = Math.min(word.bbox.y1, group.bbox.y1) - Math.max(word.bbox.y0, group.bbox.y0);
      const yGap = Math.abs(word.bbox.y0 - group.bbox.y1);
      
      // Same line (y overlap) and close horizontally
      if (yOverlap > 0 && xGap < GAP_THRESHOLD_X && xGap > -word.bbox.x1) {
        group.words.push(word);
        group.bbox = {
          x0: Math.min(group.bbox.x0, word.bbox.x0),
          y0: Math.min(group.bbox.y0, word.bbox.y0),
          x1: Math.max(group.bbox.x1, word.bbox.x1),
          y1: Math.max(group.bbox.y1, word.bbox.y1),
        };
        addedToGroup = true;
        break;
      }
      
      // New line but close vertically and overlaps horizontally
      if (yGap < GAP_THRESHOLD_Y && yGap >= 0) {
        const xOverlap = Math.min(word.bbox.x1, group.bbox.x1) - Math.max(word.bbox.x0, group.bbox.x0);
        if (xOverlap > 0) {
          group.words.push(word);
          group.bbox = {
            x0: Math.min(group.bbox.x0, word.bbox.x0),
            y0: Math.min(group.bbox.y0, word.bbox.y0),
            x1: Math.max(group.bbox.x1, word.bbox.x1),
            y1: Math.max(group.bbox.y1, word.bbox.y1),
          };
          addedToGroup = true;
          break;
        }
      }
    }
    
    // Create new group if not added
    if (!addedToGroup) {
      merged.push({
        words: [word],
        bbox: { ...word.bbox },
      });
    }
  }
  
  // Convert to regions
  return merged.map((group, index) => {
    const text = group.words.map(w => w.text).join(' ');
    const avgConfidence = group.words.reduce((sum, w) => sum + w.confidence, 0) / group.words.length;
    
    const type = classifyRegion(
      text,
      group.bbox,
      avgConfidence,
      pageWidth,
      pageHeight,
      documentType
    );
    
    return {
      id: `region-${index}-${Date.now()}`,
      type,
      box: {
        x: group.bbox.x0,
        y: group.bbox.y0,
        w: group.bbox.x1 - group.bbox.x0,
        h: group.bbox.y1 - group.bbox.y0,
      },
      originalText: text,
      confidence: avgConfidence / 100,
    };
  }).filter(r => r.originalText.length > 0 && r.confidence >= CONFIG.MIN_CONFIDENCE / 100);
}

// ============================================
// Message Handler
// ============================================

self.onmessage = async (e: MessageEvent) => {
  const { type, payload, id } = e.data;

  try {
    switch (type) {
      // ============================================
      // INIT - Initialize OCR Engine
      // ============================================
      case 'INIT': {
        console.log('[Worker] Initializing Vision Worker...');
        await getOrCreateWorker('eng');
        self.postMessage({ type: 'INIT_SUCCESS', id });
        break;
      }

      // ============================================
      // OCR_FOR_TEXT_LAYER - Word-Level OCR
      // ============================================
      case 'OCR_FOR_TEXT_LAYER': {
        const { imageUrl, imageWidth, imageHeight, language = 'eng', dpi = 300 } = payload;
        console.log(`[Worker] OCR_FOR_TEXT_LAYER: ${imageWidth}x${imageHeight} @ ${dpi}DPI, Lang: ${language}`);
        
        sendProgress('Preprocessing image...', 0);
        
        // Preprocess image to fix corrupted JPEG and ensure valid dimensions
        let processedUrl = imageUrl;
        let actualWidth = Math.round(imageWidth);
        let actualHeight = Math.round(imageHeight);
        
        try {
          const preprocessed = await preprocessImage(imageUrl);
          processedUrl = preprocessed.processedUrl;
          actualWidth = preprocessed.width;
          actualHeight = preprocessed.height;
          console.log(`[Worker] Image preprocessed: ${actualWidth}x${actualHeight}`);
        } catch (preprocessError) {
          console.warn('[Worker] Image preprocessing failed, using original:', preprocessError);
          // Continue with original image
        }
        
        sendProgress('Initializing OCR...', 0.1);
        
        // Get or create worker with correct language
        const worker = await getOrCreateWorker(language);
        
        sendProgress('Configuring OCR...', 0.15);
        
        // Configure for detailed output
        await worker.setParameters({
          tessedit_create_hocr: '1',
          tessedit_create_tsv: '1',
          tessedit_create_pdf: '0',
          hocr_font_info: '1',
        });
        
        sendProgress('Recognizing text...', 0.2);
        
        // Run OCR on preprocessed image
        const result = await worker.recognize(processedUrl) as TesseractResult;
        
        sendProgress('Processing results...', 0.8);
        
        const data = result.data;
        
        // Debug raw OCR data
        console.log(`[Worker] Raw text length: ${data.text?.length || 0}`);
        if (data.tsv) {
          console.log(`[Worker] First 100 chars of TSV: ${data.tsv.substring(0, 100).replace(/\n/g, '\\n')}`);
        } else {
          console.warn('[Worker] No TSV data returned!');
        }

        // Parse TSV for word-level data
        let { words, lines } = parseTSV(data.tsv || '');
        
        // Fallback: If no words found but text exists, create a single large block
        // This handles cases where TSV parsing fails or structure is simple
        if (words.length === 0 && data.text && data.text.trim().length > 0) {
          console.log('[Worker] No words from TSV, creating fallback from raw text (split by lines)');
          
          const rawLines = data.text.split('\n').filter(l => l.trim().length > 0);
          const approxLineHeight = actualHeight / (rawLines.length + 2); // Add padding
          
          words = [];
          lines = [];
          
          rawLines.forEach((lineText, i) => {
            const y0 = (i + 1) * approxLineHeight; // Start from top margin
            const y1 = y0 + approxLineHeight;
            const bbox = { x0: 20, y0: y0, x1: actualWidth - 20, y1: y1 }; // Full width approx
            
            const lineWords = [{
              text: lineText.trim(),
              confidence: data.confidence || 0,
              bbox: bbox
            }];
            
            words.push(...lineWords);
            lines.push({
              text: lineText.trim(),
              confidence: data.confidence || 0,
              bbox: bbox,
              words: lineWords
            });
          });
        }
        
        console.log(`[Worker] OCR complete: ${words.length} words, ${lines.length} lines, confidence: ${data.confidence?.toFixed(1)}%`);
        
        const pageResult = {
          pageNumber: 1,
          width: actualWidth,
          height: actualHeight,
          dpi: dpi,
          language: language,
          lines: lines,
          words: words,
          text: data.text || '',
          confidence: data.confidence || 0
        };
        
        sendProgress('Complete', 1.0);
        
        self.postMessage({ type: 'OCR_TEXT_LAYER_RESULT', id, payload: pageResult });
        break;
      }

      // ============================================
      // SEGMENT - Smart Region Detection
      // ============================================
      case 'SEGMENT': {
        const { imageUrl, language = 'eng', documentType = 'manga' } = payload as {
          imageUrl: string;
          language: string;
          documentType: DocumentType;
        };
        
        console.log(`[Worker] SEGMENT: Lang=${language}, Type=${documentType}`);
        
        sendProgress('Preprocessing image...', 0);
        
        // Preprocess image to get proper dimensions and fix corrupted images
        let processedUrl = imageUrl;
        let imageWidth = 1000;
        let imageHeight = 1000;
        
        try {
          const preprocessed = await preprocessImage(imageUrl);
          processedUrl = preprocessed.processedUrl;
          imageWidth = preprocessed.width;
          imageHeight = preprocessed.height;
          console.log(`[Worker] SEGMENT image preprocessed: ${imageWidth}x${imageHeight}`);
        } catch (preprocessError) {
          console.warn('[Worker] SEGMENT preprocessing failed, using original:', preprocessError);
          
          // Try to get dimensions without full preprocessing
          try {
            const dims = await getImageDimensions(imageUrl);
            imageWidth = dims.width;
            imageHeight = dims.height;
          } catch {
            // Use defaults
          }
        }
        
        sendProgress('Starting segmentation...', 0.1);
        
        const worker = await getOrCreateWorker(language);
        
        // Enable TSV output for word-level data
        await worker.setParameters({
          tessedit_create_tsv: '1',
        });
        
        sendProgress('Running OCR...', 0.3);
        
        // Run OCR on preprocessed image
        const result = await worker.recognize(processedUrl) as TesseractResult;
        
        sendProgress('Analyzing regions...', 0.7);
        
        const data = result.data;
        
        // Parse TSV for word-level data
        const { words } = parseTSV(data.tsv || '');
        
        // Group words into regions with smart classification
        const regions = groupWordsIntoRegions(
          words,
          imageWidth,
          imageHeight,
          documentType
        );
        
        // If word-level failed, fall back to block-level
        if (regions.length === 0 && data.blocks && data.blocks.length > 0) {
          console.log(`[Worker] Using block-level fallback: ${data.blocks.length} blocks`);
          
          const blockRegions = data.blocks
            .filter(block => block.text.trim().length > 0)
            .map((block, index) => {
              const type = classifyRegion(
                block.text,
                block.bbox,
                block.confidence,
                imageWidth,
                imageHeight,
                documentType
              );
              
              return {
                id: `block-${index}-${Date.now()}`,
                type,
                box: {
                  x: block.bbox.x0,
                  y: block.bbox.y0,
                  w: block.bbox.x1 - block.bbox.x0,
                  h: block.bbox.y1 - block.bbox.y0,
                },
                originalText: block.text.trim(),
                confidence: block.confidence / 100,
              };
            })
            .filter(r => r.confidence >= CONFIG.MIN_CONFIDENCE / 100);
          
          self.postMessage({ type: 'SEGMENT_RESULT', id, payload: blockRegions });
          break;
        }
        
        // Final fallback: single region with all text
        if (regions.length === 0 && data.text && data.text.trim().length > 0) {
          console.log('[Worker] Using full-page fallback');
          
          self.postMessage({
            type: 'SEGMENT_RESULT',
            id,
            payload: [{
              id: `fallback-${Date.now()}`,
              type: 'text',
              box: { x: 0, y: 0, w: imageWidth, h: imageHeight },
              originalText: data.text.trim(),
              confidence: (data.confidence || 50) / 100,
            }]
          });
          break;
        }
        
        console.log(`[Worker] SEGMENT complete: ${regions.length} regions`);
        
        self.postMessage({ type: 'SEGMENT_RESULT', id, payload: regions });
        break;
      }

      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    console.error('[Worker] Error:', error);
    self.postMessage({ 
      type: 'ERROR', 
      id, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
};

export {};
