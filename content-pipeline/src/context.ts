// Builds the runtime: env -> db + adapters + logger, assembled into a ModuleContext.
// One place wires everything; the host app just calls buildContext().
import { loadEnv, type ContentEnv } from './env.ts';
import { createLogger } from './logger.ts';
import { createDb } from './db/client.ts';
import { createClaude } from './adapters/claude.ts';
import { createPostiz } from './adapters/postiz.ts';
import { createJev } from './adapters/jev.ts';
import { createApify } from './adapters/apify.ts';
import { createTinyfish } from './adapters/tinyfish.ts';
import { costRecorder, budgetGuard, gate } from './cost-ledger.ts';
import { createYoutube } from './adapters/youtube.ts';
import { createTranscriber } from './adapters/transcriber.ts';
import type { ModuleContext, Adapters } from './modules/module.ts';

let cached: ModuleContext | null = null;

export function buildContext(envOverride?: Partial<ContentEnv>): ModuleContext {
  const env = { ...loadEnv(), ...envOverride };
  const logger = createLogger();
  const db = createDb(env.databaseUrl);
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

/** Cached singleton for the Next.js server runtime. */
export function getContext(): ModuleContext {
  if (!cached) cached = buildContext();
  return cached;
}
