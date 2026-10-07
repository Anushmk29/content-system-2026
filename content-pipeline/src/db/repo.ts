// Typed data access over the `content` schema. Thin, explicit SQL — no ORM.
// Content item status/approval writes are NOT here: they go through content-items.ts.
import type { Db } from './client.ts';
import { APPROVED_STATUSES } from '../../core/src/index.ts';

export interface ContentItemRow {
  id: string;
  anchor_id: string | null;
  offer_idx?: number | null;
  hook_ref?: string | null;
  topic_id?: string | null;
  title: string;
  pillar?: string;
  funnel_stage?: string;
  hook?: string | null;
  owner?: string | null;
  published_at?: string | null;
  updated_at?: string;
  platform: string;
  format: string;
  status: string;
  risk_level: string | null;
  approval_lane: string | null;
  approval_status: string;
  body: string | null;
  cta: string | null;
  published_url: string | null;
  utm_url: string | null;
  postiz_id: string | null;
  scheduled_at: string | null;
  created_at: string;
}

export interface ClaimRow {
  id: string;
  content_item_id: string;
  claim_text: string;
  proof_url: string | null;
}

export interface TodoRow {
  id: string;
  title: string;
  detail: string | null;
  status: string;
  priority: number;
  content_item_id: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface ModuleHealthRow {
  module_id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  items_processed: number;
  message: string | null;
  error: string | null;
}

export interface TopicRow {
  id: string;
  title: string;
  pillar: string | null;
  funnel_stage: string | null;
  source: string | null;
  source_detail: string | null;
  customer_language: string | null;
  market_context: string | null;
  priority_band: string;
  score_total: number;
  status: string;
  score_lead_intent?: number | null;
  score_reach?: number | null;
  score_brand_fit?: number | null;
  score_proof?: number | null;
  score_repurpose?: number | null;
  created_at?: string;
}

/** One piece of a draft set (see content-items.ts createDraftSet). */
export interface NewContentItem {
  title: string;
  pillar: string;
  funnelStage: string;
  platform: string;
  format: string;
  hook?: string | null;
  cta?: string | null;
  body?: string | null;
  sourceMaterial?: string | null;
  riskLevel?: string | null;
  owner?: string | null;
  offerIdx?: number | null;
  hookRef?: string | null;
}

export interface ResearchInputRow {
  id: string;
  channel: string | null;
  raw_text: string;
  source_url: string | null;
  status: string;
}

export interface PerformanceRow {
  id: string;
  title: string;
  platform: string;
  pillar: string;
  funnel_stage: string;
  status: string;
  impressions: number | null;
  reach: number | null;
  comments: number | null;
  qualified_engagement: number | null;
  shares?: number | null;
  likes?: number | null;
  /** likes + comments + shares */
  engagement?: number | null;
  /** likes over this platform's own median reactions; null until own results exist */
  vs_usual?: number | null;
  published_at?: string | null;
  /** Stored by Analytics when the item is captured (Bible Table 30). */
  performance_signal?: string | null;
}

export function createRepo(db: Db) {
  return {
    // --- research inputs ---------------------------------------------------
    unprocessedResearchInputs: () =>
      db.query<ResearchInputRow>(
        `select id, channel, raw_text, source_url, status
           from content.research_inputs where status = 'new' order by created_at`,
      ).then((r) => r.rows),

    /** Operator adds a raw signal from the dashboard; Research module turns it into a topic. */
    insertResearchInput: (r: { channel?: string | null; rawText: string; sourceUrl?: string | null }) =>
      db.query<ResearchInputRow>(
        `insert into content.research_inputs (channel, raw_text, source_url, status)
         values ($1,$2,$3,'new') returning id, channel, raw_text, source_url, status`,
        [r.channel ?? null, r.rawText, r.sourceUrl ?? null],
      ).then((res) => res.rows[0]!),

    /** Automatic capture: skips a URL already captured, so re-runs never duplicate. Returns true if inserted. */
    insertResearchInputIfNew: (r: { channel: string; rawText: string; sourceUrl: string }) =>
      db.query(
        `insert into content.research_inputs (channel, raw_text, source_url, status)
         select $1,$2,$3,'new' where not exists (select 1 from content.research_inputs where source_url = $3)`,
        [r.channel, r.rawText, r.sourceUrl],
      ).then((res) => (res.rowCount ?? 0) > 0),

    markResearchProcessed: (id: string, topicId: string) =>
      db.query(
        `update content.research_inputs set status = 'processed', topic_id = $2, processed_at = now() where id = $1`,
        [id, topicId],
      ),

    insertTopic: (t: {
      title: string; pillar?: string | null; funnelStage?: string | null;
      source?: string | null; sourceDetail?: string | null; customerLanguage?: string | null;
      marketContext?: string | null; status?: string;
    }) =>
      db.query<{ id: string }>(
        `insert into content.topics (title, pillar, funnel_stage, source, source_detail, customer_language, market_context, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
        [t.title, t.pillar ?? null, t.funnelStage ?? null, t.source ?? null,
         t.sourceDetail ?? null, t.customerLanguage ?? null, t.marketContext ?? null, t.status ?? 'new'],
      ).then((r) => r.rows[0]!.id),

    // --- topics ------------------------------------------------------------
    /** New topics that have not been scored yet (no factor scores set). */
    unscoredTopics: () =>
      db.query<TopicRow>(
        `select id, title, pillar, funnel_stage, source, source_detail, customer_language, market_context,
                priority_band, score_total, status
           from content.topics
          where status = 'new' and score_lead_intent is null
          order by created_at`,
      ).then((r) => r.rows),

    setTopicScores: (id: string, s: {
      leadIntent: number; reach: number; brandFit: number; proof: number; repurpose: number;
      pillar?: string | null; funnelStage?: string | null;
    }) =>
      db.query(
        `update content.topics set
           score_lead_intent = $2, score_reach = $3, score_brand_fit = $4,
           score_proof = $5, score_repurpose = $6,
           pillar = coalesce($7, pillar), funnel_stage = coalesce($8, funnel_stage)
         where id = $1`,
        [id, s.leadIntent, s.reach, s.brandFit, s.proof, s.repurpose, s.pillar ?? null, s.funnelStage ?? null],
      ),

    /** Scored topics awaiting the operator's select/drop decision (status still 'new'). */
    reviewableTopics: () =>
      db.query<TopicRow>(
        `select id, title, pillar, funnel_stage, source, source_detail, customer_language, market_context,
                priority_band, score_total, status, created_at,
                score_lead_intent, score_reach, score_brand_fit, score_proof, score_repurpose
           from content.topics
          where status = 'new' and score_lead_intent is not null
          order by score_total desc, created_at`,
      ).then((r) => r.rows),

    /** Topics the operator has marked ready to draft (status = 'selected'). */
    selectedTopics: () =>
      db.query<TopicRow>(
        `select id, title, pillar, funnel_stage, source, source_detail, customer_language, market_context,
                priority_band, score_total, status
           from content.topics where status = 'selected'
          order by score_total desc, created_at`,
      ).then((r) => r.rows),

    /** Opt-in autopilot: move the best N unreviewed high-band topics to 'selected'. */
    autoSelectTopics: (n: number) =>
      db.query<{ id: string }>(
        `update content.topics set status = 'selected', auto_selected = true
          where id in (select id from content.topics
                        where status = 'new' and priority_band = 'high'
                        order by score_total desc, created_at limit $1)
          returning id`,
        [n],
      ).then((r) => r.rowCount ?? 0),

    /** Operator's select/drop. A topic already drafted ('used') can't be re-selected. Returns false if refused. */
    decideTopic: (id: string, status: 'selected' | 'dropped') =>
      db.query(`update content.topics set status = $2 where id = $1 and status <> 'used'`, [id, status])
        .then((r) => r.rowCount > 0),

    /** Open topic queue by band (what v_topic_queue lists). */
    topicBandCounts: () =>
      db.query<{ priority_band: string; n: string }>(
        `select priority_band, count(*)::text as n from content.v_topic_queue group by priority_band`,
      ).then((r) => Object.fromEntries(r.rows.map((x) => [x.priority_band, Number(x.n)])) as Record<string, number>),

    // --- content items -----------------------------------------------------
    itemsByStatus: (status: string) =>
      db.query<ContentItemRow>(
        `select * from content.content_items where status = $1 order by created_at`, [status],
      ).then((r) => r.rows),

    getItem: (id: string) =>
      db.query<ContentItemRow>(
        `select * from content.content_items where id = $1`, [id],
      ).then((r) => r.rows[0] ?? null),

    publishReady: () =>
      db.query<ContentItemRow>(`select * from content.v_publish_ready`).then((r) => r.rows),

    claimsFor: (contentItemId: string) =>
      db.query<ClaimRow>(
        `select * from content.claims where content_item_id = $1`, [contentItemId],
      ).then((r) => r.rows),

    /** Latest slot already booked per platform, so the publisher keeps one post per platform per day. */
    lastScheduledByPlatform: () =>
      db.query<{ platform: string; at: string }>(
        `select platform, max(scheduled_at)::text as at from content.content_items
          where postiz_id is not null and scheduled_at is not null group by platform`,
      ).then((r) => new Map(r.rows.map((x) => [x.platform, new Date(x.at)]))),

    // --- pipeline board ----------------------------------------------------
    statusCounts: () =>
      db.query<{ status: string; n: string }>(
        `select status, count(*)::text as n from content.content_items group by status`,
      ).then((r) => r.rows.map((x) => ({ status: x.status, count: Number(x.n) }))),

    recentItems: (limit = 25) =>
      db.query<ContentItemRow>(
        `select * from content.content_items order by created_at desc limit $1`, [limit],
      ).then((r) => r.rows),

    // --- module runs ---------------------------------------------------------
    recordRun: (r: {
      moduleId: string; status: string; startedAt: string; finishedAt: string; durationMs: number;
      itemsProcessed: number; message: string; error?: string | null; meta?: Record<string, unknown> | null;
    }) =>
      db.query(
        `insert into content.module_runs
           (module_id, status, started_at, finished_at, duration_ms, items_processed, message, error, meta)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [r.moduleId, r.status, r.startedAt, r.finishedAt, r.durationMs, r.itemsProcessed, r.message,
         r.error ?? null, r.meta ? JSON.stringify(r.meta) : null],
      ),

    /** When a module last did real work (status ok, items > 0) within `days`, else null. */
    lastProductiveRun: (moduleId: string, days: number) =>
      db.query<{ at: string | null }>(
        `select max(started_at)::text as at from content.module_runs
          where module_id = $1 and status = 'ok' and items_processed > 0
            and started_at > now() - make_interval(days => $2)`,
        [moduleId, days],
      ).then((r) => r.rows[0]?.at ?? null),

    moduleHealth: () =>
      db.query<ModuleHealthRow>(`select * from content.v_module_health order by module_id`)
        .then((r) => r.rows),

    // --- todos -------------------------------------------------------------
    listTodos: (status?: string) =>
      db.query<TodoRow>(
        status
          ? `select * from content.todos where status = $1 order by priority, created_at desc`
          : `select * from content.todos order by status, priority, created_at desc`,
        status ? [status] : [],
      ).then((r) => r.rows),

    createTodo: (t: { title: string; detail?: string; priority?: number; contentItemId?: string; dueDate?: string }) =>
      db.query<TodoRow>(
        `insert into content.todos (title, detail, priority, content_item_id, due_date)
         values ($1,$2,$3,$4,$5) returning *`,
        [t.title, t.detail ?? null, t.priority ?? 3, t.contentItemId ?? null, t.dueDate ?? null],
      ).then((r) => r.rows[0]!),

    updateTodo: (id: string, patch: { title?: string; detail?: string; status?: string; priority?: number }) =>
      db.query<TodoRow>(
        `update content.todos set
           title    = coalesce($2, title),
           detail   = coalesce($3, detail),
           status   = coalesce($4, status),
           priority = coalesce($5, priority)
         where id = $1 returning *`,
        [id, patch.title ?? null, patch.detail ?? null, patch.status ?? null, patch.priority ?? null],
      ).then((r) => r.rows[0] ?? null),

    deleteTodo: (id: string) =>
      db.query(`delete from content.todos where id = $1`, [id]),

    // --- metrics + performance (Bible §14) ---------------------------------
    insertMetrics: (m: {
      contentItemId: string; impressions?: number | null; reach?: number | null;
      likes?: number | null; comments?: number | null; shares?: number | null;
      saves?: number | null; clicks?: number | null; qualifiedEngagement?: number | null;
      raw?: unknown;
    }) =>
      db.query(
        `insert into content.metrics
           (content_item_id, impressions, reach, likes, comments, shares, saves, clicks, qualified_engagement, raw)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [m.contentItemId, m.impressions ?? null, m.reach ?? null, m.likes ?? null,
         m.comments ?? null, m.shares ?? null, m.saves ?? null, m.clicks ?? null,
         m.qualifiedEngagement ?? null, m.raw === undefined ? null : JSON.stringify(m.raw)],
      ),

    /** Live posts from the last `days` whose numbers are older than `staleHours` (never-pulled
     *  first) — the auto collector's work list, capped to fit Postiz's 30 calls/hour. */
    postsDueForStats: (days: number, staleHours: number, limit: number) =>
      db.query<{ id: string; postiz_id: string; qualified_engagement: number | null }>(
        `select ci.id, ci.postiz_id, m.qualified_engagement
           from content.content_items ci
           left join lateral (select captured_at, qualified_engagement from content.metrics mm
                               where mm.content_item_id = ci.id order by captured_at desc limit 1) m on true
          where ci.status in ('published','performance_captured') and ci.postiz_id is not null
            and ci.published_at > now() - make_interval(days => $1)
            and (m.captured_at is null or m.captured_at < now() - make_interval(hours => $2))
          order by m.captured_at asc nulls first limit $3`, [days, staleHours, limit],
      ).then((r) => r.rows),

    /** Published items a week old with real numbers, not yet marked captured. Waiting a week
     *  keeps an early pull (a few hours in) from fixing the signal on half-grown numbers. */
    publishedWithMetrics: () =>
      db.query<PerformanceRow>(
        `select * from content.v_content_performance
          where status = 'published' and published_at < now() - interval '7 days'
            and coalesce(impressions, reach, likes, comments) is not null`,
      ).then((r) => r.rows),

    /** The full performance roll-up — the weekly review reads this. */
    performance: () =>
      db.query<PerformanceRow>(`select * from content.v_content_performance`).then((r) => r.rows),

    pillarUsage: () =>
      db.query<{ pillar: string; n: string }>(
        `select pillar, count(*)::text as n from content.content_items
          where status::text = any($1::text[]) group by pillar`, [APPROVED_STATUSES],
      ).then((r) => r.rows.map((x) => ({ pillar: x.pillar, count: Number(x.n) }))),

    // --- dashboard reads (today / board / calendar / analytics) --------------
    /** Newest items first; services group them by anchor into one card per idea.
     *  ponytail: in-memory grouping, page it in SQL once there are thousands of items. */
    allItems: (limit = 500) =>
      db.query<ContentItemRow>(
        `select * from content.content_items order by created_at desc limit $1`, [limit],
      ).then((r) => r.rows),

    /** An anchor and every platform copy repurposed from it. */
    ideaPieces: (anchorId: string) =>
      db.query<ContentItemRow>(
        `select * from content.content_items where coalesce(anchor_id, id) = $1
          order by (anchor_id is null) desc, created_at`, [anchorId],
      ).then((r) => r.rows),

    approvalsFor: (itemId: string) =>
      db.query<ApprovalLogRow>(
        `select decision::text, lane::text, decided_by, note, coalesce(decided_at, created_at)::text as at
           from content.approvals where content_item_id = $1 order by created_at`, [itemId],
      ).then((r) => r.rows),

    performanceFor: (itemId: string) =>
      db.query<PerformanceRow>(`select * from content.v_content_performance where id = $1`, [itemId])
        .then((r) => r.rows[0] ?? null),

    /** Copy edits are only allowed before sign-off; returns null if the item is past approval. */
    updateItemCopy: (id: string, p: { hook?: string | null; body?: string | null; cta?: string | null }) =>
      db.query<ContentItemRow>(
        `update content.content_items set
           hook = coalesce($2, hook), body = coalesce($3, body), cta = coalesce($4, cta)
          where id = $1 and status in ('idea','draft','qc_passed','needs_approval')
          returning *`,
        [id, p.hook ?? null, p.body ?? null, p.cta ?? null],
      ).then((r) => r.rows[0] ?? null),

    /** Operator picks a posting time; only while approved and not yet handed to Postiz. */
    planItem: (id: string, at: string) =>
      db.query(
        `update content.content_items set scheduled_at = $2
          where id = $1 and status = 'approved' and postiz_id is null`, [id, at],
      ).then((r) => r.rowCount > 0),

    publishedSince: (since: string) =>
      db.query<{ n: number }>(
        `select count(*)::int as n from content.content_items where published_at >= $1`, [since],
      ).then((r) => r.rows[0]?.n ?? 0),

    /** Median days from item creation to going live, over the last 90 days (null if none). */
    cycleMedianDays: () =>
      db.query<{ d: number | null }>(
        `select percentile_cont(0.5) within group
                  (order by extract(epoch from (published_at - created_at)) / 86400)::float8 as d
           from content.content_items
          where published_at is not null and published_at > now() - interval '90 days'`,
      ).then((r) => (r.rows[0]?.d == null ? null : Number(r.rows[0].d))),

    /** Signed-off ideas per pillar in the last `days`, one count per anchor (not per platform copy). */
    liveMix: (days: number) =>
      db.query<{ pillar: string; n: number }>(
        `select pillar::text, count(distinct coalesce(anchor_id, id))::int as n
           from content.content_items
          where status::text = any($1::text[])
            and coalesce(published_at, scheduled_at, updated_at) > now() - make_interval(days => $2)
          group by pillar`, [APPROVED_STATUSES, days],
      ).then((r) => r.rows.map((x) => ({ pillar: x.pillar, count: Number(x.n) }))),

    /** Published / reach / engagement per bucket, oldest first, zero-filled. */
    series: (bucket: 'day' | 'week', count: number) =>
      db.query<SeriesRow>(
        `with b as (
           select generate_series(date_trunc($1, now()) - ($2 - 1) * ('1 ' || $1)::interval,
                                  date_trunc($1, now()), ('1 ' || $1)::interval) as t)
         select b.t::text as at,
           (select count(*) from content.content_items ci
             where ci.published_at >= b.t and ci.published_at < b.t + ('1 ' || $1)::interval)::int as published,
           (select coalesce(sum(coalesce(p.reach, p.impressions)), 0) from content.v_content_performance p
             where p.published_at >= b.t and p.published_at < b.t + ('1 ' || $1)::interval)::int as reach,
           (select coalesce(sum(p.engagement), 0) from content.v_content_performance p
             where p.published_at >= b.t and p.published_at < b.t + ('1 ' || $1)::interval)::int as engagement
         from b order by b.t`, [bucket, count],
      ).then((r) => r.rows),

    performanceSince: (days: number) =>
      db.query<PerformanceRow & { published_at: string | null; clicks: number | null }>(
        `select * from content.v_content_performance
          where status in ('published','performance_captured')
            and published_at > now() - make_interval(days => $1)
          order by published_at desc`, [days],
      ).then((r) => r.rows),

    /** Approvals and module runs merged into one newest-first feed. */
    activity: (limit = 30) =>
      db.query<ActivityRow>(
        `select * from (
           select 'approval' as kind, a.created_at::text as at, a.decision::text as status,
                  ci.title as title, a.note as detail, a.content_item_id::text as item_id, a.decided_by as actor
             from content.approvals a join content.content_items ci on ci.id = a.content_item_id
           union all
           select 'run', r.started_at::text, r.status::text, r.module_id, r.message, null, null
             from content.module_runs r
         ) x order by at desc limit $1`, [limit],
      ).then((r) => r.rows),

    recentRuns: (limit = 60) =>
      db.query<ModuleHealthRow>(
        `select module_id, status::text, started_at::text, finished_at::text, duration_ms,
                items_processed, message, error
           from content.module_runs order by started_at desc limit $1`, [limit],
      ).then((r) => r.rows),

    // --- decisions (training-data log) -------------------------------------
    logDecision: (d: {
      task: string; subjectId: string; state: string | null; source: string; model: string | null;
      answer: unknown; used: boolean; latencyMs?: number; confidence?: number; workspace?: string; seed?: boolean;
    }) =>
      db.query(
        `insert into content.decisions
           (workspace, task, subject_id, state, source, model, answer, used, latency_ms, confidence, seed)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [d.workspace ?? 'default', d.task, d.subjectId, d.state, d.source, d.model,
         JSON.stringify(d.answer), d.used, d.latencyMs ?? null, d.confidence ?? null, d.seed ?? false],
      ),

    /** One row per topic/item that went through decide(): input text, every model's
     *  latest answer, the operator's own labels, and real-world outcome. */
    datasetRows: (workspace = 'default') =>
      db.query<DatasetRow>(
        `with latest as (
           select distinct on (task, subject_id, source) task, subject_id, source, state, answer, seed
             from content.decisions where workspace = $1
            order by task, subject_id, source, created_at desc)
         select s.task, s.subject_id,
                (select bool_or(l.seed) from latest l where l.task = s.task and l.subject_id = s.subject_id) as seed,
                (select l.state  from latest l where l.task = s.task and l.subject_id = s.subject_id and l.state is not null limit 1) as state,
                (select l.answer from latest l where l.task = s.task and l.subject_id = s.subject_id and l.source in ('claude','rules') limit 1) as teacher,
                (select l.answer from latest l where l.task = s.task and l.subject_id = s.subject_id and l.source = 'jev') as jev,
                (select l.answer from latest l where l.task = s.task and l.subject_id = s.subject_id and l.source = 'human') as human,
                t.status as topic_status, t.auto_selected as topic_auto_selected,
                (select jsonb_agg(a.decision) from content.approvals a
                   join content.content_items ci on ci.id = a.content_item_id
                  where (ci.topic_id = s.subject_id or ci.id = s.subject_id) and a.decided_at is not null) as approvals,
                (select jsonb_build_object(
                          'reach', sum(coalesce(p.reach, p.impressions)),
                          'qualified_engagement', sum(p.qualified_engagement))
                   from content.v_content_performance p
                   join content.content_items ci on ci.id = p.id
                  where ci.topic_id = s.subject_id and p.impressions is not null
                 having count(*) > 0) as outcome
           from (select distinct task, subject_id from latest) s
           left join content.topics t on s.task = 'topic_score' and t.id = s.subject_id`,
        [workspace],
      ).then((r) => r.rows),
  };
}

export interface ApprovalLogRow {
  decision: string;
  lane: string;
  decided_by: string | null;
  note: string | null;
  at: string;
}

export interface SeriesRow {
  at: string;
  published: number;
  reach: number;
  engagement: number;
}

export interface ActivityRow {
  kind: 'approval' | 'run';
  at: string;
  status: string;
  title: string;
  detail: string | null;
  item_id: string | null;
  actor: string | null;
}

export interface DatasetRow {
  task: string;
  subject_id: string;
  seed: boolean | null;
  state: string | null;
  teacher: Record<string, unknown> | null;
  jev: Record<string, unknown> | null;
  human: Record<string, unknown> | null;
  topic_status: string | null;
  /** Picked by CONTENT_AUTO_SELECT_TOPICS, not by you — so it is not a preference label. */
  topic_auto_selected?: boolean | null;
  approvals: string[] | null;
  outcome: {
    reach: number | null; qualified_engagement: number | null;
  } | null;
}

export type Repo = ReturnType<typeof createRepo>;
