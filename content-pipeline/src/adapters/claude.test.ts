import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClaude } from './claude.ts';

/** Captures request bodies; answers like OpenRouter. */
function stubFetch() {
  const bodies: Array<{ model: string; messages: Array<{ role: string; content: unknown }> }> = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: { cost: 0 } }), { status: 200 });
  }) as typeof fetch;
  return { bodies, restore: () => { globalThis.fetch = real; } };
}

test('long Claude system prompts carry a cache marker; short ones and other models stay plain text', async () => {
  const f = stubFetch();
  try {
    const llm = createClaude({ openrouterApiKey: 'k' });
    const long = 'brand context. '.repeat(400);
    await llm.complete('hi', { system: long });
    await llm.complete('hi', { system: 'short' });
    await llm.complete('hi', { system: long, model: 'perplexity/sonar' });
    const sys = f.bodies.map((b) => b.messages[0]!.content);
    assert.deepEqual(sys[0], [{ type: 'text', text: long, cache_control: { type: 'ephemeral' } }]);
    assert.equal(sys[1], 'short');
    assert.equal(sys[2], long);
  } finally {
    f.restore();
  }
});
