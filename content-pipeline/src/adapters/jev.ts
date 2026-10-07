// Jev adapter — TypeSafe's decision model (non-generative). It answers typed
// questions about a piece of text with probabilities instead of prose, so it is
// used for the classify/score decisions only; drafting stays on the LLM adapter.
// API: POST /v1/systemone { model, state, questions } -> { model, answers }.
import type { Adapter } from './adapter.ts';
import type { HealthReport } from '../health.ts';
import { report } from '../health.ts';

const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
// Pinned on purpose: `jev-latest` moves, which silently shifts tuned thresholds.
const DEFAULT_JEV_MODEL = 'jev-1.13.0';

// off     = never called
// shadow  = called and logged next to the LLM; the LLM answer is still what's used
// primary = Jev answer is used when confident enough, else the LLM decides
export type JevMode = 'off' | 'shadow' | 'primary';

export type JevQuestion =
  | { type: 'noul'; instructions: string; criteria?: { true: string; false: string } }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] };

export interface JevAnswer {
  type: 'noul' | 'choice' | 'score';
  noul?: number;                       // P(true)
  choice?: string;
  score?: number;                      // fractional level index, 0-based
  probabilities?: Record<string, number>;
  confidence?: number;
}

export interface JevResult {
  model: string;
  answers: Record<string, JevAnswer>;
}

export interface JevConfig {
  apiKey?: string;
  model?: string;
  mode?: JevMode;
  minConfidence?: number;
}

export interface JevAdapter extends Adapter {
  readonly mode: JevMode;
  readonly model: string;
  readonly minConfidence: number;
  decide(state: string, questions: Record<string, JevQuestion>): Promise<JevResult>;
}

export function createJev(cfg: JevConfig = {}): JevAdapter {
  const model = cfg.model ?? DEFAULT_JEV_MODEL;
  const mode: JevMode = cfg.apiKey ? (cfg.mode ?? 'shadow') : 'off';
  const minConfidence = cfg.minConfidence ?? 0.8;

  return {
    id: 'jev',
    configured: mode !== 'off',
    mode,
    model,
    minConfidence,

    async decide(state, questions) {
      // ponytail: 3 attempts with fixed backoff; add jitter/queueing if 429s become common.
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(JEV_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify({ model, state, questions }),
          signal: AbortSignal.timeout(15_000),
        });
        if ((res.status === 429 || res.status === 529) && attempt < 2) {
          await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
          continue;
        }
        if (!res.ok) throw new Error(`Jev ${res.status}: ${await res.text()}`);
        const data = (await res.json()) as { model?: string; answers?: Record<string, JevAnswer> };
        return { model: data.model ?? model, answers: data.answers ?? {} };
      }
    },

    async healthCheck(): Promise<HealthReport> {
      if (mode === 'off') return report('jev', 'unconfigured', 'no CONTENT_TYPESAFE_API_KEY');
      return report('jev', 'ok', `${mode} mode, key present`, { model, mode, minConfidence });
    },
  };
}
