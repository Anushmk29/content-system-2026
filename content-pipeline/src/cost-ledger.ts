// Cost ledger: every paid call lands in content.cost_events. Adapters report each call through
// an `onCost` hook (one choke point per provider); WHERE the money went comes from the
// AsyncLocalStorage scope an entry point opened with withCostScope, so no signatures change.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { Db } from './db/client.ts';
import type { Logger } from './logger.ts';

export interface CostEvent {
  provider: 'openrouter' | 'apify' | 'jev';
  kind: 'llm' | 'image' | 'scrape' | 'decision';
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  units?: number;
  costUsd: number;
  ok: boolean;
  error?: string;
  meta?: Record<string, unknown>;
}
export type OnCost = (e: CostEvent) => unknown;

export interface CostScope { feature: string; refType?: string; refId?: string }

const scope = new AsyncLocalStorage<CostScope>();

/** Tag every paid call made inside `fn` (and anything it starts) with this feature/ref. */
export const withCostScope = <T>(s: CostScope, fn: () => T): T => scope.run(s, fn);

/** Wrap an entry point `(ctx, id?, …)`. With `refType`, the id argument is the ref; otherwise each
 *  invocation gets its own id, so the Costs page can total one click's calls as one operation. */
export function costScoped<C, A extends unknown[], R>(feature: string, fn: (ctx: C, ...a: A) => Promise<R>, refType?: string) {
  return (ctx: C, ...a: A): Promise<R> => withCostScope(
    refType && typeof a[0] === 'string' ? { feature, refType, refId: a[0] } : { feature, refType: 'op', refId: randomUUID() },
    () => fn(ctx, ...a));
}

/** Postgres text/jsonb reject NUL and lone surrogates; scraped handles and error text can carry both. */
const pgSafe = (s: string) => s.replace(/\u0000|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '');
const safe = (s: string | null | undefined) => (s == null ? null : pgSafe(s));

/** The onCost hook: one insert per call, never throws (a logging failure must not break the work).
 *  The spend must land even when the descriptive fields can't: the daily cap sums these rows. */
export function costRecorder(db: Db, logger: Logger): (e: CostEvent) => Promise<void> {
  const insert = (vals: unknown[]) => db.query(
    `insert into content.cost_events (provider, kind, feature, model, ref_type, ref_id, input_tokens, output_tokens, units, cost_usd, ok, error, meta)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, vals);
  return async (e) => {
    const s = scope.getStore(); // read now, while still inside the caller's scope
    const head = [e.provider, e.kind, safe(s?.feature) ?? 'untagged'];
    const tail = [e.inputTokens ?? null, e.outputTokens ?? null, e.units ?? null, e.costUsd, e.ok];
    try {
      await insert([...head, safe(e.model), safe(s?.refType), safe(s?.refId), ...tail, safe(e.error?.slice(0, 500)),
        e.meta ? JSON.stringify(e.meta, (_k, v) => (typeof v === 'string' ? pgSafe(v) : v)) : null]);
    } catch (err) {
      logger.error('cost ledger insert failed', (err as Error).message);
      try { await insert([...head, null, null, null, ...tail, 'details dropped: ledger insert failed', null]); }
      catch (err2) { logger.error('cost ledger fallback insert failed', (err2 as Error).message); }
    }
  };
}

export class BudgetExceeded extends Error { override name = 'BudgetExceeded'; }

/** Throws BudgetExceeded once the last 24h of cost_events reach `dailyUsd` (unset/0 = no cap).
 *  Checked before every paid call; the total is cached 10s so a busy run doesn't query per call.
 *  A failed read blocks the call: with no ledger we can't know what's been spent.
 *  ponytail: per-process cache (web and scheduler each keep one), so parallel calls can overshoot by
 *  one burst; a shared reservation table if this ever runs on several instances. */
export function budgetGuard(db: Db, dailyUsd: number | undefined, logger: Logger): () => Promise<void> {
  let spent = 0, readAt = 0;
  return async () => {
    if (!dailyUsd) return;
    if (Date.now() - readAt > 10_000) {
      try {
        const r = await db.query<{ usd: string | null }>(
          `select sum(cost_usd)::text as usd from content.cost_events where at > now() - interval '1 day'`);
        spent = Number(r.rows[0]?.usd ?? 0);
        readAt = Date.now();
      } catch (e) {
        logger.warn('budget check failed', (e as Error).message);
        throw new BudgetExceeded('budget check failed — paid calls are paused until the database answers');
      }
    }
    if (spent >= dailyUsd) throw new BudgetExceeded(`daily budget reached: $${spent.toFixed(2)} of $${dailyUsd} in the last 24h (CONTENT_DAILY_BUDGET_USD)`);
  };
}

/** Put `guard` in front of the named methods of an adapter (mutates and returns it). */
export function gate<T extends object>(adapter: T, methods: (keyof T)[], guard: () => Promise<void>): T {
  for (const m of methods) {
    const fn = adapter[m] as unknown as (...a: unknown[]) => Promise<unknown>;
    (adapter as Record<keyof T, unknown>)[m] = async (...a: unknown[]) => { await guard(); return fn.apply(adapter, a); };
  }
  return adapter;
}
