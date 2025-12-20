import { createWorker, PSM } from 'tesseract.js';

// Vision Worker - Handles heavy image processing tasks
// Loads OpenCV.js and ONNX Runtime

let tesseractWorker: any = null;
let currentLang = 'eng';

self.onmessage = async (e: MessageEvent) => {
  const { type, payload, id } = e.data;

  try {
    switch (type) {
      case 'INIT':
        console.log('Vision Worker Initializing...');
        
        // Initialize Tesseract with tessdata-best (High Accuracy)
        // We use the official GitHub raw URL. Note: These files are large (~15MB for eng)
        try {
          tesseractWorker = await createWorker('eng', 1, {
            langPath: 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/main/',
            gzip: false,
            // Force standard WASM (no SIMD) to avoid "missing function: DotProductSSE" error
            // This ensures compatibility with Electron/Chromium environments that might have issues with the relaxed-simd build
            corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@v5.1.0/tesseract-core.wasm.js',
            logger: m => console.log(m)
          });
          console.log('Tesseract (Best) Initialized');
        } catch (err) {
          console.warn('Failed to load tessdata-best, falling back to standard...', err);
          tesseractWorker = await createWorker('eng');
        }

        self.postMessage({ type: 'INIT_SUCCESS', id });
        break;

      case 'SEGMENT':
        console.log('Processing Image:', payload.imageUrl ? `Image URL received (Length: ${payload.imageUrl.length})` : 'No Image');
        const targetLang = payload.language || 'eng';
        console.log(`Target Language: ${targetLang} | Current Worker Language: ${currentLang}`);
        
        if (!tesseractWorker) {
           // Re-init if missing
           tesseractWorker = await createWorker(targetLang);
           currentLang = targetLang;
        } else if (currentLang !== targetLang) {
           // Switch language if changed
           console.log(`Switching OCR Language from ${currentLang} to ${targetLang}...`);
           // Note: In Tesseract.js v5+, we might need to re-create worker or load language
           // For simplicity and stability with tessdata-best, let's re-create
           await tesseractWorker.terminate();
           
           try {
             tesseractWorker = await createWorker(targetLang, 1, {
                langPath: 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/main/',
                gzip: false,
                corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@v5.1.0/tesseract-core.wasm.js',
                logger: m => console.log(m)
             });
           } catch (err) {
             console.warn(`Failed to load tessdata-best for ${targetLang}, falling back...`);
             tesseractWorker = await createWorker(targetLang);
           }
           currentLang = targetLang;
        }

        // Run OCR
        // Using PSM.AUTO (3) is usually best for full pages, but sometimes PSM.SPARSE_TEXT (11) or SINGLE_BLOCK (6) works better for manga.
        // Let's stick to AUTO for now but log it.
        console.log('Starting Recognition...');
        const result = await tesseractWorker.recognize(payload.imageUrl, {
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
                    x1: payload.imageUrl.length > 0 ? 1000 : 500, // Arbitrary width if unknown
                    y1: payload.imageUrl.length > 0 ? 1000 : 500  // Arbitrary height
                }
             }];
        }

        console.log(`Found ${blocks.length} blocks (or equivalent units).`);

        // Convert OCR Blocks to Regions
        const regions = blocks.map((block: any, index: number) => {
          const text = block.text.trim();
          // Debug log for first few blocks
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
