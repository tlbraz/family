// A small in-memory cache with a time limit, shared by the Entertainment tab's clients (TMDB, Radarr, Sonarr…).
// Two callers asking for the same thing at once share one request; failures aren't kept.

type Entry = { at: number; value: Promise<unknown> };

export function memo(limit = 3000) {
  const store = new Map<string, Entry>();
  return {
    get<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
      const hit = store.get(key);
      if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;
      if (store.size >= limit) {
        for (const [k, e] of store) if (Date.now() - e.at >= ttlMs) store.delete(k);
        if (store.size >= limit) store.delete(store.keys().next().value!);
      }
      const value = load();
      store.set(key, { at: Date.now(), value });
      value.catch(() => store.get(key)?.value === value && store.delete(key));
      return value;
    },
    forget(prefix = '') {
      for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
    },
  };
}

/** Runs `fn` over the list, a few at a time (to be gentle with the APIs). */
export async function mapLimit<T, R>(list: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(list.length);
  let i = 0;
  const worker = async () => {
    while (i < list.length) {
      const n = i++;
      out[n] = await fn(list[n]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return out;
}
