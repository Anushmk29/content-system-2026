-- ============================================================================
-- PRATAP AI — Content Pipeline : Database Schema
-- Source of truth (Bible §16.3). Postgres / Supabase.
--
-- ISOLATION: every object lives in a dedicated `content` schema so it can NEVER
-- collide with tables in your existing codebase. Nothing is created in `public`.
-- Run:  psql "$CONTENT_DATABASE_URL" -f db/schema.sql
-- ============================================================================

create extension if not exists "pgcrypto";        -- gen_random_uuid()
create schema if not exists content;

set search_path to content, public;

-- ---------------------------------------------------------------------------
-- Controlled vocabularies (Bible §5, §4.3, §11, §10, §9)
-- ---------------------------------------------------------------------------
-- Pillars are plain text slugs, defined per brand in content.brand_kit.pillars.

do $$ begin
  create type content.funnel_stage as enum (
    'awareness','education','trust','consideration','conversion','retention'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type content.platform as enum (
    'blog','linkedin','x','instagram','facebook','reddit','email','youtube'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type content.content_format as enum (
    'article','founder_post','thread','carousel','reel_script','short_script',
    'quote_card','stat_graphic','newsletter','reddit_answer','video'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type content.content_status as enum (
    'idea','draft','qc_passed','needs_approval','approved',
    'queued','published','performance_captured','archived'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type content.risk_level as enum ('low','medium','high');
exception when duplicate_object then null; end $$;

do $$ begin
  create type content.approval_lane as enum ('safe_auto','review','sensitive');
exception when duplicate_object then null; end $$;

do $$ begin
  create type content.approval_status as enum (
    'not_required','pending','approved','rejected','changes_requested'
  );
exception when duplicate_object then null; end $$;

-- module run outcome (health / status visibility)
do $$ begin
  create type content.run_status as enum ('ok','degraded','error','skipped','running');
exception when duplicate_object then null; end $$;

-- todo tracker
do $$ begin
  create type content.todo_status as enum ('open','in_progress','done','archived');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- updated_at trigger helper
-- ---------------------------------------------------------------------------
create or replace function content.set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

-- ===========================================================================
-- TOPICS  — research/scoring queue (Bible §6, §7)
-- ===========================================================================
create table if not exists content.topics (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  pillar          text,
  funnel_stage    content.funnel_stage,
  source          text,
  source_detail   text,
  customer_language text,
  score_lead_intent smallint check (score_lead_intent between 1 and 5),
  score_reach       smallint check (score_reach       between 1 and 5),
  score_brand_fit   smallint check (score_brand_fit   between 1 and 5),
  score_proof       smallint check (score_proof       between 1 and 5),
  score_repurpose   smallint check (score_repurpose   between 1 and 5),
  score_total smallint generated always as (
    coalesce(score_lead_intent,0)+coalesce(score_reach,0)+coalesce(score_brand_fit,0)
    +coalesce(score_proof,0)+coalesce(score_repurpose,0)
  ) stored,
  priority_band text generated always as (
    case
      when (coalesce(score_lead_intent,0)+coalesce(score_reach,0)+coalesce(score_brand_fit,0)
            +coalesce(score_proof,0)+coalesce(score_repurpose,0)) >= 20 then 'high'
      when (coalesce(score_lead_intent,0)+coalesce(score_reach,0)+coalesce(score_brand_fit,0)
            +coalesce(score_proof,0)+coalesce(score_repurpose,0)) >= 15 then 'queue'
      when (coalesce(score_lead_intent,0)+coalesce(score_reach,0)+coalesce(score_brand_fit,0)
            +coalesce(score_proof,0)+coalesce(score_repurpose,0)) >= 10 then 'if_timely'
      else 'drop'
    end
  ) stored,
  status      text not null default 'new',  -- new|selected|used|dropped
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
drop trigger if exists trg_topics_updated on content.topics;
create trigger trg_topics_updated before update on content.topics
  for each row execute function content.set_updated_at();
create index if not exists idx_topics_band   on content.topics(priority_band);
create index if not exists idx_topics_status on content.topics(status);

-- ===========================================================================
-- CONTENT_ITEMS  — calendar row + every platform asset (Bible §16.3, §8.2)
-- ===========================================================================
create table if not exists content.content_items (
  id              uuid primary key default gen_random_uuid(),
  topic_id        uuid references content.topics(id) on delete set null,
  anchor_id       uuid references content.content_items(id) on delete cascade,
  title           text not null,
  pillar          text                 not null,
  funnel_stage    content.funnel_stage not null,
  platform        content.platform     not null,
  format          content.content_format not null,
  hook            text,
  cta             text,
  body            text,
  source_material text,
  status          content.content_status  not null default 'idea',
  risk_level      content.risk_level,
  approval_lane   content.approval_lane,
  approval_status content.approval_status not null default 'not_required',
  owner           text,
  draft_url       text,
  asset_url       text,
  postiz_id       text,
  published_url   text,
  utm_url         text,
  scheduled_at    timestamptz,
  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
drop trigger if exists trg_content_updated on content.content_items;
create trigger trg_content_updated before update on content.content_items
  for each row execute function content.set_updated_at();
create index if not exists idx_content_status   on content.content_items(status);
create index if not exists idx_content_lane     on content.content_items(approval_lane, approval_status);
create index if not exists idx_content_anchor   on content.content_items(anchor_id);
create index if not exists idx_content_schedule on content.content_items(scheduled_at);
create index if not exists idx_content_platform on content.content_items(platform);

-- ===========================================================================
-- CLAIMS  — honest-numbers rule (Bible §7, §10.3)
-- ===========================================================================
create table if not exists content.claims (
  id              uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references content.content_items(id) on delete cascade,
  claim_text      text not null,
  proof_url       text,                 -- NULL => unproven => blocks publish
  verified        boolean not null default false,
  created_at      timestamptz not null default now()
);
create index if not exists idx_claims_item on content.claims(content_item_id);

-- ===========================================================================
-- APPROVALS  — audit log (Bible §10). Escalate-only.
-- ===========================================================================
create table if not exists content.approvals (
  id              uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references content.content_items(id) on delete cascade,
  lane            content.approval_lane not null,
  decision        content.approval_status not null,
  decided_by      text,
  note            text,
  decided_at      timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists idx_approvals_item on content.approvals(content_item_id);

-- ===========================================================================
-- METRICS  — per-item performance (Bible §14)
-- ===========================================================================
create table if not exists content.metrics (
  id              uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references content.content_items(id) on delete cascade,
  captured_at     timestamptz not null default now(),
  impressions int, reach int, likes int, comments int, shares int, saves int, clicks int,
  qualified_engagement int,
  raw jsonb
);
create index if not exists idx_metrics_item on content.metrics(content_item_id);

-- Leads were removed (2026-10): success is engagement + reach, not an inbox. Drop the old table
-- (and the view that read it) on databases created before that.
drop view if exists content.v_content_performance;
drop table if exists content.leads cascade;

-- ===========================================================================
-- MODULE_RUNS  — health/status of every module run (FEATURE: visibility)
-- Each module records every execution here so a failing module is never silent.
-- ===========================================================================
create table if not exists content.module_runs (
  id              uuid primary key default gen_random_uuid(),
  module_id       text not null,                 -- e.g. 'scoring', 'qc_gate'
  status          content.run_status not null,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  duration_ms     int,
  items_processed int not null default 0,
  message         text,                          -- human summary
  error           text,                          -- stack / error message if status=error
  meta            jsonb,                          -- arbitrary structured detail
  created_at      timestamptz not null default now()
);
create index if not exists idx_module_runs_module on content.module_runs(module_id, started_at desc);
create index if not exists idx_module_runs_status on content.module_runs(status);

-- ===========================================================================
-- TODOS  — built-in todo tracker (FEATURE)
-- ===========================================================================
create table if not exists content.todos (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  detail          text,
  status          content.todo_status not null default 'open',
  priority        smallint not null default 3 check (priority between 1 and 5),
  content_item_id uuid references content.content_items(id) on delete set null,
  due_date        date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
drop trigger if exists trg_todos_updated on content.todos;
create trigger trg_todos_updated before update on content.todos
  for each row execute function content.set_updated_at();
create index if not exists idx_todos_status on content.todos(status, priority);

-- ===========================================================================
-- RESEARCH_INPUTS  — raw captured signals feeding the queue (Bible §6)
-- The research module turns each unprocessed input into a scored topic. Rows can
-- be added by the operator, a comment/DM triage, or future scrapers — all the same.
-- ===========================================================================
create table if not exists content.research_inputs (
  id              uuid primary key default gen_random_uuid(),
  channel         text,                 -- question_mining|reddit|competitor|seo|trend|internal|client
  raw_text        text not null,        -- the prospect question / pain point / note
  source_url      text,
  status          text not null default 'new',  -- new|processed|dropped
  topic_id        uuid references content.topics(id) on delete set null,
  created_at      timestamptz not null default now(),
  processed_at    timestamptz
);
create index if not exists idx_research_status on content.research_inputs(status);

-- ===========================================================================
-- DECISIONS  — every typed decision + who made it; the training-data log.
-- One row per (decision, model). Shadow mode writes a teacher row (claude|rules,
-- used=true) AND a jev row (used=false) for the same input, so agreement can be
-- measured. Operator corrections are source='human' (POST /content/api/decisions).
-- `workspace` partitions data per customer once this is multi-tenant.
-- ===========================================================================
create table if not exists content.decisions (
  id              uuid primary key default gen_random_uuid(),
  workspace       text not null default 'default',
  task            text not null,        -- topic_score|qc_signals
  subject_id      uuid not null,        -- topics.id | content_items.id
  state           text,                 -- exact text the model saw (null for human rows)
  source          text not null check (source in ('claude','jev','rules','human')),
  model           text,
  answer          jsonb not null,
  confidence      real,                 -- jev only: weakest per-question confidence
  used            boolean not null default false,  -- was this the answer applied
  latency_ms      int,
  seed            boolean not null default false,  -- LLM-written practice example, not a real item
  created_at      timestamptz not null default now()
);
-- added after first release; keeps re-runs of this file safe on existing databases
alter table content.decisions add column if not exists seed boolean not null default false;
create index if not exists idx_decisions_subject on content.decisions(task, subject_id);
create index if not exists idx_decisions_ws      on content.decisions(workspace, task, created_at);
delete from content.decisions where task = 'lead_triage';   -- leads were removed
-- The app connects as the table owner (bypasses RLS); this only shuts out the anon/authenticated API keys.
alter table content.decisions enable row level security;

-- Analytics freezes the reach×intent signal (Table 30) on the item; autopilot-picked
-- topics are flagged so the dataset never mistakes them for the operator's own choice.
alter table content.content_items add column if not exists performance_signal text;
alter table content.topics add column if not exists auto_selected boolean not null default false;
-- Live web check (Perplexity via OpenRouter) captured by Research; fed to scoring + drafting.
alter table content.topics add column if not exists market_context text;

-- ===========================================================================
-- DECODE — competitor spy. Apify scrapes competitors' public posts; the LLM sorts
-- them into formats and breaks each one into beats. docs/DESIGN-GUIDE.md §6e/§9.
-- ===========================================================================
create table if not exists content.competitors (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  handles         jsonb not null default '{}',   -- { x, instagram, linkedin, facebook }: handle or page URL
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

create table if not exists content.decode_runs (
  id              uuid primary key default gen_random_uuid(),
  status          text not null default 'running',   -- running|stopped|done|error
  stage           text not null default 'scraping',  -- scraping|sorting|decoding|done
  competitor_ids  uuid[] not null default '{}',
  platforms       text[] not null default '{}',
  lookback_days   int not null default 90,
  post_cap        int not null default 200,          -- per competitor per platform
  total           int not null default 0,            -- posts scraped
  decoded         int not null default 0,            -- posts broken down so far (= max seq)
  cost_ai_usd     numeric(10,4) not null default 0,
  cost_apify_usd  numeric(10,4) not null default 0,
  message         text,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz
);

create table if not exists content.decode_formats (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references content.decode_runs(id) on delete cascade,
  idx             int not null,                      -- colour slot + display order
  name            text not null,
  description     text not null default '',
  our_post_count  int not null default 0             -- 0 = a gap: they do it, we don't
);
create index if not exists idx_decode_formats_run on content.decode_formats(run_id);

create table if not exists content.decoded_posts (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references content.decode_runs(id) on delete cascade,
  competitor_id   uuid references content.competitors(id) on delete set null,
  platform        text not null,                     -- x|instagram|linkedin|facebook
  post_type       text not null default 'text',      -- text|image|carousel|video
  url             text not null,
  handle          text,
  thumb           text,
  posted_at       timestamptz,
  duration_s      int,
  reactions       int not null default 0,
  comments        int not null default 0,
  shares          int not null default 0,
  views           int,                               -- only when the platform reports it
  vs_own_median   numeric(10,2),                     -- reactions / that competitor's median → "4.2x their usual"
  caption         text not null default '',
  text_source     text not null default 'post_text', -- captions|post_text
  format_id       uuid references content.decode_formats(id) on delete set null,
  hook            text,
  beats           jsonb not null default '[]',       -- [{ at: '¶2'|'slide 3', tag, text }]
  seq             int,                               -- decode order; null until broken down
  unique (run_id, url)
);
create index if not exists idx_decoded_posts_seq on content.decoded_posts(run_id, seq);

alter table content.competitors enable row level security;
alter table content.decode_runs enable row level security;
alter table content.decode_formats enable row level security;
alter table content.decoded_posts enable row level security;

-- ===========================================================================
-- STYLE REFERENCES — an example creative analysed ONCE into a reusable, content-free
-- style prompt + spec, plus a "blank plate" (same layout, no text/subject). Later
-- creatives reuse the saved prompt, so the example is never re-analysed.
-- ===========================================================================
create table if not exists content.style_refs (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  style_prompt    text not null,                     -- content-free description fed to the image model
  spec            jsonb not null default '{}',       -- { palette, typography, layout, text_zones[{role,x,y,w,h}] (0-1 fractions), mood, avoid }
  aspect          text not null default '4:5',       -- nearest supported ratio of the example
  -- ponytail: images in bytea, fine for dozens of styles; move to Supabase Storage if it grows
  source_png      bytea not null,
  plate_png       bytea,                             -- null when the plate call failed; analysis still saved
  analysis_cost_usd numeric(10,4) not null default 0,
  use_count       int not null default 0,
  created_at      timestamptz not null default now()
);
alter table content.style_refs enable row level security;

-- The blank template re-composed for another shape (e.g. 16:9 for X), with its own text areas
-- found by vision. Made the first time a style is used at that shape, then reused for free.
-- Carousel styles have several layouts (cover / content / cta …): layout 'main' is the one in
-- style_refs; the others' templates at the example's own shape live here too, with their example slide.
create table if not exists content.style_variants (
  style_id        uuid not null references content.style_refs(id) on delete cascade,
  layout          text not null default 'main',
  aspect          text not null,
  plate_png       bytea not null,
  source_png      bytea,                             -- the example slide this layout came from (carousels)
  text_zones      jsonb not null default '[]',
  created_at      timestamptz not null default now(),
  primary key (style_id, layout, aspect)
);
-- Upgrade for databases created before carousel styles.
alter table content.style_variants add column if not exists layout text not null default 'main';
alter table content.style_variants add column if not exists source_png bytea;
-- Layouts drawn as a layout template (spec.tpl) need no picture, only their example slide.
alter table content.style_variants alter column plate_png drop not null;
do $$ begin
  if (select array_length(conkey, 1) from pg_constraint where conname = 'style_variants_pkey') = 2 then
    alter table content.style_variants drop constraint style_variants_pkey;
    alter table content.style_variants add primary key (style_id, layout, aspect);
  end if;
end $$;
alter table content.style_variants enable row level security;

-- ===========================================================================
-- BRAND KIT — the one brand this install writes for (name, voice, audience, pillars,
-- offers, look). Read by every prompt and creative; edited on /content/brand.
-- ===========================================================================
create table if not exists content.brand_kit (
  id              boolean primary key default true check (id),   -- single row
  name            text not null default '',
  tagline         text not null default '',
  audience        text not null default '',                       -- who we write for (ICP)
  voice_prompt    text not null default '',
  voice_samples   jsonb not null default '[]',                    -- pasted example posts
  pillars         jsonb not null default '[]',                    -- [{ slug, label, description, target }]
  offers          jsonb not null default '[]',                    -- [{ label, url, cta, primary }]
  palette         jsonb not null default '[]',                    -- ['#hex', ...]
  heading_font    text,
  body_font       text,
  logo_png        bytea,
  logo_corner     text not null default 'br' check (logo_corner in ('tl','tr','bl','br')),
  own_handles     jsonb not null default '{}',                    -- { x, instagram, linkedin, facebook }
  onboarded_at    timestamptz,
  updated_at      timestamptz not null default now()
);
drop trigger if exists trg_brand_kit_updated on content.brand_kit;
create trigger trg_brand_kit_updated before update on content.brand_kit
  for each row execute function content.set_updated_at();
alter table content.brand_kit enable row level security;

-- Font files for creatives (Google Fonts downloads or the client's own uploads).
create table if not exists content.brand_fonts (
  family          text not null,
  weight          int  not null default 400,
  style           text not null default 'normal',
  file            bytea not null,
  source          text not null check (source in ('google','upload')),
  created_at      timestamptz not null default now(),
  primary key (family, weight, style)
);
alter table content.brand_fonts enable row level security;

-- Which brand offer a draft points to (index into brand_kit.offers; null = the primary one).
alter table content.content_items add column if not exists offer_idx smallint;

-- Upgrade: pillars were a fixed enum of one brand's four pillars. Views read the column, so
-- they are dropped first and recreated below.
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'content'
             and table_name = 'topics' and column_name = 'pillar' and udt_name = 'pillar') then
    drop view if exists content.v_approval_queue;
    drop view if exists content.v_publish_ready;
    drop view if exists content.v_topic_queue;
    drop view if exists content.v_content_performance;
    alter table content.topics alter column pillar type text;
    alter table content.content_items alter column pillar type text;
  end if;
end $$;
drop type if exists content.pillar;

-- ===========================================================================
-- POST MEDIA — the creative attached to one post: slides made from a saved style, or the
-- client's own images / video. The publisher sends these to every platform, in idx order.
-- content_items.asset_url points at /content/api/items/{id}/asset while any exist.
-- ===========================================================================
-- ponytail: bytea like style_refs; move to Supabase Storage if posts carry lots of video.
create table if not exists content.content_assets (
  item_id         uuid not null references content.content_items(id) on delete cascade,
  idx             smallint not null,
  mime            text not null check (mime in ('image/png', 'image/jpeg', 'video/mp4')),
  bytes           bytea not null,
  source          text not null check (source in ('generated', 'upload')),
  style_id        uuid references content.style_refs(id) on delete set null,
  created_at      timestamptz not null default now(),
  primary key (item_id, idx)
);
alter table content.content_assets enable row level security;

-- ===========================================================================
-- HOOK LIBRARY — decoded openings ranked by "x their usual". The client's own account is a
-- competitor row with is_self (synced from the Brand Kit in phase 6), shown as "You".
-- hook_ref: the decoded post whose hook pattern a draft used (drafting or "rewrite with this hook").
-- ===========================================================================
alter table content.competitors add column if not exists is_self boolean not null default false;
alter table content.content_items add column if not exists hook_ref uuid references content.decoded_posts(id) on delete set null;

-- ===========================================================================
-- VIEWS
-- ===========================================================================
create or replace view content.v_approval_queue as
select ci.id, ci.title, ci.platform, ci.format, ci.pillar,
       ci.risk_level, ci.approval_lane, ci.approval_status, ci.scheduled_at,
       (select count(*) from content.claims c
         where c.content_item_id = ci.id and c.proof_url is null) as unproven_claims
from content.content_items ci
where ci.approval_status = 'pending'
order by ci.created_at;

create or replace view content.v_publish_ready as
select ci.*
from content.content_items ci
where ci.status = 'approved'
  and not exists (
    select 1 from content.claims c
    where c.content_item_id = ci.id and c.proof_url is null
  );

create or replace view content.v_topic_queue as
select id, title, pillar, funnel_stage, source, score_total, priority_band
from content.topics
where status in ('new','selected')
order by
  case priority_band when 'high' then 1 when 'queue' then 2 when 'if_timely' then 3 else 4 end,
  score_total desc;

-- Latest run per module — the dashboard's health panel reads this.
create or replace view content.v_module_health as
select distinct on (module_id)
  module_id, status, started_at, finished_at, duration_ms,
  items_processed, message, error
from content.module_runs
order by module_id, started_at desc;

-- One post URL, however a platform or Postiz spells it (protocol, www/m., query, trailing
-- slash, twitter.com) — how a published item finds itself in a scrape of our own account.
-- ponytail: LinkedIn share URLs (feed/update/urn:li:share) and scraped activity URLs differ;
-- those posts keep their Postiz stats only. Match on the activity id if that matters.
create or replace function content.norm_url(u text) returns text language sql immutable as $$
  select replace(regexp_replace(regexp_replace(lower(u), '^https?://(www\.|m\.|mobile\.)?', ''), '/*([?#].*)?$', ''),
                 'twitter.com/', 'x.com/')
$$;

-- "Your usual": median reactions per platform in the latest scrape of the client's own accounts.
drop view if exists content.v_content_performance;
create or replace view content.v_own_baseline as
select p.platform, percentile_cont(0.5) within group (order by p.reactions)::float8 as median_reactions, count(*)::int as posts
from content.decoded_posts p
join content.competitors c on c.id = p.competitor_id and c.is_self
where p.run_id = (select r.id from content.decode_runs r
                  where r.total > 0 and exists (select 1 from content.competitors s where s.is_self and s.id = any(r.competitor_ids))
                  order by r.started_at desc limit 1)
group by p.platform;

-- Per-item performance roll-up (Bible §14) — analytics + weekly review read this.
-- Latest metrics row per item. engagement = likes + comments + shares; vs_usual = likes over
-- this platform's own median reactions ("2.3x your usual"), null until own results exist.
create or replace view content.v_content_performance as
select
  ci.id, ci.title, ci.platform, ci.pillar, ci.funnel_stage, ci.status,
  ci.published_at,
  m.impressions, m.reach, m.likes, m.comments, m.shares, m.saves, m.clicks,
  m.qualified_engagement,
  ci.performance_signal,
  case when coalesce(m.likes, m.comments, m.shares) is not null
       then coalesce(m.likes, 0) + coalesce(m.comments, 0) + coalesce(m.shares, 0) end as engagement,
  round((m.likes / nullif(b.median_reactions, 0))::numeric, 2)::float8 as vs_usual
from content.content_items ci
left join lateral (
  select * from content.metrics mm
  where mm.content_item_id = ci.id
  order by mm.captured_at desc limit 1
) m on true
left join content.v_own_baseline b on b.platform = ci.platform::text;
