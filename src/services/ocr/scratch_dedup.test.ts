import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { applyPanelSafetyLineDedup } from './ocrSafetyLineDedup';
import { OCRPageResult } from '../../types';
import { normalizeSourceForTranslation } from './ocrTextNormalizer';

describe('Scratch Dedup Test', () => {
  it('checks if CAN DO and IS TO SEARCH are dropped', () => {
    const logPath = 'C:\\Users\\auand\\.gemini\\antigravity-ide\\brain\\e4b0aed9-e4d9-43cb-9a00-c0b1a2c23338\\.system_generated\\tasks\\task-1512.log';
    const content = fs.readFileSync(logPath, 'utf8');
    const jsonLine = content.split('\n').find(line => line.trim().startsWith('{"ok"'));
    if (!jsonLine) {
      throw new Error('JSON line not found in log');
    }
    
    const ocrResult = JSON.parse(jsonLine) as OCRPageResult;
    ocrResult.width = 960;
    ocrResult.height = 1200;
    ocrResult.pipelineProfile = 'panel';
    ocrResult.ocrEngine = 'paddleocr';

    console.log('--- Initial lines count:', ocrResult.lines.length);
    const finalResult = applyPanelSafetyLineDedup(ocrResult);
    console.log('--- Final lines count:', finalResult.lines.length);
    
    console.log('--- Kept Lines:');
    finalResult.lines.forEach((l, i) => {
      console.log(`[${i}] "${l.text}" (conf=${l.confidence.toFixed(1)})`);
    });

    console.log('--- Dropped Words/Lines:');
    const dropped = finalResult.debug?.droppedWords || [];
    dropped.forEach((d, i) => {
      console.log(`[${i}] reason=${d.reason} filter=${d.filter} text="${d.text}"`);
    });
  });

  it('ensures manga-specific short words are not dropped by applyPanelSafetyLineDedup', () => {
    const testLines = [
      { text: "YQU'RE", confidence: 90, bbox: { x0: 100, y0: 100, x1: 180, y1: 130 }, words: [] },
      { text: "WiTH", confidence: 90, bbox: { x0: 200, y0: 100, x1: 250, y1: 130 }, words: [] },
      { text: "HEHEHE!", confidence: 90, bbox: { x0: 300, y0: 100, x1: 380, y1: 130 }, words: [] },
      { text: "COOOOOOCKS", confidence: 90, bbox: { x0: 400, y0: 100, x1: 520, y1: 130 }, words: [] },
      { text: "SQIiRT-", confidence: 90, bbox: { x0: 530, y0: 100, x1: 610, y1: 130 }, words: [] },
      { text: "iNG", confidence: 90, bbox: { x0: 620, y0: 100, x1: 660, y1: 130 }, words: [] }
    ];

    const ocrResult: OCRPageResult = {
      pageNumber: 1,
      width: 1000,
      height: 1000,
      dpi:300,
      language: 'eng',
      algorithmVersion: 1,
      lines: testLines,
      words: [],
      text: '',
      confidence: 90,
      pipelineProfile: 'panel',
      ocrEngine: 'paddleocr'
    };

    const finalResult = applyPanelSafetyLineDedup(ocrResult);
    const keptTexts = finalResult.lines.map(l => l.text);
    
    console.log('--- Kept texts in manga short words regression:', keptTexts);
    console.log('--- Dropped in manga short words regression:', finalResult.debug?.droppedWords);

    // Verify all critical words are kept (as raw OCR texts before spelling normalizer)
    expect(keptTexts).toContain("YQU'RE");
    expect(keptTexts).toContain("WiTH");
    expect(keptTexts).toContain("HEHEHE!");
    expect(keptTexts).toContain("COOOOOOCKS");

    // Verify spelling normalization works correctly on these kept texts
    expect(normalizeSourceForTranslation("YQU'RE", 'en')).toBe("You're");
    expect(normalizeSourceForTranslation("WiTH", 'en')).toBe("With");
    expect(normalizeSourceForTranslation("HEHEHE!", 'en')).toBe("Hehehe!"); // normalizes casing for English translation sentences
  });

  it('runs on page 25 raw OCR data', () => {
    const rawOcrPath = 'c:\\App\\Electron\\PDF_Translator\\scratch\\ocr_page_25_raw.json';
    if (!fs.existsSync(rawOcrPath)) {
      console.log('ocr_page_25_raw.json not found');
      return;
    }
    const ocrResult = JSON.parse(fs.readFileSync(rawOcrPath, 'utf8')) as OCRPageResult;
    ocrResult.pipelineProfile = 'panel';
    ocrResult.ocrEngine = 'paddleocr';

    console.log('=== Page 25 initial lines count:', ocrResult.lines.length);
    const finalResult = applyPanelSafetyLineDedup(ocrResult);
    console.log('=== Page 25 final lines count:', finalResult.lines.length);
    
    console.log('=== Kept Lines:');
    finalResult.lines.forEach((l, i) => {
      console.log(`[${i}] text="${l.text}"`);
    });

    console.log('=== Dropped Words/Lines:');
    const dropped = finalResult.debug?.droppedWords || [];
    dropped.forEach((d, i) => {
      console.log(`[${i}] reason=${d.reason} filter=${d.filter} text="${d.text}"`);
    });
  });
});


