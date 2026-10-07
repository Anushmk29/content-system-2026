import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../db/test-db.ts';
import { createRepo } from '../db/repo.ts';
import { researchModule } from './research.module.ts';
import type { ModuleContext } from './module.ts';

const db = await createTestDb();
const repo = createRepo(db);
const TOPIC = JSON.stringify({ title: 'T', pillar: 'founder_build_notes', funnelStage: 'trust', customerLanguage: '' });

// Fake OpenRouter: the Perplexity call returns (or throws) the market check; the extraction call returns a topic.
function ctx(market: () => string, prompts: string[]) {
  return {
    db, env: {}, logger: { warn() {} },
    adapters: { claude: { configured: true, provider: 'openrouter', async complete(p: string, o?: { model?: string }) {
      prompts.push(p);
      return o?.model === 'perplexity/sonar' ? market() : TOPIC;
    } } },
  } as unknown as ModuleContext;
}

test('web check feeds extraction and is stored on the topic; a failed check falls back to signal-only', async () => {
  await repo.insertResearchInput({ rawText: 'how do I automate invoices', channel: 'reddit' });
  const prompts: string[] = [];
  const r = await researchModule.run(ctx(() => 'GAP: nobody covers approvals https://x.com', prompts));
  assert.equal(r.status, 'ok');
  assert.match(prompts[1]!, /GAP: nobody covers approvals/);
  const [topic] = await repo.unscoredTopics();
  assert.equal(topic!.market_context, 'GAP: nobody covers approvals https://x.com');

  await repo.insertResearchInput({ rawText: 'second signal' });
  const r2 = await researchModule.run(ctx(() => { throw new Error('OpenRouter 502'); }, []));
  assert.deepEqual([r2.status, r2.itemsProcessed], ['degraded', 1], 'topic still created');
});

test('CONTENT_RESEARCH_MODEL=tinyfish: search + fetch top 3, our LLM writes the check from those pages only', async () => {
  await repo.insertResearchInput({ rawText: 'How do clinics automate reminders?\n\nlong body', channel: 'reddit' });
  const prompts: Array<{ p: string; model?: string }> = [];
  const searched: string[] = [];
  let fetched: string[] = [];
  const c = {
    db, env: { researchModel: 'tinyfish' }, logger: { warn() {} },
    adapters: {
      claude: { configured: true, provider: 'anthropic', async complete(p: string, o?: { model?: string }) {
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
  const r = await researchModule.run(c);
  assert.equal(r.status, 'ok');
  assert.deepEqual(searched, ['How do clinics automate reminders?'], 'first line is the query');
  assert.deepEqual(fetched, ['https://a.com/1', 'https://a.com/2', 'https://a.com/3']);
  const check = prompts[0]!;
  assert.equal(check.model, undefined, 'our default LLM, not Perplexity — works on any provider');
  assert.match(check.p, /PAGE ONE TEXT/);
  assert.match(check.p, /snip2/, 'a page that failed to fetch falls back to its snippet');
  assert.match(check.p, /https:\/\/a\.com\/4/);
  assert.match(prompts[1]!.p, /GAP: no-shows/);
});
