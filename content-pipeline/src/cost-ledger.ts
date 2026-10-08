// Cost ledger: every paid call lands in content.cost_events. Adapters report each call through
// an `onCost` hook (one choke point per provider); WHERE the money went comes from the
// AsyncLocalStorage scope an entry point opened with withCostScope, so no signatures change.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { Db } from './db/client.ts';
import type { Logger } from './logger.ts';

export interface CostEvent {
  provider: 'openrouter' | 'anthropic' | 'apify' | 'jev';
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

/** The onCost hook: one insert per call, never throws (a logging failure must not break the work). */
export function costRecorder(db: Db, logger: Logger): (e: CostEvent) => Promise<void> {
  return async (e) => {
    const s = scope.getStore(); // read now, while still inside the caller's scope
    try {
      await db.query(
        `insert into content.cost_events (provider, kind, feature, model, ref_type, ref_id, input_tokens, output_tokens, units, cost_usd, ok, error, meta)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [e.provider, e.kind, s?.feature ?? 'untagged', e.model ?? null, s?.refType ?? null, s?.refId ?? null,
          e.inputTokens ?? null, e.outputTokens ?? null, e.units ?? null, e.costUsd, e.ok, e.error?.slice(0, 500) ?? null,
          e.meta ? JSON.stringify(e.meta) : null]);
    } catch (err) {
      logger.error('cost ledger insert failed', (err as Error).message);
    }
  };
}
