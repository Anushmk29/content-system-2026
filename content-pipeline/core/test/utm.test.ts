import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUtmUrl } from '../src/utm.ts';

test('buildUtmUrl matches the Bible §13.2 example shape', () => {
  const out = buildUtmUrl('https://pratapai.com/ai-readiness', {
    source: 'linkedin',
    campaign: 'ai_readiness',
    content: 'workflow_post_001',
  });
  const u = new URL(out);
  assert.equal(u.searchParams.get('utm_source'), 'linkedin');
  assert.equal(u.searchParams.get('utm_medium'), 'organic');     // default
  assert.equal(u.searchParams.get('utm_campaign'), 'ai_readiness');
  assert.equal(u.searchParams.get('utm_content'), 'workflow_post_001');
});

test('buildUtmUrl preserves existing query + hash', () => {
  const out = buildUtmUrl('https://pratapai.com/p?ref=x#cta', {
    source: 'x', campaign: 'content_pipeline', content: 'abc',
  });
  const u = new URL(out);
  assert.equal(u.searchParams.get('ref'), 'x');
  assert.equal(u.hash, '#cta');
});

test('buildUtmUrl returns input unchanged for non-URLs', () => {
  assert.equal(buildUtmUrl('not a url', { source: 'x', campaign: 'c', content: 'd' }), 'not a url');
});
