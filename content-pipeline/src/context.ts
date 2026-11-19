// Builds the runtime: env -> db + adapters + logger, assembled into a ModuleContext.
// One place wires everything; the host app just calls buildContext().
import { loadEnv, type ContentEnv } from './env.ts';
import { createLogger } from './logger.ts';
import { createDb, type Db } from './db/client.ts';
import { readSettings } from './services/settings-service.ts';
import { createClaude } from './adapters/claude.ts';
import { createPostiz } from './adapters/postiz.ts';
import { createJev } from './adapters/jev.ts';
import { createApify } from './adapters/apify.ts';
import { createTinyfish } from './adapters/tinyfish.ts';
import { costRecorder, budgetGuard, gate } from './cost-ledger.ts';
import { createYoutube } from './adapters/youtube.ts';
import { createTranscriber } from './adapters/transcriber.ts';
import type { ModuleContext, Adapters } from './modules/module.ts';

let base: ModuleContext | null = null;
let cached: ModuleContext | null = null;
let savedFingerprint: string | undefined;

export function buildContext(envOverride?: Partial<ContentEnv>): ModuleContext {
  const env = { ...loadEnv(), ...envOverride };
  return assembleContext(env, createDb(env.databaseUrl));
}

function assembleContext(env: ContentEnv, db: Db): ModuleContext {
  const logger = createLogger();
  const onCost = costRecorder(db, logger); // every paid call → content.cost_events
  const guard = budgetGuard(db, env.dailyBudgetUsd, logger); // …and none once today's spend hits the cap
  const adapters: Adapters = {
    claude: gate(createClaude({
      openrouterApiKey: env.openrouterApiKey,
      model: env.llmModel,
      imageModel: env.imageModel,
      onCost,
    }), ['complete', 'generateImage'], guard),
    postiz: createPostiz(env.postizApiUrl, env.postizApiKey),
    jev: gate(createJev({
      apiKey: env.openrouterApiKey,
      model: env.jevModel,
      mode: env.jevMode,
      minConfidence: env.jevMinConfidence,
      onCost,
    }), ['decide'], guard),
    apify: gate(createApify(env.apifyToken, env.apifyActors, onCost), ['scrape'], guard),
    tinyfish: createTinyfish(env.tinyfishApiKey),
    youtube: createYoutube(env.youtubeApiKey),
    transcriber: createTranscriber({ ytdlp: env.ytdlp, python: env.python, model: env.whisperModel, cap: env.transcribeCap }),
  };
  return {
    env,
    logger,
    db,
    adapters,
  };
}

/** Read saved overrides on each entry so every app worker sees changes without a restart.
 * Contexts already in use keep their original credentials until that operation finishes. */
export async function getContext(): Promise<ModuleContext> {
  base ??= buildContext();
  if (!base.env.databaseUrl) return base;
  const { values } = await readSettings(base.db);
  const fingerprint = JSON.stringify(values);
  if (!cached || fingerprint !== savedFingerprint) {
    cached = assembleContext(loadEnv({ ...process.env, ...values }), base.db);
    savedFingerprint = fingerprint;
  }
  return cached;
}
