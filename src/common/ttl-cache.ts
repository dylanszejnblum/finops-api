// ponytail: per-instance memory cache; swap for Redis when running several replicas.
// Caches the promise, so concurrent callers share one upstream request.
export class TtlCache<T> {
  private readonly entries = new Map<
    string,
    { expires: number; value: Promise<T> }
  >();

  constructor(private readonly ttlMs: number) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    if (this.ttlMs <= 0) return load();
    const hit = this.entries.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    const value = load();
    this.entries.set(key, { expires: Date.now() + this.ttlMs, value });
    value.catch(() => this.entries.delete(key)); // never cache failures
    return value;
  }
}
