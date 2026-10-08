// Per-item model calls (research, scoring, QC) run a few at a time instead of one by one.
// Kept low so OpenRouter rate limits stay rare; the adapters already retry 429s.
export const MODEL_CONCURRENCY = 4;

/** `fn` over `items`, at most `limit` at once; results keep the input order. A throw rejects like Promise.all. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
