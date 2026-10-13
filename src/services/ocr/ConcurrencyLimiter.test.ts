import { describe, it, expect } from 'vitest';
import { ConcurrencyLimiter } from './ConcurrencyLimiter';

describe('ConcurrencyLimiter (F2 Acceptance)', () => {
  it('simulates 10 tasks with maxConcurrency=2 and guarantees active never exceeds 2', async () => {
    const limiter = new ConcurrencyLimiter(2);
    let currentActive = 0;
    let maxActiveSeen = 0;
    const completed: number[] = [];

    const tasks = Array.from({ length: 10 }, (_, i) => {
      return limiter.run(async () => {
        currentActive++;
        if (currentActive > maxActiveSeen) {
          maxActiveSeen = currentActive;
        }
        expect(currentActive).toBeLessThanOrEqual(2);

        // Simulate async I/O
        await new Promise((resolve) => setTimeout(resolve, 15));

        currentActive--;
        completed.push(i);
        return i;
      });
    });

    const results = await Promise.all(tasks);
    expect(results).toHaveLength(10);
    expect(completed).toHaveLength(10);
    expect(maxActiveSeen).toBe(2);
    expect(currentActive).toBe(0);
    expect(limiter.active).toBe(0);
    expect(limiter.pending).toBe(0);
  });

  it('hands off slot directly to waiter without dropping activeCount below max when tasks are queued', async () => {
    const limiter = new ConcurrencyLimiter(2);
    const activeSnapshots: number[] = [];

    // Fill the 2 slots
    let resolveTask0!: () => void;
    let resolveTask1!: () => void;

    const t0 = limiter.run(() => new Promise<void>((r) => { resolveTask0 = r; }));
    const t1 = limiter.run(() => new Promise<void>((r) => { resolveTask1 = r; }));

    // Task 2 is queued
    const t2 = limiter.run(async () => {
      activeSnapshots.push(limiter.active);
    });

    expect(limiter.active).toBe(2);
    expect(limiter.pending).toBe(1);

    // Resolve task 0 -> slot handed off to task 2 directly
    resolveTask0();
    await t2;

    expect(activeSnapshots[0]).toBe(2); // Never dipped below 2 during handoff!

    resolveTask1();
    await Promise.all([t0, t1]);
    expect(limiter.active).toBe(0);
  });

  it('clear() rejects all waiting tasks with AbortError and leaves no lingering promises', async () => {
    const limiter = new ConcurrencyLimiter(2);
    let currentActive = 0;
    let maxActiveSeen = 0;
    const rejectedErrors: any[] = [];
    const completedTasks: number[] = [];

    const tasks = Array.from({ length: 10 }, (_, i) => {
      return limiter
        .run(async () => {
          currentActive++;
          if (currentActive > maxActiveSeen) {
            maxActiveSeen = currentActive;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
          currentActive--;
          completedTasks.push(i);
          return i;
        })
        .catch((err) => {
          rejectedErrors.push(err);
          return null;
        });
    });

    // Let the first 2 tasks start running
    await new Promise((r) => setTimeout(r, 10));
    expect(limiter.active).toBe(2);
    expect(limiter.pending).toBe(8);

    // Abort halfway
    limiter.clear();

    const results = await Promise.all(tasks);
    expect(results).toHaveLength(10);

    // 8 waiting tasks must be rejected with AbortError
    expect(rejectedErrors).toHaveLength(8);
    for (const err of rejectedErrors) {
      expect(err.name).toBe('AbortError');
    }

    // No promises lingering
    expect(limiter.pending).toBe(0);
    expect(maxActiveSeen).toBe(2);
  });
});
