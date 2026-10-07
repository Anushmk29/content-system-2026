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
  assert.ok(!isAdminPath('/content/systems') && !isAdminPath('/content'));
});
