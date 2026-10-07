// Topic Scorer (Bible §7). Two jobs:
//   1. Auto-score any unscored 'new' topics on the five 1-5 factors via the LLM
//      (honest-numbers baked in: unprovable topics score low on proof and fall away).
//   2. Summarize the resulting ranked queue by priority band for the dashboard.
// The DB derives score_total + priority_band from the five factors (generated columns).
import type { Module, ModuleContext, ModuleResult } from './module.ts';
import { createRepo } from '../db/repo.ts';
import { decide, canDecide } from './decide.ts';
import { TOPIC_SCORE } from './decision-tasks.ts';

export const scoringModule: Module = {
  id: 'scoring',
  title: 'Topic Scorer',
  description: 'Auto-scores new topics (Bible §7) and summarizes the ranked queue by band.',

  async run(ctx: ModuleContext): Promise<ModuleResult> {
    const repo = createRepo(ctx.db);

    // 1) Auto-score unscored topics (LLM, Jev in shadow/primary — see decide.ts).
    let scored = 0;
    const failures: string[] = [];
    if (canDecide(ctx, TOPIC_SCORE)) {
      const unscored = await repo.unscoredTopics();
      for (const t of unscored) {
        try {
          const s = await decide(ctx, TOPIC_SCORE, t.id, t);
          await repo.setTopicScores(t.id, {
            leadIntent: s.leadIntent, reach: s.reach, brandFit: s.brandFit,
            proof: s.proof, repurpose: s.repurpose,
            pillar: s.pillar ?? t.pillar, funnelStage: s.funnelStage ?? t.funnel_stage,
          });
          scored++;
        } catch (e) {
          failures.push(`${t.id}: ${(e as Error).message}`);
        }
      }
    }

    // 1b) Opt-in autopilot (CONTENT_AUTO_SELECT_TOPICS): hand the best high-band topics
    //     straight to drafting. Everything still stops at the human approval gate.
    const autoSelected = ctx.env.autoSelectTopics > 0 ? await repo.autoSelectTopics(ctx.env.autoSelectTopics) : 0;

    // 2) Summarize the ranked queue by band (dependency-free, always runs).
    const bands = await repo.topicBandCounts();
    const total = Object.values(bands).reduce((a, b) => a + b, 0);

    const queueMsg = `queue: ${bands['high'] ?? 0} high, ${bands['queue'] ?? 0} queued, ${bands['if_timely'] ?? 0} if-timely`;
    const message = (scored ? `scored ${scored} new topic(s); ` : '') +
      (autoSelected ? `auto-selected ${autoSelected} high topic(s); ` : '') + queueMsg +
      (failures.length ? `; ${failures.length} score failures` : '');

    return {
      status: failures.length > 0 ? 'degraded' : 'ok',
      itemsProcessed: scored,
      message,
      meta: { scored, autoSelected, bands, total, failures },
    };
  },
};
