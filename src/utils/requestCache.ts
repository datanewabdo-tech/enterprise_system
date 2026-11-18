export interface CachedEntry<T = unknown> {
  data: T;
  timestamp: number;
}

class RequestCache {
  private store = new Map<string, CachedEntry<unknown>>();
  private defaultTtlMs: number;

  constructor(defaultTtlMs = 30_000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  get<T>(key: string, ttlMs: number = this.defaultTtlMs): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (ttlMs > 0 && Date.now() - entry.timestamp > ttlMs) {
      this.store.delete(key);
      return undefined;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T): void {
    this.store.set(key, { data, timestamp: Date.now() });
  }

  invalidate(keyOrPrefix: string): void {
    if (this.store.has(keyOrPrefix)) {
      this.store.delete(keyOrPrefix);
      return;
    }
    for (const k of Array.from(this.store.keys())) {
      if (k.startsWith(keyOrPrefix)) {
        this.store.delete(k);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }
}

export const requestCache = new RequestCache(30_000);
