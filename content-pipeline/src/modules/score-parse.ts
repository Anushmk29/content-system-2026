// Pure parser for the Topic Scorer's LLM response (Bible §7). The LLM returns the
// five 1-5 factor scores; we clamp them and (optionally) accept a pillar/funnel
// classification. The DB then derives score_total + priority_band (generated cols).
import { FUNNEL_STAGES, clamp1to5, type FunnelStage } from '../../core/src/index.ts';
import { pillarSlugs } from '../brand.ts';
import { parseJsonObject } from './llm-json.ts';

export interface ParsedTopicScore {
  leadIntent: number;
  reach: number;
  brandFit: number;
  proof: number;
  repurpose: number;
  pillar?: string;
  funnelStage?: FunnelStage;
}

export function parseTopicScore(raw: string): ParsedTopicScore {
  const o = parseJsonObject(raw);
  const out: ParsedTopicScore = {
    leadIntent: clamp1to5(o.leadIntent ?? o.score_lead_intent),
    reach: clamp1to5(o.reach ?? o.score_reach),
    brandFit: clamp1to5(o.brandFit ?? o.score_brand_fit),
    proof: clamp1to5(o.proof ?? o.score_proof),
    repurpose: clamp1to5(o.repurpose ?? o.score_repurpose),
  };
  if (typeof o.pillar === 'string' && pillarSlugs().includes(o.pillar)) {
    out.pillar = o.pillar;
  }
  if (typeof o.funnelStage === 'string' && (FUNNEL_STAGES as readonly string[]).includes(o.funnelStage)) {
    out.funnelStage = o.funnelStage as FunnelStage;
  }
  return out;
}
