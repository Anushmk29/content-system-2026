// Sliding-window request counter. Used for login attempts, wrong secrets and the routes that
// spend money (LLM, Apify). No dependency.
// ponytail: in-memory, per server instance; move to Postgres/Redis if this ever runs on several instances.
const hits = new Map<string, number[]>();

/** True when `key` already made `max` calls inside the window; otherwise records this call. */
export function limited(key: string, max: number, windowMs = 60_000, now = Date.now()): boolean {
  if (hits.size > 10_000) {
    // Bound memory against key floods by dropping idle keys; never reset live counters.
    for (const [k, ts] of hits) if (now - (ts[ts.length - 1] ?? 0) >= windowMs) hits.delete(k);
    if (hits.size > 50_000 && !hits.has(key)) return true; // still flooded: refuse new keys
  }
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  const over = recent.length >= max;
  if (!over) recent.push(now);
  hits.set(key, recent);
  return over;
}

/** Client IP as our own reverse proxy saw it. Each proxy appends to X-Forwarded-For, so only the
 *  right-most CONTENT_PROXY_HOPS entries (default 1: one proxy in front, as in the Docker setup)
 *  are trustworthy; anything left of them was sent by the client and is ignored. */
export function clientIp(req: Request, hops = Number(process.env.CONTENT_PROXY_HOPS) || 1): string {
  const chain = (req.headers.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return chain[Math.max(0, chain.length - hops)] || 'local';
}
