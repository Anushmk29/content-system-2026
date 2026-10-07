-- ============================================================================
-- PRATAP AI — Content Pipeline : Seed data (worked anchor example, Bible §8.2)
-- Run AFTER schema.sql:  psql "$CONTENT_DATABASE_URL" -f db/seed.sql
-- ============================================================================
set search_path to content, public;

-- 1) High-priority topic (Bible Table 18): 5+4+5+3+5 = 22 -> high
insert into content.topics (title, pillar, funnel_stage, source, source_detail,
  score_lead_intent, score_reach, score_brand_fit, score_proof, score_repurpose, status)
values (
  '3 workflows every SME should automate first',
  'practical_ai_for_operators', 'awareness',
  'question_mining', 'Recurring prospect question: "Where should we start with AI?"',
  5, 4, 5, 3, 5, 'selected')
on conflict do nothing;

-- 2) The ANCHOR asset (blog article).
with t as (select id from content.topics
           where title = '3 workflows every SME should automate first' limit 1)
insert into content.content_items (topic_id, title, pillar, funnel_stage, platform, format,
  hook, cta, status, risk_level, approval_lane, approval_status, owner)
select t.id, '3 workflows every SME should automate first',
  'practical_ai_for_operators', 'awareness', 'blog', 'article',
  'Most SMEs do not need an AI strategy. They need a workflow map.',
  'Book an AI Readiness Call', 'idea', 'medium', 'review', 'not_required', 'founder'
from t on conflict do nothing;

-- 3) Platform-native children repurposed from the anchor (Bible Table 19).
with a as (select id, topic_id, pillar, funnel_stage from content.content_items
           where title = '3 workflows every SME should automate first'
             and platform = 'blog' limit 1)
insert into content.content_items (topic_id, anchor_id, title, pillar, funnel_stage,
  platform, format, hook, cta, status, risk_level, approval_lane, approval_status, owner)
select a.topic_id, a.id, '3 workflows every SME should automate first',
  a.pillar, a.funnel_stage, p.platform, p.format, p.hook,
  'Book an AI Readiness Call', 'idea', 'medium', 'review', 'not_required', 'founder'
from a cross join (values
  ('linkedin'::content.platform, 'founder_post'::content.content_format,
     'Most SMEs do not need an AI strategy. They need a workflow map.'),
  ('x'::content.platform, 'thread'::content.content_format,
     'The first AI workflow should be boring. That is usually a good sign.'),
  ('instagram'::content.platform, 'carousel'::content.content_format,
     'Before automating anything, ask this one question.')
) as p(platform, format, hook)
on conflict do nothing;

-- 3b) Raw research signals so the Research Collector has something to process.
insert into content.research_inputs (channel, raw_text, source_url, status) values
  ('question_mining', 'A prospect asked on a call: "Can AI help us stop leads slipping through the cracks?"', null, 'new'),
  ('reddit', 'r/smallbusiness thread: owners frustrated their work is scattered across WhatsApp, spreadsheets and 5 tools.', 'https://reddit.com/r/smallbusiness', 'new')
on conflict do nothing;

-- 4) A couple of starter todos so the tracker isn't empty.
insert into content.todos (title, detail, priority, status) values
  ('Connect LinkedIn + X in Postiz', 'Self-host Postiz, connect the two priority channels, create API key.', 1, 'open'),
  ('Write first anchor blog draft', 'Anchor: "3 workflows every SME should automate first".', 2, 'open')
on conflict do nothing;
