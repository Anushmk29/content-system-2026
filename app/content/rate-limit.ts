// Sliding-window request counter. Used for login attempts, wrong secrets and the routes that
// spend money (LLM, Apify). No dependency.
// ponytail: in-memory, per server instance; move to Postgres/Redis if this ever runs on several instances.
const hits = new Map<string, number[]>();

/** True when `key` already made `max` calls inside the window; otherwise records this call. */
export function limited(key: string, max: number, windowMs = 60_000, now = Date.now()): boolean {
  if (hits.size > 10_000) hits.clear(); // bound memory against key floods
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  const over = recent.length >= max;
  if (!over) recent.push(now);
  hits.set(key, recent);
  return over;
}

/** Client IP as the proxy reports it; 'local' when there is no proxy header. */
export const clientIp = (req: Request) =>
  req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'local';
