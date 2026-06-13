type Task<T> = () => Promise<T>;

export class Queue {
  private concurrency: number;
  private running = 0;
  private waiting: Array<{ task: Task<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void }> = [];

  constructor(concurrency: number) {
    this.concurrency = concurrency;
  }

  add<T>(task: Task<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.waiting.push({ task: task as Task<unknown>, resolve: resolve as (v: unknown) => void, reject });
      this.tick();
    });
  }

  get depth(): number {
    return this.waiting.length + this.running;
  }

  get pending(): number {
    return this.waiting.length;
  }

  private tick(): void {
    while (this.running < this.concurrency && this.waiting.length > 0) {
      const next = this.waiting.shift()!;
      this.running++;
      Promise.resolve()
        .then(() => next.task())
        .then(
          (v) => {
            this.running--;
            next.resolve(v);
            this.tick();
          },
          (e) => {
            this.running--;
            next.reject(e);
            this.tick();
          }
        );
    }
  }

  async drain(): Promise<void> {
    while (this.running > 0 || this.waiting.length > 0) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}
