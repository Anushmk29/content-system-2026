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
import type { ModuleContext, Adapters } from './modules/module.ts';

let cached: ModuleContext | null = null;

export function buildContext(envOverride?: Partial<ContentEnv>): ModuleContext {
  const env = { ...loadEnv(), ...envOverride };
  const adapters: Adapters = {
    claude: createClaude({
      openrouterApiKey: env.openrouterApiKey,
      anthropicApiKey: env.anthropicApiKey,
      model: env.llmModel,
      imageModel: env.imageModel,
    }),
    postiz: createPostiz(env.postizApiUrl, env.postizApiKey),
    jev: createJev({
      apiKey: env.typesafeApiKey,
      model: env.jevModel,
      mode: env.jevMode,
      minConfidence: env.jevMinConfidence,
    }),
    apify: createApify(env.apifyToken, env.apifyActors),
    tinyfish: createTinyfish(env.tinyfishApiKey),
  };
  return {
    env,
    logger: createLogger(),
    db: createDb(env.databaseUrl),
    adapters,
  };
}

/** Cached singleton for the Next.js server runtime. */
export function getContext(): ModuleContext {
  if (!cached) cached = buildContext();
  return cached;
}
