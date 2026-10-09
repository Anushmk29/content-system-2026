// Environment config — CONTENT_* namespace so it never clashes with the host app.
// Never throws at import: missing integration keys just mark that integration
// "unconfigured" so the system degrades gracefully instead of crashing.

export interface ContentEnv {
  databaseUrl: string | undefined;
  openrouterApiKey: string | undefined;
  // Optional OpenRouter management key: lets the Costs page check spend day by day (/api/v1/activity).
  openrouterMgmtKey: string | undefined;
  anthropicApiKey: string | undefined;
  llmModel: string | undefined;
  // TypeSafe Jev decision model (typed classify/score decisions), served through OpenRouter on the
  // same key. CONTENT_JEV_MODE=off turns it off; CONTENT_JEV_MODEL pins another version.
  jevModel: string | undefined;
  jevMode: 'off' | 'shadow' | 'primary' | undefined;
  jevMinConfidence: number | undefined;
  // Tasks Jev decides first even in shadow mode (e.g. "topic_score,qc_signals"), switched on one at a
  // time once the Training page shows Jev agrees with the LLM often enough.
  jevPrimaryTasks: string[];
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
  // YouTube in Decode: free Data API v3 key (console.cloud.google.com → YouTube Data API v3).
  youtubeApiKey: string | undefined;
  // Local transcription of competitor videos (yt-dlp + faster-whisper on this host).
  ytdlp: string | undefined;
  python: string | undefined;
  whisperModel: string | undefined;
  transcribeCap: number;
  // Hour (UTC, 0-23) each platform's daily post goes out. Default 4 = 09:30 IST.
  postHourUtc: number;
  // Auto-select up to N high-band topics per run for drafting. 0 = off (you pick in the dashboard).
  autoSelectTopics: number;
  // CONTENT_PLATFORM_FIT=1: Jev picks which platforms each scored idea suits; drafting follows
  // its picks unless the operator chose platforms on the idea card. Off = the default five.
  platformFit: boolean;
  // CONTENT_REVISE_ON_CHANGES=1: "Request changes" rewrites the post with the feedback right away.
  // Off = the post goes back to draft for a hand edit (the original behaviour).
  reviseOnChanges: boolean;
  // CONTENT_POSTIZ_SYNC=1: planning or moving a post on the Content Calendar books (or moves) it
  // in Postiz right away. Off = Postiz gets it on the next publish run (the original behaviour).
  postizSync: boolean;
  // CONTENT_HUMANIZE_REWRITE (on unless set to 0): QC rewrites a draft once when it scores under
  // 70 on the human check (humanizer.ts), before anyone reviews it. One extra LLM call per such draft.
  humanizeRewrite: boolean;
  // default campaign used in UTM builder when a content item has none
  defaultUtmCampaign: string;
}

function read(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

export function loadEnv(): ContentEnv {
  return {
    databaseUrl: read('CONTENT_DATABASE_URL'),
    openrouterApiKey: read('CONTENT_OPENROUTER_API_KEY'),
    openrouterMgmtKey: read('CONTENT_OPENROUTER_MGMT_KEY'),
    anthropicApiKey: read('CONTENT_ANTHROPIC_API_KEY'),
    llmModel: read('CONTENT_LLM_MODEL'),
    jevModel: read('CONTENT_JEV_MODEL'),
    jevMode: jevMode(read('CONTENT_JEV_MODE')),
    jevPrimaryTasks: (read('CONTENT_JEV_PRIMARY_TASKS') ?? '').split(',').map((t) => t.trim()).filter(Boolean),
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
    youtubeApiKey: read('CONTENT_YOUTUBE_API_KEY'),
    ytdlp: read('CONTENT_YTDLP'),
    python: read('CONTENT_PYTHON'),
    whisperModel: read('CONTENT_WHISPER_MODEL'),
    transcribeCap: clampInt(read('CONTENT_TRANSCRIBE_CAP'), 15, 0, 200),
    postHourUtc: clampInt(read('CONTENT_POST_HOUR_UTC'), 4, 0, 23),
    autoSelectTopics: clampInt(read('CONTENT_AUTO_SELECT_TOPICS'), 0, 0, 10),
    platformFit: /^(1|true|on|yes)$/i.test(read('CONTENT_PLATFORM_FIT') ?? ''),
    reviseOnChanges: /^(1|true|on|yes)$/i.test(read('CONTENT_REVISE_ON_CHANGES') ?? ''),
    postizSync: /^(1|true|on|yes)$/i.test(read('CONTENT_POSTIZ_SYNC') ?? ''),
    humanizeRewrite: !/^(0|false|off|no)$/i.test(read('CONTENT_HUMANIZE_REWRITE') ?? ''),
    defaultUtmCampaign: read('CONTENT_DEFAULT_UTM_CAMPAIGN') ?? 'content_pipeline',
  };
}

function jevMode(v: string | undefined): ContentEnv['jevMode'] {
  return v === 'off' || v === 'shadow' || v === 'primary' ? v : undefined;
}

function clampInt(v: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isNaN(n) ? fallback : Math.min(max, Math.max(min, n));
}
