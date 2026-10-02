/**
 * A small time-boxed cache with in-flight de-duplication.
 *
 * The symbol page fans out to a dozen upstream reads — profile, statements,
 * options, news — and every one of them changes on a scale of minutes to days.
 * Without this, two tabs open on the same name, or one reader flicking between
 * tabs, would cost a request each time against an upstream that throttles by
 * address. With it, the second reader of anything is answered from memory, and
 * ten readers arriving at once cause one fetch.
 *
 * Failures are never cached: an upstream that was down a second ago may not be
 * now, and a cached error would hold the page broken for the whole TTL.
 *
 * Bounded by entry count, evicting the oldest insertion first. A map preserves
 * insertion order, which is all an approximate LRU needs here — what matters is
 * that the process cannot grow without limit as readers open new symbols.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export interface TtlCache<T> {
  /** The cached value, or the loader's result stored for `ttlMs`. */
  get(key: string, ttlMs: number, load: () => Promise<T>): Promise<T>;
  /** Whether a fresh value or a running load exists — i.e. `get` would not fetch. */
  has(key: string): boolean;
  delete(key: string): void;
  readonly size: number;
}

export function createTtlCache<T>(
  options: { maxEntries?: number; now?: () => number } = {},
): TtlCache<T> {
  const maxEntries = options.maxEntries ?? 500;
  const now = options.now ?? Date.now;
  const entries = new Map<string, Entry<T>>();
  const inFlight = new Map<string, Promise<T>>();

  function fresh(key: string): Entry<T> | undefined {
    const entry = entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= now()) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  }

  function store(key: string, value: T, ttlMs: number): void {
    entries.delete(key);
    entries.set(key, { value, expiresAt: now() + ttlMs });
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next();
      if (oldest.done === true) break;
      entries.delete(oldest.value);
    }
  }

  return {
    async get(key, ttlMs, load) {
      const hit = fresh(key);
      if (hit !== undefined) return hit.value;

      const running = inFlight.get(key);
      if (running !== undefined) return running;

      const promise = load()
        .then((value) => {
          store(key, value, ttlMs);
          return value;
        })
        .finally(() => inFlight.delete(key));
      inFlight.set(key, promise);
      return promise;
    },

    has(key) {
      return fresh(key) !== undefined || inFlight.has(key);
    },

    delete(key) {
      entries.delete(key);
    },

    get size() {
      return entries.size;
    },
  };
}
