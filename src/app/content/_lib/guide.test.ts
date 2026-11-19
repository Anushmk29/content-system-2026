// node --test src/app/content/_lib/guide.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GROUPS } from './pages.ts';
import { GUIDE, guideFor } from './guide.ts';

test('every client page has a guide, and every Next link is a real page', () => {
  const client = GROUPS.filter((g) => !g.admin).flatMap((g) => g.links.map((l) => l.href));
  const all = new Set(GROUPS.flatMap((g) => g.links.map((l) => l.href)));
  for (const href of client) assert.ok(GUIDE[href], `no guide for ${href}`);
  for (const [href, g] of Object.entries(GUIDE)) {
    assert.ok(all.has(href), `guide for unknown page ${href}`);
    if (g.next) assert.ok(all.has(g.next), `${href} → unknown ${g.next}`);
  }
});

test('guideFor picks the page a path belongs to', () => {
  assert.equal(guideFor('/content')?.href, '/content');
  assert.equal(guideFor('/content/ideas/123')?.href, '/content/ideas');
  assert.equal(guideFor('/content/system'), null);   // admin page: no guide
  assert.equal(guideFor('/content/settingsx'), null);
});
