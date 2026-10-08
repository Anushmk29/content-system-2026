// Jev adapter — TypeSafe's decision model (non-generative), served through OpenRouter. It answers
// typed questions about a piece of text with probabilities instead of prose, so it is used for
// the classify/score decisions only; drafting stays on the LLM adapter.
// API: POST openrouter.ai/api/alpha/decisions { model, state, questions } -> { model, answers, usage }.
// Same OpenRouter key as the LLM. `state` may be a plain string (checked live 2026-10-07).
import type { Adapter } from './adapter.ts';
import type { HealthReport } from '../health.ts';
import { report } from '../health.ts';
import type { OnCost } from '../cost-ledger.ts';
import { setTimeout as sleep } from 'node:timers/promises';

const JEV_URL = 'https://openrouter.ai/api/alpha/decisions';
// Pinned on purpose: a moving alias silently shifts tuned thresholds.
const DEFAULT_JEV_MODEL = 'typesafe/jev-1.13';

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

/** A post-hoc rule (from claude-x-jev's jev.py, MIT): when an answer crosses a threshold, set fields. */
export interface JevRule {
  when: { question: string; noul_gte?: number; noul_lte?: number; choice?: string; score_gte?: number };
  set: Record<string, unknown>;
}

export interface JevConfig {
  apiKey?: string;                     // the OpenRouter key
  model?: string;
  mode?: JevMode;
  minConfidence?: number;
  onCost?: OnCost;
}

export interface JevAdapter extends Adapter {
  readonly mode: JevMode;
  readonly model: string;
  readonly minConfidence: number;
  /** USD spent by this process so far (OpenRouter `usage.cost`). */
  readonly spentUsd: number;
  decide(state: string, questions: Record<string, JevQuestion>): Promise<JevResult>;
}

/** Fields every matching rule sets, later rules winning. */
export function applyRules(answers: Record<string, JevAnswer>, rules: JevRule[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const { when: w, set } of rules) {
    const a = answers[w.question];
    if (!a) continue;
    const hit = (w.noul_gte === undefined || (a.noul ?? -1) >= w.noul_gte)
      && (w.noul_lte === undefined || (a.noul ?? 2) <= w.noul_lte)
      && (w.choice === undefined || a.choice === w.choice)
      && (w.score_gte === undefined || (a.score ?? -1) >= w.score_gte);
    if (hit) Object.assign(out, set);
  }
  return out;
}

export function createJev(cfg: JevConfig = {}): JevAdapter {
  const model = cfg.model ?? DEFAULT_JEV_MODEL;
  const mode: JevMode = cfg.apiKey ? (cfg.mode ?? 'shadow') : 'off';
  const minConfidence = cfg.minConfidence ?? 0.8;
  let spentUsd = 0;

  return {
    id: 'jev',
    configured: mode !== 'off',
    mode,
    model,
    minConfidence,
    get spentUsd() { return spentUsd; },

    async decide(state, questions) {
      const log = (e: { ok: boolean; costUsd?: number; model?: string; error?: string }) =>
        cfg.onCost?.({ provider: 'jev', kind: 'decision', model, costUsd: 0, ...e });
      // ponytail: 3 attempts with exponential backoff; add jitter/queueing if 429s become common.
      for (let attempt = 0; ; attempt++) {
        let res: Response;
        try {
          res = await fetch(JEV_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
            body: JSON.stringify({ model, state, questions }),
            signal: AbortSignal.timeout(60_000),
          });
        } catch (e) {
          log({ ok: false, error: (e as Error).message });
          throw e;
        }
        if ((res.status === 429 || (res.status >= 500 && res.status <= 504)) && attempt < 2) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        if (!res.ok) {
          const err = new Error(`Jev ${res.status}: ${await res.text()}`);
          log({ ok: false, error: err.message });
          throw err;
        }
        const data = (await res.json()) as { model?: string; answers?: Record<string, JevAnswer>; usage?: { cost?: number } };
        const cost = Number(data.usage?.cost ?? 0);
        spentUsd += cost;
        log({ ok: true, costUsd: cost, model: data.model ?? model });
        return { model: data.model ?? model, answers: data.answers ?? {} };
      }
    },

    async healthCheck(): Promise<HealthReport> {
      if (mode === 'off') return report('jev', 'unconfigured', cfg.apiKey ? 'CONTENT_JEV_MODE=off' : 'no CONTENT_OPENROUTER_API_KEY');
      try {
        const res = await fetch(`https://openrouter.ai/api/v1/models/${model}/endpoints`, {
          headers: { authorization: `Bearer ${cfg.apiKey}` }, signal: AbortSignal.timeout(8_000),
        });
        if (!res.ok) return report('jev', 'error', `OpenRouter has no ${model} (${res.status})`);
        const n = ((await res.json()) as { data?: { endpoints?: unknown[] } }).data?.endpoints?.length ?? 0;
        return n
          ? report('jev', 'ok', `${mode} mode via OpenRouter`, { model, mode, minConfidence })
          : report('jev', 'degraded', `${model} has no live endpoint on OpenRouter`, { model, mode });
      } catch (e) {
        return report('jev', 'error', (e as Error).message);
      }
    },
  };
}
