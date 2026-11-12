import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../db/test-db.ts';
import { createRepo } from '../db/repo.ts';
import { researchModule, researchSignal, ensureMarketContext } from './research.module.ts';
import type { ModuleContext } from './module.ts';

const db = await createTestDb();
const repo = createRepo(db);
const TOPIC = JSON.stringify({ title: 'T', pillar: 'founder_build_notes', funnelStage: 'trust', customerLanguage: '' });

// Fake OpenRouter: the Perplexity call returns (or throws) the market check; the extraction call returns a topic.
// `relevance` set = Jev is on and answers P(relevant) with it.
function ctx(market: () => string, prompts: string[], models: Array<string | undefined> = [], relevance?: number) {
  return {
    db, env: {}, logger: { warn() {} },
    adapters: {
      claude: { configured: true, provider: 'openrouter', async complete(p: string, o?: { model?: string }) {
        prompts.push(p);
        models.push(o?.model);
        return o?.model === 'perplexity/sonar' ? market() : TOPIC;
      } },
      jev: { configured: relevance !== undefined, decide: async () => ({ model: 'jev-test', answers: { relevant: { type: 'noul', noul: relevance } } }) },
    },
  } as unknown as ModuleContext;
}

test('batch: cheap-model extraction with no web check; the check runs once, at draft time; a failed check keeps the topic', async () => {
  await repo.insertResearchInput({ rawText: 'how do I automate invoices', channel: 'reddit' });
  const prompts: string[] = [], models: Array<string | undefined> = [];
  const r = await researchModule.run(ctx(() => 'GAP: nobody covers approvals https://x.com', prompts, models));
  assert.equal(r.status, 'ok');
  assert.deepEqual(models, ['deepseek/deepseek-v4.1-flash'], 'one cheap call, no Perplexity');
  const [topic] = await repo.unscoredTopics();
  assert.equal(topic!.market_context, null);

  const checked = await ensureMarketContext(ctx(() => 'GAP: nobody covers approvals https://x.com', []), topic!);
  assert.equal(checked.market_context, 'GAP: nobody covers approvals https://x.com');
  assert.equal((await repo.unscoredTopics())[0]!.market_context, checked.market_context, 'saved on the topic');
  const again: string[] = [];
  await ensureMarketContext(ctx(() => 'x', again), checked);
  assert.equal(again.length, 0, 'never paid twice');

  const failed = await ensureMarketContext(ctx(() => { throw new Error('OpenRouter 502'); }, []), { ...topic!, market_context: null });
  assert.equal(failed.market_context, null, 'drafts without it, as before');
});

test('Jev relevance gate: a clearly off-audience signal is dropped with no LLM call; the rest go on', async () => {
  await db.query(`update content.research_inputs set status = 'processed' where status = 'new'`);
  const off = await repo.insertResearchInput({ rawText: 'best pizza in Naples' });
  const prompts: string[] = [];
  const r = await researchModule.run(ctx(() => '', prompts, [], 0.05));
  assert.match(r.message, /1 dropped as off-audience/);
  assert.equal(prompts.length, 0);
  assert.equal(await repo.researchInput(off.id), undefined);
  await repo.insertResearchInput({ rawText: 'invoice approvals take a week' });
  assert.equal((await researchModule.run(ctx(() => '', [], [], 0.6))).itemsProcessed, 1);
});

test('CONTENT_RESEARCH_MODEL=tinyfish: search + fetch top 3, our LLM writes the check from those pages only', async () => {
  await repo.insertResearchInput({ rawText: 'How do clinics automate reminders?\n\nlong body', channel: 'reddit' });
  const prompts: Array<{ p: string; model?: string }> = [];
  const searched: string[] = [];
  let fetched: string[] = [];
  const c = {
    db, env: { researchModel: 'tinyfish' }, logger: { warn() {} },
    adapters: {
      claude: { configured: true, async complete(p: string, o?: { model?: string }) {
        prompts.push({ p, model: o?.model });
        return p.includes('From these sources only') ? 'GAP: no-shows https://a.com/1' : TOPIC;
      } },
      tinyfish: {
        configured: true,
        async search(q: string) {
          searched.push(q);
          return [1, 2, 3, 4].map((n) => ({ position: n, site_name: 's', title: `T${n}`, snippet: `snip${n}`, url: `https://a.com/${n}` }));
        },
        async fetch(urls: string[]) {
          fetched = urls;
          return { pages: [{ url: 'https://a.com/1', text: 'PAGE ONE TEXT' }], errors: [{ url: 'https://a.com/2', error: 'blocked' }] };
        },
      },
    },
  } as unknown as ModuleContext;
  const input = (await repo.unprocessedResearchInputs()).at(-1)!;
  assert.ok((await researchSignal(c, input)).checked, '"Make posts" checks at once');
  assert.deepEqual(searched, ['How do clinics automate reminders?'], 'first line is the query');
  assert.deepEqual(fetched, ['https://a.com/1', 'https://a.com/2', 'https://a.com/3']);
  const check = prompts[0]!;
  assert.equal(check.model, undefined, 'our default LLM, not Perplexity — works on any provider');
  assert.match(check.p, /PAGE ONE TEXT/);
  assert.match(check.p, /snip2/, 'a page that failed to fetch falls back to its snippet');
  assert.match(check.p, /https:\/\/a\.com\/4/);
  assert.match(prompts[1]!.p, /GAP: no-shows/);
});

test('decideSignal: "use" makes a topic from just that signal and queues it; "drop" shelves one', async () => {
  const { decideSignal } = await import('../services/console-service.ts');
  const pick = await repo.insertResearchInput({ rawText: 'picked one' });
  const other = await repo.insertResearchInput({ rawText: 'not picked' });
  const r = await decideSignal(ctx(() => '', []), pick.id, 'use');
  assert.ok(r.ok, r.message);
  const t = await db.query<{ status: string }>(`select t.status from content.topics t join content.research_inputs r on r.topic_id = t.id where r.id = $1`, [pick.id]);
  assert.equal(t.rows[0]!.status, 'selected');
  assert.equal((await repo.researchInput(other.id))?.raw_text, 'not picked', 'the other signal is untouched');
  assert.ok((await decideSignal(ctx(() => '', []), other.id, 'drop')).ok);
  assert.equal(await repo.researchInput(other.id), undefined);
  assert.equal((await decideSignal(ctx(() => '', []), pick.id, 'use')).ok, false, 'used once only');
});
