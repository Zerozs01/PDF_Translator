export class ConcurrencyLimiter {
  private activeCount = 0;
  private queue: Array<{ resolve: () => void; reject: (err: any) => void }> = [];

  constructor(private maxConcurrency: number = 2) {}

  public get active(): number {
    return this.activeCount;
  }

  public get pending(): number {
    return this.queue.length;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.activeCount >= this.maxConcurrency) {
      await new Promise<void>((resolve, reject) => {
        this.queue.push({ resolve, reject });
      });
      // Slot was passed directly to this waiter from the finishing task.
    } else {
      this.activeCount++;
    }

    try {
      return await fn();
    } finally {
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        // Hand off slot directly to waiter without dropping activeCount below max
        next?.resolve();
      } else {
        this.activeCount--;
      }
    }
  }

  clear(): void {
    const error = new DOMException('Operation aborted', 'AbortError');
    const waiters = this.queue;
    this.queue = [];
    for (const waiter of waiters) {
      waiter.reject(error);
    }
  }
}
