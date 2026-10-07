// Environment config — CONTENT_* namespace so it never clashes with the host app.
// Never throws at import: missing integration keys just mark that integration
// "unconfigured" so the system degrades gracefully instead of crashing.

export interface ContentEnv {
  databaseUrl: string | undefined;
  openrouterApiKey: string | undefined;
  anthropicApiKey: string | undefined;
  llmModel: string | undefined;
  // OpenRouter image model for creatives (default google/gemini-2.5-flash-image).
  imageModel: string | undefined;
  // OpenRouter model for the typed decisions (topic score, QC); defaults to llmModel.
  decisionModel: string | undefined;
  // TypeSafe Jev decision model (typed classify/score decisions). Off without a key.
  typesafeApiKey: string | undefined;
  jevModel: string | undefined;
  jevMode: 'off' | 'shadow' | 'primary' | undefined;
  jevMinConfidence: number | undefined;
  // Market signals: public RSS/Atom feeds ("competitor=url" or bare url) and Reddit search terms.
  marketFeeds: string | undefined;
  redditQueries: string | undefined;
  // X (Twitter) official API v2 recent search: comma-separated queries + an app bearer token.
  xQueries: string | undefined;
  xBearerToken: string | undefined;
  // Live web check in Research: an OpenRouter model (default perplexity/sonar), "tinyfish"
  // (free TinyFish Search + Fetch, then our own LLM), or "off".
  researchModel: string | undefined;
  // TinyFish (free web Search + Fetch): key, news-search queries and competitor pages to watch.
  tinyfishApiKey: string | undefined;
  tinyfishQueries: string | undefined;
  tinyfishWatch: string | undefined;
  postizApiUrl: string | undefined;
  postizApiKey: string | undefined;
  // Decode (competitor spy): Apify token + optional actor-id overrides per platform.
  apifyToken: string | undefined;
  apifyActors: Partial<Record<'x' | 'instagram' | 'linkedin' | 'facebook', string>>;
  // Hour (UTC, 0-23) each platform's daily post goes out. Default 4 = 09:30 IST.
  postHourUtc: number;
  // Auto-select up to N high-band topics per run for drafting. 0 = off (you pick in the dashboard).
  autoSelectTopics: number;
  // default campaign used in UTM builder when a content item has none
  defaultUtmCampaign: string;
  // earn auto-publishing for proven, template-based content (Bible §17 phase 6). Off by default.
  allowSafeAuto: boolean;
  // optional shared secret guarding the run endpoints before exposing them to a scheduler.
  runSecret: string | undefined;
}

function read(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

export function loadEnv(): ContentEnv {
  return {
    databaseUrl: read('CONTENT_DATABASE_URL'),
    openrouterApiKey: read('CONTENT_OPENROUTER_API_KEY'),
    anthropicApiKey: read('CONTENT_ANTHROPIC_API_KEY'),
    llmModel: read('CONTENT_LLM_MODEL'),
    imageModel: read('CONTENT_IMAGE_MODEL'),
    decisionModel: read('CONTENT_DECISION_MODEL'),
    typesafeApiKey: read('CONTENT_TYPESAFE_API_KEY'),
    jevModel: read('CONTENT_JEV_MODEL'),
    jevMode: jevMode(read('CONTENT_JEV_MODE')),
    jevMinConfidence: read('CONTENT_JEV_MIN_CONFIDENCE') ? Number(read('CONTENT_JEV_MIN_CONFIDENCE')) : undefined,
    marketFeeds: read('CONTENT_MARKET_FEEDS'),
    redditQueries: read('CONTENT_REDDIT_QUERIES'),
    xQueries: read('CONTENT_X_QUERIES'),
    xBearerToken: read('CONTENT_X_BEARER_TOKEN'),
    researchModel: read('CONTENT_RESEARCH_MODEL'),
    postizApiUrl: read('CONTENT_POSTIZ_API_URL'),
    postizApiKey: read('CONTENT_POSTIZ_API_KEY'),
    tinyfishApiKey: read('CONTENT_TINYFISH_API_KEY'),
    tinyfishQueries: read('CONTENT_TINYFISH_QUERIES'),
    tinyfishWatch: read('CONTENT_TINYFISH_WATCH'),
    apifyToken: read('CONTENT_APIFY_TOKEN'),
    apifyActors: Object.fromEntries((['x', 'instagram', 'linkedin', 'facebook'] as const)
      .map((p) => [p, read(`CONTENT_APIFY_ACTOR_${p.toUpperCase()}`)]).filter(([, v]) => v)),
    postHourUtc: clampInt(read('CONTENT_POST_HOUR_UTC'), 4, 0, 23),
    autoSelectTopics: clampInt(read('CONTENT_AUTO_SELECT_TOPICS'), 0, 0, 10),
    defaultUtmCampaign: read('CONTENT_DEFAULT_UTM_CAMPAIGN') ?? 'content_pipeline',
    allowSafeAuto: (read('CONTENT_ALLOW_SAFE_AUTO') ?? '').toLowerCase() === 'true',
    runSecret: read('CONTENT_RUN_SECRET'),
  };
}

function jevMode(v: string | undefined): ContentEnv['jevMode'] {
  return v === 'off' || v === 'shadow' || v === 'primary' ? v : undefined;
}

function clampInt(v: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isNaN(n) ? fallback : Math.min(max, Math.max(min, n));
}
