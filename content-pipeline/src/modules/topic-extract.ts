// Pure parser for the Research Collector's LLM response (Bible §6). Turns one raw
// research signal (a prospect question, a Reddit pain point, a note) into a candidate
// topic. Grounded in the input — the prompt forbids inventing topics. Pillar/funnel
// fall back to safe defaults if the model returns something off-vocabulary.
import { FUNNEL_STAGES, type FunnelStage } from '../../core/src/index.ts';
import { pillarSlugs } from '../brand.ts';
import { parseJsonObject } from './llm-json.ts';

export interface ExtractedTopic {
  title: string;
  pillar: string;
  funnelStage: FunnelStage;
  customerLanguage: string | null;
}

const DEFAULT_FUNNEL: FunnelStage = 'awareness';

export function parseExtractedTopic(raw: string): ExtractedTopic {
  const o = parseJsonObject(raw);
  const title = typeof o.title === 'string' ? o.title.trim() : '';
  if (title.length === 0) throw new Error('extracted topic has no title');

  const pillars = pillarSlugs();
  const pillar = typeof o.pillar === 'string' && pillars.includes(o.pillar) ? o.pillar : pillars[0]!;
  const funnelStage = typeof o.funnelStage === 'string' && (FUNNEL_STAGES as readonly string[]).includes(o.funnelStage)
    ? (o.funnelStage as FunnelStage) : DEFAULT_FUNNEL;
  const customerLanguage = typeof o.customerLanguage === 'string' && o.customerLanguage.trim().length > 0
    ? o.customerLanguage.trim() : null;

  return { title, pillar, funnelStage, customerLanguage };
}
