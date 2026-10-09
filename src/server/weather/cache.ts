import { WeatherServiceError } from "./errors";

type Entry<T> = { value: T; storedAt: number };
export type CacheResult<T> = Entry<T> & { stale: boolean };

/** Process-local LRU cache. In-flight promises are shared and always cleaned up. */
export class BoundedCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly pending = new Map<string, Promise<CacheResult<T>>>();

  constructor(
    private readonly maxEntries: number,
    private readonly freshMs: number,
    private readonly staleMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxPending = 32,
  ) {}

  async get(
    key: string,
    load: () => Promise<T>,
    usable: (value: T) => boolean = () => true,
  ): Promise<CacheResult<T>> {
    const entry = this.entries.get(key);
    const age = entry ? this.now() - entry.storedAt : Infinity;
    if (entry && age < this.freshMs && usable(entry.value)) {
      this.entries.delete(key);
      this.entries.set(key, entry);
      return { ...entry, stale: false };
    }
    const pending = this.pending.get(key);
    if (pending) return pending;
    if (this.pending.size >= this.maxPending) {
      throw new WeatherServiceError("SERVICE_BUSY", "The weather service is busy. Please try again shortly.", 503, true);
    }
    // Schedule after registering the promise so even synchronous loaders coalesce safely.
    const request = Promise.resolve().then(load).then((value) => {
      const next = { value, storedAt: this.now() };
      this.entries.delete(key);
      this.entries.set(key, next);
      while (this.entries.size > this.maxEntries) {
        const oldest = this.entries.keys().next().value;
        if (oldest === undefined) break;
        this.entries.delete(oldest);
      }
      return { ...next, stale: false };
    }).catch((error: unknown) => {
      if (entry && this.now() - entry.storedAt < this.staleMs && usable(entry.value)) {
        return { ...entry, stale: true };
      }
      throw error;
    }).finally(() => {
      this.pending.delete(key);
    });
    this.pending.set(key, request);
    return request;
  }
}
