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
    throw error;
  }
}

/**
 * Extract words from Tesseract's output
 * 
 * Tesseract.js v7: blocks output is disabled (causes GetJSONText error)
 * Must use TSV parsing for word-level bounding boxes
 * TSV format: level=5 is word with left, top, width, height coordinates
 */
function extractWordsFromBlocks(data: any): any[] {
  // DEBUG: Log available data structure (only first time)
  if (!extractWordsFromBlocks._logged) {
    extractWordsFromBlocks._logged = true;
    console.log('[Worker] Tesseract data keys:', Object.keys(data));
    if (data.tsv) {
      console.log('[Worker] TSV available, length:', data.tsv.length);
    }
  }
  
  // PRIORITY 1: Parse TSV - this is the primary source for Tesseract.js v7
  // TSV contains word-level bounding boxes needed for PDF24-like accuracy
  if (data.tsv && typeof data.tsv === 'string' && data.tsv.length > 50) {
    const parsed = parseTSV(data.tsv);
    if (parsed.words.length > 0) {
      console.log(`[Worker] Extracted ${parsed.words.length} words from TSV`);
      return parsed.words;
    }
  }
  
  // PRIORITY 2: Try direct words array (fallback)
  if (data.words && Array.isArray(data.words) && data.words.length > 0) {
    const directWords = data.words.filter((w: any) => {
      if (!w.text || !w.text.trim()) return false;
      if (w.bbox && typeof w.bbox.x0 === 'number') return true;
      if (typeof w.x0 === 'number') return true;
      return false;
    }).map((w: any) => ({
      text: w.text.trim(),
      confidence: w.confidence || 0,
      bbox: w.bbox || {
        x0: w.x0,
        y0: w.y0,
        x1: w.x1,
        y1: w.y1
      }
    }));
    
    if (directWords.length > 0) {
      console.log(`[Worker] Extracted ${directWords.length} words from direct array`);
      return directWords;
    }
  }
  
  // PRIORITY 3: Try nested blocks structure (may not work in v7)
  const words: any[] = [];
  if (data.blocks && Array.isArray(data.blocks)) {
    data.blocks.forEach((block: any) => {
      if (block.paragraphs) {
        block.paragraphs.forEach((para: any) => {
          if (para.lines) {
            para.lines.forEach((line: any) => {
              if (line.words) {
                line.words.forEach((word: any) => {
                  if (word.text && word.text.trim() && word.bbox) {
                    words.push({
                      text: word.text.trim(),
                      confidence: word.confidence || 0,
                      bbox: {
                        x0: word.bbox.x0,
                        y0: word.bbox.y0,
                        x1: word.bbox.x1,
                        y1: word.bbox.y1
                      }
                    });
                  }
                });
              }
            });
          }
        });
      }
    });
    
    if (words.length > 0) {
      console.log(`[Worker] Extracted ${words.length} words from blocks structure`);
      return words;
    }
  }
  
  console.warn('[Worker] No word data found in any source');
  return [];
}
// Add flag to track logging
(extractWordsFromBlocks as any)._logged = false;



/**
 * Extract lines from Tesseract's nested blocks structure
 */
function extractLinesFromBlocks(data: any): any[] {
  const lines: any[] = [];
  
  if (data.blocks && Array.isArray(data.blocks)) {
    data.blocks.forEach((block: any) => {
      if (block.paragraphs) {
        block.paragraphs.forEach((para: any) => {
          if (para.lines) {
            para.lines.forEach((line: any) => {
              if (line.text && line.bbox) {
                const lineWords = line.words ? line.words.map((w: any) => ({
                  text: w.text,
                  confidence: w.confidence || 0,
                  bbox: w.bbox
                })) : [];
                
                lines.push({
                  text: line.text,
                  confidence: line.confidence || 0,
                  bbox: line.bbox,
                  words: lineWords
                });
              }
            });
          }
        });
      }
    });
  }
  
  // Fallback to direct lines array
  if (lines.length === 0 && data.lines && Array.isArray(data.lines)) {
    return data.lines;
  }
  
  return lines;
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
 * TSV format from Tesseract contains precise word bounding boxes
 * Level 5 = word, Level 4 = line, Level 3 = paragraph, etc.
 */
function parseTSV(tsv: string): {
  words: Array<{ text: string; confidence: number; bbox: BBox }>;
  lines: Array<{ text: string; confidence: number; bbox: BBox; words: unknown[] }>;
} {
  const words: Array<{ text: string; confidence: number; bbox: BBox }> = [];
  const lines: Array<{ text: string; confidence: number; bbox: BBox; words: unknown[] }> = [];
  
  if (!tsv || typeof tsv !== 'string') {
    console.warn('[Worker] parseTSV: No TSV data');
    return { words, lines };
  }
  
  const tsvLines = tsv.split('\n').filter(line => line.trim().length > 0);
  if (tsvLines.length < 1) {
    console.warn('[Worker] parseTSV: TSV is empty');
    return { words, lines };
  }
  
  // Check if first row looks like a header (contains non-numeric column names)
  const firstRow = tsvLines[0].split('\t');
  const hasHeader = firstRow.some(col => isNaN(Number(col)) && col.length > 0);
  
  console.log('[Worker] parseTSV: hasHeader =', hasHeader, 'firstRow sample:', firstRow.slice(0, 5).join(', '));
  
  // Standard Tesseract TSV format (12 columns):
  // level, page_num, block_num, par_num, line_num, word_num, left, top, width, height, conf, text
  // Fixed indices for standard format:
  const FIXED_INDICES = {
    level: 0,
    page_num: 1,
    block_num: 2,
    par_num: 3,
    line_num: 4,
    word_num: 5,
    left: 6,
    top: 7,
    width: 8,
    height: 9,
    conf: 10,
    text: 11
  };
  
  let indices = FIXED_INDICES;
  let startRow = 0;
  
  // If there's a header, try to parse column names
  if (hasHeader) {
    const header = firstRow.map(h => h.toLowerCase().trim());
    console.log('[Worker] parseTSV header columns:', header.join(', '));
    
    const findIndex = (names: string[]) => {
      for (const name of names) {
        const idx = header.indexOf(name);
        if (idx !== -1) return idx;
      }
      return -1;
    };
    
    const parsedIndices = {
      level: findIndex(['level']),
      left: findIndex(['left', 'x', 'x0']),
      top: findIndex(['top', 'y', 'y0']),
      width: findIndex(['width', 'w']),
      height: findIndex(['height', 'h']),
      conf: findIndex(['conf', 'confidence']),
      text: findIndex(['text', 'word']),
    };
    
    // Use parsed indices if they seem valid
    if (parsedIndices.text !== -1) {
      indices = { ...FIXED_INDICES, ...parsedIndices };
      startRow = 1; // Skip header
    }
  }
  
  console.log('[Worker] parseTSV using indices:', { level: indices.level, left: indices.left, text: indices.text });
  
  // Parse data rows
  let wordCount = 0;
  let lineCount = 0;
  
  for (let i = startRow; i < tsvLines.length; i++) {
    const cols = tsvLines[i].split('\t');
    if (cols.length < 12) continue; // Need at least 12 columns for standard format
    
    // Parse using fixed positions
    const level = parseInt(cols[indices.level] || '0');
    const text = (cols[indices.text] || '').trim();
    
    // Skip empty text entries
    if (text.length === 0) continue;
    
    const left = parseInt(cols[indices.left] || '0');
    const top = parseInt(cols[indices.top] || '0');
    const width = parseInt(cols[indices.width] || '0');
    const height = parseInt(cols[indices.height] || '0');
    let conf = parseFloat(cols[indices.conf] || '0');
    
    // Skip words with invalid dimensions
    if (width <= 0 || height <= 0) continue;
    
    const bbox: BBox = {
      x0: left,
      y0: top,
      x1: left + width,
      y1: top + height
    };
    
    // Level 5 = word (most important for PDF24-like accuracy)
    if (level === 5) {
      words.push({ text, confidence: conf, bbox });
      wordCount++;
    }
    
    // Level 4 = line
    if (level === 4) {
      lines.push({ text, confidence: conf, bbox, words: [] });
      lineCount++;
    }
  }
  
  console.log(`[Worker] parseTSV result: ${wordCount} words, ${lineCount} lines`);
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
        } catch (preprocessError) {
          // Continue with original image
        }
        
        sendProgress('Initializing OCR...', 0.1);
        
        // Get or create worker with correct language
        const worker = await getOrCreateWorker(language);
        
        sendProgress('Configuring OCR...', 0.15);
        
        // Configure for PRECISE word-level output (PDF24-like accuracy)
        // PSM.AUTO (3) is more reliable for standard documents
        // PSM.SPARSE_TEXT (11) is better for mixed/manga content
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.AUTO, // Mode 3: Fully automatic (best for documents)
          tessedit_create_tsv: '1',  // CRITICAL: TSV contains word-level bboxes
          tessedit_create_hocr: '1', 
          tessedit_create_pdf: '0',
          preserve_interword_spaces: '1',
        });
        
        sendProgress('Recognizing text...', 0.2);
        
        sendProgress('Recognizing text...', 0.2);
        
        let words: any[] = [];
        let lines: any[] = [];
        let confidence = 0;
        let text = '';
        
        // Check if image needs chunking (height > 4000px)
        // Tesseract has trouble with very tall images (common in webtoons)
        const CHUNK_LIMIT = 4000;
        
        // Tesseract.js v7: Use TSV output for word-level bounding boxes
        // Note: blocks: true causes 'GetJSONText is not a function' error in v7
        const outputOptions = { tsv: true };
        
        if (actualHeight > CHUNK_LIMIT) {
          try {
            const chunkResult = await processLargeImageInChunks(worker, processedUrl, actualWidth, actualHeight);
            words = chunkResult.words;
            lines = chunkResult.lines;
            confidence = chunkResult.confidence;
            text = chunkResult.text;
          } catch (err) {
            // Fallback to normal OCR attempts
            const result = await worker.recognize(processedUrl, {}, outputOptions) as TesseractResult;
            text = result.data.text;
            confidence = result.data.confidence;
            // Use helper functions to extract from nested structure
            words = extractWordsFromBlocks(result.data);
            lines = extractLinesFromBlocks(result.data);
          }
        } else {
          // Standard processing for normal sized images
          const result = await worker.recognize(processedUrl, {}, outputOptions) as TesseractResult;
          text = result.data.text;
          confidence = result.data.confidence;
          // Use helper functions to extract from nested structure
          words = extractWordsFromBlocks(result.data);
          lines = extractLinesFromBlocks(result.data);
        }

        sendProgress('Processing results...', 0.8);

        // Fallback: If no words found but text exists (and not already processed by chunks)
        // This handles cases where TSV parsing fails or structure is simple
        if (words.length === 0 && text && text.trim().length > 0) {
           console.warn('[Worker] No word-level data found, using line-based fallback');
           
           const rawLines = text.split('\n').filter(l => l.trim().length > 0);
           const approxLineHeight = actualHeight / (rawLines.length + 2);
           
           words = [];
           lines = [];
           
           rawLines.forEach((lineText, i) => {
            const y0 = (i + 1) * approxLineHeight; 
            const y1 = y0 + approxLineHeight;
            const bbox = { x0: 20, y0: y0, x1: actualWidth - 20, y1: y1 }; 
            
            const lineWords = [{
              text: lineText.trim(),
              confidence: confidence || 0,
              bbox: bbox
            }];
            
            words.push(...lineWords);
            lines.push({
              text: lineText.trim(),
              confidence: confidence || 0,
              bbox: bbox,
              words: lineWords
            });
          });
        }
        
        const pageResult = {
          pageNumber: 1,
          width: actualWidth,
          height: actualHeight,
          dpi: dpi,
          language: language,
          lines: lines,
          words: words,
          text: text || '',
          confidence: confidence || 0
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
        
        // Run OCR on preprocessed image - use TSV for word-level data
        const result = await worker.recognize(processedUrl, {}, { tsv: true }) as TesseractResult;
        
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


/**
 * Process a large image in overlapping chunks to handle Tesseract limitations
 * Useful for long webtoons or documents that exceed Tesseract's max dimension
 */
async function processLargeImageInChunks(
  worker: any, 
  imageUrl: string, 
  width: number, 
  height: number
): Promise<{ words: any[], lines: any[], text: string, confidence: number }> {
  const CHUNK_SIZE = 4000;
  const OVERLAP = 200; // Overlap to catch text cut by chunk boundary
  const EFF_HEIGHT = CHUNK_SIZE - OVERLAP;
  
  const allWords: any[] = [];
  let fullText = '';
  let totalConf = 0;
  let chunkCount = 0;

  // 1. Prepare source canvas
  let sourceBitmap: ImageBitmap | null = null;
  try {
    let blob: Blob;
    if (imageUrl.startsWith('data:')) {
      const resp = await fetch(imageUrl);
      blob = await resp.blob();
    } else {
      const resp = await fetch(imageUrl);
      blob = await resp.blob();
    }
    sourceBitmap = await createImageBitmap(blob);
  } catch (e) {
    throw new Error(`Failed to load source image for chunking: ${e}`);
  }

  // We need to render slices. Since we can't easily crop ImageBitmap to Blob without canvas,
  // we use OffscreenCanvas.
  
  const totalChunks = Math.ceil(height / EFF_HEIGHT);

  for (let i = 0; i < totalChunks; i++) {
    const yStart = i * EFF_HEIGHT;
    const chunkHeight = Math.min(CHUNK_SIZE, height - yStart);
    
    // Stop if we have passed the end
    if (chunkHeight <= 0) break;

    // Create chunk canvas
    const chunkCanvas = new OffscreenCanvas(width, chunkHeight);
    const ctx = chunkCanvas.getContext('2d');
    
    if (!ctx) throw new Error('Failed to create chunk canvas context');
    
    // Draw white background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, chunkHeight);
    
    // Draw slice from source
    // drawImage(image, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight)
    // Beware of source bounds
    const sourceHeight = Math.min(chunkHeight, height - yStart);
    ctx.drawImage(sourceBitmap, 0, yStart, width, sourceHeight, 0, 0, width, sourceHeight);
    
    // Prepare chunk URL
    const chunkBlob = await chunkCanvas.convertToBlob({ type: 'image/png' });
    const chunkUrl = URL.createObjectURL(chunkBlob);
    
    try {
      // Run OCR on this chunk - use TSV for word-level bbox (blocks causes error in v7)
      const result = await worker.recognize(chunkUrl, {}, { tsv: true });
      const data = result.data as any;
      
      // Accumulate text and confidence
      fullText += (data.text || '') + '\n';
      totalConf += (data.confidence || 0);
      chunkCount++;
      
      // Extract words from Tesseract's nested structure using helper
      const chunkWords = extractWordsFromBlocks(data);
      
      // Offset coordinates and filter duplicates in overlap area
      chunkWords.forEach(w => {
        // Adjust Y coordinates
        const absY0 = w.bbox.y0 + yStart;
        const absY1 = w.bbox.y1 + yStart;
        
        // Filtering logic:
        // We want to avoid duplicates in the overlap region.
        // Rule: Only accept words that end BEFORE the overlap region start of this chunk,
        // UNLESS it's the last chunk.
        
        const isLastChunk = (i === totalChunks - 1);
        const overlapStartInChunk = EFF_HEIGHT;
        
        // If word is completely in the overlap region (bottom of this chunk), skip it 
        // (unless it's the last chunk, then keep everything)
        // Using center point for safety
        const wordCenterY = (w.bbox.y0 + w.bbox.y1) / 2;
        
        if (!isLastChunk && wordCenterY > overlapStartInChunk) {
           return; // Skip, let next chunk handle it
        }
        
        // Also skip if it's in the top overlap region (which is covered by previous chunk)
        // But our yStart increment is based on EFF_HEIGHT, so the previous chunk covered up to yStart
        // Wait, chunk i covers [yStart, yStart + chunkHeight]
        // Chunk i-1 covered [yStart - EFF_HEIGHT, yStart - EFF_HEIGHT + chunkHeight] 
        // = [yStart - EFF_HEIGHT, yStart + OVERLAP]
        // So the top 200px of this chunk (0 to OVERLAP) was covered by previous chunk bottom.
        // We should skip top overlap if not first chunk?
        // No, let's stick to "Bottom overlap is strictly for next chunk".
        // The previous chunk's bottom overlap was skipped by previous chunk logic.
        // So this chunk should handle its top part.
        
        // However, if the word started in previous chunk but ended here?
        // This simple logic might split words. But Tesseract usually finds whole words.
        
        // Add valid word
        allWords.push({
            ...w,
            bbox: {
                x0: w.bbox.x0,
                x1: w.bbox.x1,
                y0: absY0,
                y1: absY1
            }
        });
      });
      
    } catch (err) {
      console.error(`[Worker] Error processing chunk ${i}:`, err);
    } finally {
      URL.revokeObjectURL(chunkUrl);
    }
  }
  
  if (sourceBitmap) sourceBitmap.close();
  
  // Reconstruct lines from all words
  // Sort words by Y then X
  allWords.sort((a, b) => {
      const yDiff = a.bbox.y0 - b.bbox.y0;
      if (Math.abs(yDiff) < 10) return a.bbox.x0 - b.bbox.x0; // Same lineish
      return yDiff;
  });
  
  // Simple line grouping
  const lines: any[] = [];
  let currentLine: any = null;
  
  allWords.forEach(w => {
      if (!currentLine) {
          currentLine = { words: [w], bbox: { ...w.bbox }, text: w.text, confidence: w.confidence };
      } else {
          // Check if vertically aligned with current line
          const verticalOverlap = Math.min(currentLine.bbox.y1, w.bbox.y1) - Math.max(currentLine.bbox.y0, w.bbox.y0);
          const lineHeight = Math.max(1, currentLine.bbox.y1 - currentLine.bbox.y0);
          
          // If overlap > 50% of height, same line
          if (verticalOverlap > lineHeight * 0.5) {
             // Add to line
             currentLine.words.push(w);
             currentLine.text += ' ' + w.text;
             currentLine.bbox.x1 = Math.max(currentLine.bbox.x1, w.bbox.x1);
             currentLine.bbox.y0 = Math.min(currentLine.bbox.y0, w.bbox.y0);
             currentLine.bbox.y1 = Math.max(currentLine.bbox.y1, w.bbox.y1);
             // Avg confidence
             const totalWords = currentLine.words.length;
             currentLine.confidence = ((currentLine.confidence * (totalWords - 1)) + w.confidence) / totalWords;
          } else {
             // New line
             lines.push(currentLine);
             currentLine = { words: [w], bbox: { ...w.bbox }, text: w.text, confidence: w.confidence };
          }
      }
  });
  if (currentLine) lines.push(currentLine);
  
  return {
      words: allWords,
      lines: lines,
      text: fullText,
      confidence: chunkCount > 0 ? totalConf / chunkCount : 0
  };
}

export {};
