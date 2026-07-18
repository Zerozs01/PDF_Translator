import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { applyPanelSafetyLineDedup } from './ocrSafetyLineDedup';
import { OCRPageResult } from '../../types';
import { normalizeSourceForTranslation } from './ocrTextNormalizer';

describe('Scratch Dedup Test', () => {
  it('checks if CAN DO and IS TO SEARCH are dropped', () => {
    const logPath = 'C:\\Users\\auand\\.gemini\\antigravity-ide\\brain\\e4b0aed9-e4d9-43cb-9a00-c0b1a2c23338\\.system_generated\\tasks\\task-1512.log';
    if (!fs.existsSync(logPath)) {
      console.warn('task-1512.log not found, skipping scratch check');
      return;
    }
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
    const joinedKeptTexts = keptTexts.join(' ');
    expect(joinedKeptTexts).toContain("YQU'RE");
    expect(joinedKeptTexts).toContain("WiTH");
    expect(joinedKeptTexts).toContain("HEHEHE!");
    expect(joinedKeptTexts).toContain("COOOOOOCKS");

    // Verify spelling normalization works correctly on these kept texts
    expect(normalizeSourceForTranslation("YQU'RE", 'en')).toBe("You're");
    expect(normalizeSourceForTranslation("WiTH", 'en')).toBe("With");
    expect(normalizeSourceForTranslation("HEHEHE!", 'en')).toBe("Hehehe!"); // normalizes casing for English translation sentences
  });

  it('runs on page 25 raw OCR data', () => {
    const rawOcrPath = 'c:\\App\\Electron\\PDF_Translator\\scratch\\ocr_raw_300.json';
    if (!fs.existsSync(rawOcrPath)) {
      console.log('ocr_raw_300.json not found');
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

  it('merges close horizontal lines on the same baseline', () => {
    const testLines = [
      { text: "Equilibrium", confidence: 95, bbox: { x0: 100, y0: 80, x1: 200, y1: 140 }, words: [{ text: "Equilibrium", confidence: 95, bbox: { x0: 100, y0: 80, x1: 200, y1: 140 } }] },
      { text: "of", confidence: 96, bbox: { x0: 210, y0: 100, x1: 230, y1: 120 }, words: [{ text: "of", confidence: 96, bbox: { x0: 210, y0: 100, x1: 230, y1: 120 } }] },
      { text: "a", confidence: 94, bbox: { x0: 240, y0: 100, x1: 250, y1: 120 }, words: [{ text: "a", confidence: 94, bbox: { x0: 240, y0: 100, x1: 250, y1: 120 } }] },
      { text: "Rigid Body", confidence: 93, bbox: { x0: 260, y0: 80, x1: 360, y1: 140 }, words: [{ text: "Rigid", confidence: 93, bbox: { x0: 260, y0: 80, x1: 300, y1: 140 } }, { text: "Body", confidence: 93, bbox: { x0: 310, y0: 80, x1: 360, y1: 140 } }] }
    ];

    const ocrResult: OCRPageResult = {
      pageNumber: 1,
      width: 1000,
      height: 1000,
      dpi: 300,
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
    console.log('--- Kept texts in baseline merge test:', keptTexts);

    expect(keptTexts).toContain("Equilibrium of a Rigid Body");
    expect(finalResult.lines.length).toBe(1);
    expect(finalResult.lines[0].bbox).toEqual({ x0: 100, y0: 80, x1: 360, y1: 140 });
    expect(finalResult.lines[0].words.length).toBe(5);
  });
});


