import { createWorker, PSM } from 'tesseract.js';

// Vision Worker - Handles heavy image processing tasks
// Supports both block-level (SEGMENT) and word-level (OCR_FOR_TEXT_LAYER) OCR

let tesseractWorker: any = null;
let currentLang = 'eng';

// Helper: Get or create Tesseract worker with specified language
async function getOrCreateWorker(targetLang: string) {
  if (!tesseractWorker) {
    tesseractWorker = await createWorkerWithBest(targetLang);
    currentLang = targetLang;
  } else if (currentLang !== targetLang) {
    console.log(`Switching OCR Language from ${currentLang} to ${targetLang}...`);
    await tesseractWorker.terminate();
    tesseractWorker = await createWorkerWithBest(targetLang);
    currentLang = targetLang;
  }
  return tesseractWorker;
}

// Helper: Send progress to main thread
function sendProgress(status: string, progress: number, workerId?: string) {
  self.postMessage({
    type: 'OCR_PROGRESS',
    payload: { status, progress, workerId }
  });
}

// Helper: Create worker (Standard V7 Init)
async function createWorkerWithBest(lang: string, sendUpdates: boolean = false) {
  try {
    // Force use of v6 core which is more stable with Electron regarding SIMD
    const worker = await createWorker(lang, 1, {
      corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0/tesseract-core.wasm.js',
      logger: m => {
        // console.log(m); // Reduce log noise
        // Send progress to main thread
        if (sendUpdates && m.status && typeof m.progress === 'number') {
          sendProgress(m.status, m.progress, m.workerId);
        }
      }
    });
    
    console.log(`Tesseract Initialized for: ${lang}`);
    return worker;
  } catch (err) {
    console.error(`Failed to initialize Tesseract for ${lang}`, err);
    throw err;
  }
}

self.onmessage = async (e: MessageEvent) => {
  const { type, payload, id } = e.data;

  try {
    switch (type) {
      case 'INIT':
        console.log('Vision Worker Initializing...');
        tesseractWorker = await createWorkerWithBest('eng');
        self.postMessage({ type: 'INIT_SUCCESS', id });
        break;

      // ============================================
      // NEW: Word-Level OCR for Text Layer Overlay
      // ============================================
      case 'OCR_FOR_TEXT_LAYER': {
        const { imageUrl, imageWidth, imageHeight, language = 'eng', dpi = 300 } = payload;
        console.log(`[TextLayer OCR] Starting: ${imageWidth}x${imageHeight} @ ${dpi}DPI, Lang: ${language}`);
        
        // Send initial progress
        sendProgress('Starting OCR...', 0);
        
        // Check if we need to switch language (recreate worker with progress)
        if (!tesseractWorker || currentLang !== language) {
          sendProgress(`Loading ${language} language data...`, 0.1);
          if (tesseractWorker) {
            await tesseractWorker.terminate();
          }
          tesseractWorker = await createWorkerWithBest(language, true);
          currentLang = language;
        }
        
        sendProgress('Recognizing text...', 0.2);
        
        // IMPORTANT: Set parameters to enable detailed output
        // This is required in Tesseract.js v5 to get words, blocks, hocr, tsv
        await tesseractWorker.setParameters({
          tessedit_create_hocr: '1',
          tessedit_create_tsv: '1',
          tessedit_create_pdf: '0',
          hocr_font_info: '1',
        });
        
        // Use PSM.AUTO for best layout detection
        const result = await tesseractWorker.recognize(imageUrl, {
          tessedit_pageseg_mode: PSM.AUTO
        });
        const data = result.data;
        
        console.log(`[TextLayer OCR] Complete. Confidence: ${data.confidence?.toFixed(1)}%`);
        
        // Debug: Log available data
        console.log('[TextLayer OCR] Data keys:', Object.keys(data || {}));
        
        // In Tesseract.js v5, some outputs might need to be awaited
        let hocrData = data.hocr;
        let blocksData = data.blocks;
        
        // Check if hocr/blocks are promises or getters
        console.log('[TextLayer OCR] hocr raw:', hocrData, 'type:', typeof hocrData);
        console.log('[TextLayer OCR] blocks raw:', blocksData, 'type:', typeof blocksData);
        
        // Try to resolve if they are promises
        if (hocrData && typeof hocrData === 'object' && typeof hocrData.then === 'function') {
          console.log('[TextLayer OCR] hocr is a Promise, awaiting...');
          hocrData = await hocrData;
        }
        if (blocksData && typeof blocksData === 'object' && typeof blocksData.then === 'function') {
          console.log('[TextLayer OCR] blocks is a Promise, awaiting...');
          blocksData = await blocksData;
        }
        
        console.log('[TextLayer OCR] hocr resolved type:', typeof hocrData, 'length:', hocrData?.length);
        console.log('[TextLayer OCR] blocks resolved:', blocksData, 'isArray:', Array.isArray(blocksData));
        
        // If hocr is still object but not string, check if it's something else
        if (hocrData && typeof hocrData === 'object') {
          console.log('[TextLayer OCR] hocr object keys:', Object.keys(hocrData));
        }
        
        // For hocr, if it's a string, sample it
        if (typeof hocrData === 'string' && hocrData.length > 0) {
          console.log('[TextLayer OCR] hocr sample:', hocrData.substring(0, 500));
        }
        
        console.log('[TextLayer OCR] Text preview:', data.text?.substring(0, 100));
        
        // Extract word-level data with precise bounding boxes
        let words: any[] = [];
        let lines: any[] = [];
        
        // *** SOLUTION: Use TSV output which contains word-level bounding boxes ***
        // TSV format: level, page_num, block_num, par_num, line_num, word_num, left, top, width, height, conf, text
        console.log('[TextLayer OCR] TSV available:', !!data.tsv, 'length:', data.tsv?.length);
        
        if (data.tsv && typeof data.tsv === 'string' && data.tsv.length > 0) {
          console.log('[TextLayer OCR] Parsing words from TSV...');
          
          const tsvLines = data.tsv.split('\n');
          console.log('[TextLayer OCR] TSV lines count:', tsvLines.length);
          console.log('[TextLayer OCR] TSV header:', tsvLines[0]);
          console.log('[TextLayer OCR] TSV sample row:', tsvLines[1]);
          
          // Parse TSV header
          const header = tsvLines[0].split('\t');
          const levelIdx = header.indexOf('level');
          const leftIdx = header.indexOf('left');
          const topIdx = header.indexOf('top');
          const widthIdx = header.indexOf('width');
          const heightIdx = header.indexOf('height');
          const confIdx = header.indexOf('conf');
          const textIdx = header.indexOf('text');
          
          console.log('[TextLayer OCR] TSV column indices:', { levelIdx, leftIdx, topIdx, widthIdx, heightIdx, confIdx, textIdx });
          
          // Parse data rows (skip header)
          for (let i = 1; i < tsvLines.length; i++) {
            const cols = tsvLines[i].split('\t');
            if (cols.length < textIdx + 1) continue;
            
            const level = parseInt(cols[levelIdx] || '0');
            const text = cols[textIdx]?.trim() || '';
            
            // Level 5 = word in Tesseract TSV format
            if (level === 5 && text.length > 0) {
              const left = parseInt(cols[leftIdx] || '0');
              const top = parseInt(cols[topIdx] || '0');
              const width = parseInt(cols[widthIdx] || '0');
              const height = parseInt(cols[heightIdx] || '0');
              const conf = parseFloat(cols[confIdx] || '0');
              
              words.push({
                text: text,
                confidence: conf,
                bbox: {
                  x0: left,
                  y0: top,
                  x1: left + width,
                  y1: top + height
                }
              });
            }
            
            // Level 4 = line
            if (level === 4 && text.length > 0) {
              const left = parseInt(cols[leftIdx] || '0');
              const top = parseInt(cols[topIdx] || '0');
              const width = parseInt(cols[widthIdx] || '0');
              const height = parseInt(cols[heightIdx] || '0');
              const conf = parseFloat(cols[confIdx] || '0');
              
              lines.push({
                text: text,
                confidence: conf,
                bbox: {
                  x0: left,
                  y0: top,
                  x1: left + width,
                  y1: top + height
                },
                words: []
              });
            }
          }
          
          console.log('[TextLayer OCR] Parsed from TSV:', words.length, 'words,', lines.length, 'lines');
        }
        
        // Fallback: If TSV didn't work, try to create words from plain text (no bbox)
        if (words.length === 0 && data.text && data.text.trim().length > 0) {
          console.log('[TextLayer OCR] TSV failed, using text fallback');
          // This is a last resort - we split text into words but won't have accurate positions
          // For now, just log this as a warning
          console.warn('[TextLayer OCR] WARNING: Cannot get word-level bounding boxes. Text layer will be inaccurate.');
        }
        
        console.log(`[TextLayer OCR] Found ${words.length} words, ${lines.length} lines`);
        
        // Log first few words for debugging
        if (words.length > 0) {
          console.log('[TextLayer OCR] First 3 words:', words.slice(0, 3));
        }
        
        // Return OCRPageResult structure
        const pageResult = {
          pageNumber: 1,
          width: imageWidth,
          height: imageHeight,
          dpi: dpi,
          language: language,
          lines: lines,
          words: words,
          text: data.text || '',
          confidence: data.confidence || 0
        };
        
        self.postMessage({ type: 'OCR_TEXT_LAYER_RESULT', id, payload: pageResult });
        break;
      }

      // ============================================
      // Original SEGMENT (Block-Level for UI Display)
      // ============================================
      case 'SEGMENT': {
        console.log('Processing Image:', payload.imageUrl ? `Image URL received (Length: ${payload.imageUrl.length})` : 'No Image');
        const targetLang = payload.language || 'eng';
        console.log(`Target Language: ${targetLang} | Current Worker Language: ${currentLang}`);
        
        const worker = await getOrCreateWorker(targetLang);

        console.log('Starting Recognition...');
        const result = await worker.recognize(payload.imageUrl, {
          tessedit_pageseg_mode: PSM.AUTO
        });
        const data = result.data;
        console.log('OCR Complete. Data keys:', Object.keys(data || {}));
        console.log('OCR Raw Text Preview:', data.text ? data.text.substring(0, 100) : 'No text found');

        // Safety check for blocks
        let blocks = data.blocks || [];
        
        // Fallback 1: Try layoutBlocks if blocks are empty
        if (blocks.length === 0 && data.layoutBlocks && data.layoutBlocks.length > 0) {
            console.log(`Blocks empty, using ${data.layoutBlocks.length} layoutBlocks.`);
            blocks = data.layoutBlocks;
        }

        // Fallback 2: If still empty but we have raw text, create a single block for the whole page
        if (blocks.length === 0 && data.text && data.text.trim().length > 0) {
             console.log('Structure detection failed but text exists. Creating a single fallback block.');
             blocks = [{
                text: data.text,
                confidence: data.confidence || 70,
                bbox: {
                    x0: 0,
                    y0: 0,
                    x1: payload.imageUrl.length > 0 ? 1000 : 500,
                    y1: payload.imageUrl.length > 0 ? 1000 : 500
                }
             }];
        }

        console.log(`Found ${blocks.length} blocks (or equivalent units).`);

        // Convert OCR Blocks to Regions
        const regions = blocks.map((block: any, index: number) => {
          const text = block.text.trim();
          if (index < 3) console.log(`Block ${index}: "${text}" (Conf: ${block.confidence})`);
          
          return {
            id: `ocr-${index}-${Date.now()}`,
            type: 'balloon', 
            box: { 
              x: block.bbox.x0, 
              y: block.bbox.y0, 
              w: block.bbox.x1 - block.bbox.x0, 
              h: block.bbox.y1 - block.bbox.y0 
            },
            originalText: text,
            confidence: block.confidence / 100
          };
        }).filter((r: any) => {
          const isValid = r.originalText.length > 0;
          if (!isValid) console.log(`Filtered out block ${r.id} due to empty text`);
          return isValid;
        });
        
        console.log(`Returning ${regions.length} regions after filtering.`);
        self.postMessage({ type: 'SEGMENT_RESULT', id, payload: regions });
        break;
      }

      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    self.postMessage({ 
      type: 'ERROR', 
      id, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
};

export {};
