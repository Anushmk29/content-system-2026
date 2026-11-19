// node --test src/app/content/_lib/auth.test.ts
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
  assert.equal(verifySession(t, 8 * 86_400_000), null);                  // expired
  process.env.CONTENT_ADMIN_SECRET = 'rotated';
  assert.equal(verifySession(t, 1), null);                                // password change logs everyone out

  assert.ok(isAdminPath('/content/system') && isAdminPath('/content/api/decisions/seed'));
  assert.ok(isAdminPath('/content/costs') && isAdminPath('/content/api/costs'));
  assert.ok(!isAdminPath('/content/systems') && !isAdminPath('/content'));
  // Bring your own key: the client manages keys too.
  assert.ok(!isAdminPath('/content/api/settings') && !isAdminPath('/content/settings'));
});

test('paused Creative Check covers its page and API descendants without blocking other routes', async () => {
  const { isCreativeCheckPath } = await import('./auth.ts');
  for (const path of ['/content/check', '/content/check/', '/content/api/check', '/content/api/check/id', '/content/api/check/id/run', '/content/api/check/id/media']) {
    assert.equal(isCreativeCheckPath(path), true, path);
  }
  for (const path of ['/content', '/content/checklist', '/content/api/checklist', '/content/api/healthz', '/content/api/run']) {
    assert.equal(isCreativeCheckPath(path), false, path);
  }
});

test('cron secret opens only the run routes; spend paths; same-origin writes; rate limit', async () => {
  const { roleForSecret, isSpendPath, sameOrigin } = await import('./auth.ts');
  const { limited } = await import('./rate-limit.ts');
  process.env.CONTENT_CRON_SECRET = 'cron-pw';
  assert.equal(roleForSecret('cron-pw', '/content/api/run'), 'client');
  assert.equal(roleForSecret('cron-pw', '/content/api/modules/scoring/run'), 'client');
  assert.equal(roleForSecret('cron-pw', '/content/api/brand'), null);   // cron secret is not a login
  assert.equal(roleForSecret('client-pw', '/content/api/brand'), 'client');

  assert.ok(isSpendPath('/content/api/run') && isSpendPath('/content/api/styles/abc') && isSpendPath('/content/api/decode'));
  assert.ok(isSpendPath('/content/api/approvals/1') && isSpendPath('/content/api/topics/1'));
  assert.ok(!isSpendPath('/content/api/brand'));
  for (const path of ['/content/api/items/1', '/content/api/items/1/asset', '/content/api/signals/1']) {
    assert.ok(isSpendPath(path), path);
  }

  assert.ok(sameOrigin('https://app.example.com', 'app.example.com'));
  assert.ok(sameOrigin(null, 'app.example.com'));                         // curl / server-to-server
  assert.ok(!sameOrigin('https://evil.example.com', 'app.example.com'));
  assert.ok(!sameOrigin('not a url', 'app.example.com'));

  for (let i = 0; i < 3; i++) assert.equal(limited('t', 3, 60_000, 1000 + i), false);
  assert.equal(limited('t', 3, 60_000, 1003), true);                     // 4th inside the window
  assert.equal(limited('t', 3, 60_000, 70_000), false);                   // window passed
});

test('outside next dev, weak or missing secrets refuse to serve', async () => {
  const { configProblem } = await import('./auth.ts');
  process.env.CONTENT_RUN_SECRET = 'short';
  process.env.CONTENT_DATABASE_URL = 'postgres://x';
  assert.equal(configProblem('development'), null);
  assert.match(configProblem('production') ?? '', /16 characters/);
  process.env.CONTENT_RUN_SECRET = 'c'.repeat(16);
  process.env.CONTENT_ADMIN_SECRET = 'a'.repeat(16);
  delete process.env.CONTENT_SESSION_KEY;
  assert.match(configProblem('production') ?? '', /CONTENT_SESSION_KEY/);
  process.env.CONTENT_SESSION_KEY = 'k'.repeat(32);
  assert.equal(configProblem('production'), null);
  delete process.env.CONTENT_RUN_SECRET;
  assert.match(configProblem('test') ?? '', /CONTENT_RUN_SECRET/);
});

test('client IP: only the proxy-added X-Forwarded-For entry counts, so spoofing the left side does nothing', async () => {
  const { clientIp } = await import('./rate-limit.ts');
  const req = (xff?: string) => new Request('http://x/', { headers: xff ? { 'x-forwarded-for': xff } : {} });
  assert.equal(clientIp(req('6.6.6.6, 1.2.3.4')), '1.2.3.4');
  assert.equal(clientIp(req('6.6.6.6, 1.2.3.4, 10.0.0.1'), 2), '1.2.3.4');
  assert.equal(clientIp(req()), 'local');
});
