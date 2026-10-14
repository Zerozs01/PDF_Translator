import { describe, it, expect, vi } from 'vitest';
import { ConcurrencyLimiter } from './ConcurrencyLimiter';

describe('Bounded Two-Stage Producer-Consumer Pipeline (ADR-0008 Revised)', () => {
  it('guarantees inFlight active tasks never exceed maxInFlight (3) across OCR and Translation', async () => {
    const maxInFlight = 3;
    const inFlightLimiter = new ConcurrencyLimiter(maxInFlight);
    const ocrStageLimiter = new ConcurrencyLimiter(1);
    const translationStageLimiter = new ConcurrencyLimiter(1);

    let currentInFlight = 0;
    let peakInFlight = 0;
    const completedPages: number[] = [];

    const processPage = async (pageIndex: number) => {
      return inFlightLimiter.run(async () => {
        currentInFlight++;
        peakInFlight = Math.max(peakInFlight, currentInFlight);
        expect(currentInFlight).toBeLessThanOrEqual(maxInFlight);

        // Stage 1: OCR
        await ocrStageLimiter.run(async () => {
          await new Promise((r) => setTimeout(r, 10));
        });

        // Stage 2: Translation
        await translationStageLimiter.run(async () => {
          await new Promise((r) => setTimeout(r, 15));
        });

        currentInFlight--;
        completedPages.push(pageIndex);
      });
    };

    const tasks = Array.from({ length: 10 }, (_, i) => processPage(i));
    await Promise.all(tasks);

    expect(completedPages).toHaveLength(10);
    expect(peakInFlight).toBeLessThanOrEqual(3);
    expect(currentInFlight).toBe(0);
    expect(inFlightLimiter.active).toBe(0);
  });

  it('allows Page N+1 OCR to start immediately while Page N is translating (Pipeline Overlap)', async () => {
    const inFlightLimiter = new ConcurrencyLimiter(3);
    const ocrStageLimiter = new ConcurrencyLimiter(1);
    const translationStageLimiter = new ConcurrencyLimiter(1);

    const timeline: string[] = [];

    const page1 = async () => {
      return inFlightLimiter.run(async () => {
        await ocrStageLimiter.run(async () => {
          timeline.push('page1-ocr-start');
          await new Promise((r) => setTimeout(r, 30));
          timeline.push('page1-ocr-end');
        });
        // ocrStageLimiter is released here!
        await translationStageLimiter.run(async () => {
          timeline.push('page1-trans-start');
          await new Promise((r) => setTimeout(r, 40));
          timeline.push('page1-trans-end');
        });
      });
    };

    const page2 = async () => {
      return inFlightLimiter.run(async () => {
        await ocrStageLimiter.run(async () => {
          timeline.push('page2-ocr-start');
          await new Promise((r) => setTimeout(r, 20));
          timeline.push('page2-ocr-end');
        });
        await translationStageLimiter.run(async () => {
          timeline.push('page2-trans-start');
          await new Promise((r) => setTimeout(r, 20));
          timeline.push('page2-trans-end');
        });
      });
    };

    await Promise.all([page1(), page2()]);

    const page1OcrEndIdx = timeline.indexOf('page1-ocr-end');
    const page2OcrStartIdx = timeline.indexOf('page2-ocr-start');
    const page1TransEndIdx = timeline.indexOf('page1-trans-end');

    // Page 2 OCR starts right after Page 1 OCR ends, BEFORE Page 1 translation finishes!
    expect(page2OcrStartIdx).toBeGreaterThanOrEqual(page1OcrEndIdx);
    expect(page2OcrStartIdx).toBeLessThan(page1TransEndIdx);
  });

  it('clears inFlight, ocrStage, and translationStage limiters on abort and rejects pending tasks with AbortError', async () => {
    const inFlightLimiter = new ConcurrencyLimiter(3);
    const ocrStageLimiter = new ConcurrencyLimiter(1);
    const translationStageLimiter = new ConcurrencyLimiter(1);

    const clearAll = () => {
      ocrStageLimiter.clear();
      translationStageLimiter.clear();
      inFlightLimiter.clear();
    };

    const errors: any[] = [];
    const runTask = async (idx: number) => {
      return inFlightLimiter
        .run(async () => {
          await ocrStageLimiter.run(async () => {
            await new Promise((r) => setTimeout(r, 50));
          });
          await translationStageLimiter.run(async () => {
            await new Promise((r) => setTimeout(r, 50));
          });
        })
        .catch((err) => {
          errors.push({ idx, name: err?.name || String(err) });
        });
    };

    // Queue 8 tasks
    const tasks = Array.from({ length: 8 }, (_, i) => runTask(i));

    // Wait a tick for first tasks to enter limiters
    await new Promise((r) => setTimeout(r, 10));

    // Trigger abort
    clearAll();

    await Promise.all(tasks);

    // Any queued tasks must have received AbortError
    expect(errors.length).toBeGreaterThan(0);
    for (const err of errors) {
      expect(err.name).toBe('AbortError');
    }

    expect(inFlightLimiter.pending).toBe(0);
    expect(ocrStageLimiter.pending).toBe(0);
    expect(translationStageLimiter.pending).toBe(0);
  });

  it('guarantees monotonic progress values during overlapped execution', () => {
    let lastReportedProgress = 5;
    const progressHistory: number[] = [];

    const updateMonotonicProgress = (targetProgress: number) => {
      const nextProgress = Math.max(lastReportedProgress, Math.min(100, targetProgress));
      lastReportedProgress = nextProgress;
      progressHistory.push(nextProgress);
    };

    // Simulating updates arriving out of order (e.g. Page 2 OCR finishing while Page 1 translation is at lower scale)
    updateMonotonicProgress(10);
    updateMonotonicProgress(25);
    updateMonotonicProgress(20); // Out-of-order drop simulated
    updateMonotonicProgress(40);
    updateMonotonicProgress(35); // Another drop simulated
    updateMonotonicProgress(70);
    updateMonotonicProgress(90);
    updateMonotonicProgress(100);

    for (let i = 1; i < progressHistory.length; i++) {
      expect(progressHistory[i]).toBeGreaterThanOrEqual(progressHistory[i - 1]);
    }
    expect(lastReportedProgress).toBe(100);
  });
});
