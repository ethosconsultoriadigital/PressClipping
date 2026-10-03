export interface HostLimiterOpts {
  globalLimit: number;
  perHostLimit: number;
}

export class HostConcurrencyLimiter {
  private inflight = 0;
  private readonly perHost = new Map<string, number>();
  private readonly waiters: Array<() => boolean> = [];

  constructor(private readonly opts: HostLimiterOpts) {}

  private hostOf(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    } catch {
      return 'unknown';
    }
  }

  private canRun(host: string): boolean {
    if (this.inflight >= this.opts.globalLimit) return false;
    return (this.perHost.get(host) ?? 0) < this.opts.perHostLimit;
  }

  private flush(): void {
    let progressed = true;
    while (progressed && this.waiters.length) {
      progressed = false;
      const pending = [...this.waiters];
      this.waiters.length = 0;
      for (const w of pending) {
        const started = w();
        if (!started) this.waiters.push(w);
        else progressed = true;
      }
    }
  }

  async run<T>(url: string, fn: () => Promise<T>): Promise<T> {
    const host = this.hostOf(url);
    await new Promise<void>((resolve) => {
      const tryStart = (): boolean => {
        if (!this.canRun(host)) return false;
        this.inflight += 1;
        this.perHost.set(host, (this.perHost.get(host) ?? 0) + 1);
        resolve();
        return true;
      };
      if (!tryStart()) this.waiters.push(tryStart);
    });
    try {
      return await fn();
    } finally {
      this.inflight -= 1;
      const n = (this.perHost.get(host) ?? 1) - 1;
      if (n <= 0) this.perHost.delete(host);
      else this.perHost.set(host, n);
      this.flush();
    }
  }
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, async () => {
    while (true) {
      const idx = i;
      i += 1;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]!);
    }
  });
  if (!items.length) return [];
  await Promise.all(workers);
  return out;
}
