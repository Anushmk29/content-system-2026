// Own Results — once a week, scrape the client's own accounts (Brand Kit → own accounts) through
// the same Decode path: their median per platform becomes "your usual", and our published posts
// found in the scrape get those numbers as metrics. The run itself works in the background.
import type { Module, ModuleContext, ModuleResult } from './module.ts';
import { ok, skipped, degraded } from './module.ts';
import { startDecode, selfCompetitor } from '../services/decode-service.ts';

export const ownResultsModule: Module = {
  id: 'own_results',
  title: 'Own Results',
  description: 'Weekly scrape of your own accounts: sets "your usual" per platform and fills in results for published posts.',

  async run(ctx: ModuleContext): Promise<ModuleResult> {
    if (!ctx.adapters.apify.configured) return skipped('Apify not configured (CONTENT_APIFY_TOKEN)');
    const self = await selfCompetitor(ctx);
    if (!Object.keys(self.handles).length) return skipped('no own accounts in Brand Kit');
    const last = (await ctx.db.query<{ started_at: string; cost: number }>(
      `select started_at::text, (cost_ai_usd + cost_apify_usd)::float8 as cost from content.decode_runs
       where $1 = any(competitor_ids) order by started_at desc limit 1`, [self.id])).rows[0];
    if (last && Date.now() - new Date(last.started_at).getTime() < 7 * 86_400_000) {
      return skipped(`refreshed ${last.started_at.slice(0, 10)} ($${last.cost.toFixed(2)}); next one 7 days after that`);
    }
    try {
      const run = await startDecode(ctx, { self: true });
      return ok(0, `refreshing your own posts (run ${run.id.slice(0, 8)})${last ? `; last refresh cost $${last.cost.toFixed(2)}` : ''}`);
    } catch (e) {
      const msg = (e as Error).message;
      return /already running/.test(msg) ? skipped('a Decode is running; tries again next run') : degraded(msg);
    }
  },
};
