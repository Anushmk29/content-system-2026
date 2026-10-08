// node --test app/content/auth.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.CONTENT_RUN_SECRET = 'client-pw';
process.env.CONTENT_ADMIN_SECRET = 'admin-pw';
const { roleForPassword, signSession, verifySession, isAdminPath } = await import('./auth.ts');

test('passwords map to roles; sessions verify, expire, and resist tampering', () => {
  assert.equal(roleForPassword('client-pw'), 'client');
  assert.equal(roleForPassword('admin-pw'), 'admin');
  assert.equal(roleForPassword('nope'), null);
  assert.equal(roleForPassword(''), null);

  const t = signSession('client', 0);
  assert.equal(verifySession(t, 1), 'client');
  assert.equal(verifySession(t.replace('client', 'admin'), 1), null);   // role swap breaks the signature
  assert.equal(verifySession(t, 31 * 86_400_000), null);                 // expired
  process.env.CONTENT_ADMIN_SECRET = 'rotated';
  assert.equal(verifySession(t, 1), null);                                // password change logs everyone out

  assert.ok(isAdminPath('/content/system') && isAdminPath('/content/api/decisions/seed'));
  assert.ok(isAdminPath('/content/costs') && isAdminPath('/content/api/costs'));
  assert.ok(!isAdminPath('/content/systems') && !isAdminPath('/content'));
});

test('cron secret opens only the run routes; spend paths; same-origin writes; rate limit', async () => {
  const { roleForSecret, isSpendPath, sameOrigin } = await import('./auth.ts');
  const { limited } = await import('./rate-limit.ts');
  process.env.CONTENT_CRON_SECRET = 'cron-pw';
  assert.equal(roleForSecret('cron-pw', '/content/api/run'), 'client');
  assert.equal(roleForSecret('cron-pw', '/content/api/modules/scoring/run'), 'client');
  assert.equal(roleForSecret('cron-pw', '/content/api/brand'), null);   // cron secret is not a login
  assert.equal(roleForSecret('client-pw', '/content/api/brand'), 'client');

  assert.ok(isSpendPath('/content/api/run') && isSpendPath('/content/api/styles/abc/generate') && isSpendPath('/content/api/decode'));
  assert.ok(!isSpendPath('/content/api/brand') && !isSpendPath('/content/api/items/1'));

  assert.ok(sameOrigin('https://app.example.com', 'app.example.com'));
  assert.ok(sameOrigin(null, 'app.example.com'));                         // curl / server-to-server
  assert.ok(!sameOrigin('https://evil.example.com', 'app.example.com'));
  assert.ok(!sameOrigin('not a url', 'app.example.com'));

  for (let i = 0; i < 3; i++) assert.equal(limited('t', 3, 60_000, 1000 + i), false);
  assert.equal(limited('t', 3, 60_000, 1003), true);                     // 4th inside the window
  assert.equal(limited('t', 3, 60_000, 70_000), false);                   // window passed
});
