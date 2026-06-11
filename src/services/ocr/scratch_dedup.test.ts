import { describe, it } from 'vitest';
import * as fs from 'fs';
import { applyPanelSafetyLineDedup } from './ocrSafetyLineDedup';
import { OCRPageResult } from '../../types';

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
});
