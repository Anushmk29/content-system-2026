import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createTestDb } from '../db/test-db.ts';
import { readSettings, saveSettings, settingsView, validateSettings } from './settings-service.ts';
import { loadEnv } from '../env.ts';
import { getContext } from '../context.ts';

const db = await createTestDb();
process.env.CONTENT_SETTINGS_KEY = 'test-only-encryption-key-32-characters-long';
process.env.CONTENT_OPENROUTER_API_KEY = 'server-key';

test('only routine settings are accepted; numeric, enum and URL boundaries reject bad input', () => {
  for (const input of [null, [], 'key', { CONTENT_DATABASE_URL: 'postgres://x' }, { CONTENT_SESSION_KEY: 'x' }, { CONTENT_PYTHON: '/tmp/program' }, { CONTENT_ADMIN_SECRET: 'x' },
    { CONTENT_DAILY_BUDGET_USD: '-1' }, { CONTENT_DAILY_BUDGET_USD: 'NaN' }, { CONTENT_AUTO_SELECT_TOPICS: '1.5' },
    { CONTENT_TRANSCRIBE_CAP: '201' }, { CONTENT_POST_HOUR_UTC: '24' }, { CONTENT_JEV_MODE: 'unknown' }, { CONTENT_POSTIZ_SYNC: true },
    { CONTENT_POSTIZ_API_URL: 'file:///tmp/key' }, { CONTENT_POSTIZ_API_URL: 'https://user:secret@postiz.test/api' },
    { CONTENT_OPENROUTER_API_KEY: 'key\nheader' }, { CONTENT_OPENROUTER_API_KEY: 'x'.repeat(8001) }]) {
    assert.throws(() => validateSettings(input));
  }
  const patch = validateSettings({ CONTENT_DAILY_BUDGET_USD: '0', CONTENT_POSTIZ_SYNC: '1', CONTENT_POSTIZ_API_URL: 'http://postiz:5000/api', CONTENT_REDDIT_QUERIES: 'AI,writing' });
  const env = loadEnv(patch as Record<string, string>);
  assert.equal(env.dailyBudgetUsd, 0);
  assert.equal(env.postizSync, true);
  const exponent = validateSettings({ CONTENT_AUTO_SELECT_TOPICS: '1e1', CONTENT_TRANSCRIBE_CAP: '0xA' });
  assert.equal(exponent.CONTENT_AUTO_SELECT_TOPICS, '10');
  assert.equal(loadEnv(exponent as Record<string, string>).transcribeCap, 10);
});

test('settings survive read-back as ciphertext; secret values never reach browser data', async () => {
  await saveSettings(db, { CONTENT_OPENROUTER_API_KEY: 'saved-private-key', CONTENT_LLM_MODEL: 'provider/model', CONTENT_DAILY_BUDGET_USD: '3' });
  const rows = (await db.query<{ value: string }>('select value from content.runtime_settings')).rows;
  assert.ok(rows.length >= 3);
  assert.ok(rows.every((r) => r.value.startsWith('v1.') && !r.value.includes('saved-private-key') && !r.value.includes('provider/model')));
  const saved = await readSettings(db);
  assert.equal(saved.values.CONTENT_OPENROUTER_API_KEY, 'saved-private-key');
  assert.equal(loadEnv({ ...process.env, ...saved.values }).openrouterApiKey, 'saved-private-key');
  const view = await settingsView(db);
  const key = view.fields.find((f) => f.name === 'CONTENT_OPENROUTER_API_KEY')!;
  assert.equal(key.source, 'saved');
  assert.equal(key.configured, true);
  assert.ok(!('value' in key));
  assert.ok(!JSON.stringify(view).includes('saved-private-key'));
  assert.ok(!JSON.stringify(view).includes('server-key'));
  assert.equal(view.fields.find((f) => f.name === 'CONTENT_LLM_MODEL')?.value, 'provider/model');
});

test('blank key keeps saved value; reset restores environment fallback and partial saves keep other fields', async () => {
  await saveSettings(db, { CONTENT_OPENROUTER_API_KEY: 'replacement-key', CONTENT_LLM_MODEL: 'provider/keep' });
  await saveSettings(db, { CONTENT_OPENROUTER_API_KEY: '  ', CONTENT_DAILY_BUDGET_USD: '0' });
  assert.equal((await readSettings(db)).values.CONTENT_OPENROUTER_API_KEY, 'replacement-key');
  await saveSettings(db, { CONTENT_OPENROUTER_API_KEY: null });
  const saved = await readSettings(db);
  assert.ok(!('CONTENT_OPENROUTER_API_KEY' in saved.values));
  assert.equal(loadEnv({ ...process.env, ...saved.values }).openrouterApiKey, 'server-key');
  assert.equal(saved.values.CONTENT_LLM_MODEL, 'provider/keep');
  assert.equal(saved.values.CONTENT_DAILY_BUDGET_USD, '0');
  assert.equal((await settingsView(db)).fields.find((f) => f.name === 'CONTENT_OPENROUTER_API_KEY')?.source, 'server');
});

test('invalid patches are atomic and encryption authenticates the setting name and key', async () => {
  await saveSettings(db, { CONTENT_OPENROUTER_API_KEY: 'original-key' });
  await assert.rejects(saveSettings(db, { CONTENT_OPENROUTER_API_KEY: 'should-not-save', CONTENT_TRANSCRIBE_CAP: '-2' }));
  assert.equal((await readSettings(db)).values.CONTENT_OPENROUTER_API_KEY, 'original-key');
  await db.query(`insert into content.runtime_settings (name, value) select 'CONTENT_TINYFISH_API_KEY', value from content.runtime_settings where name = 'CONTENT_OPENROUTER_API_KEY'`);
  await assert.rejects(readSettings(db), /could not be decrypted/);
  await db.query(`delete from content.runtime_settings where name = 'CONTENT_TINYFISH_API_KEY'`);
  const original = process.env.CONTENT_SETTINGS_KEY;
  process.env.CONTENT_SETTINGS_KEY = 'wrong-encryption-key-that-is-also-long-enough';
  await assert.rejects(readSettings(db), /could not be decrypted/);
  process.env.CONTENT_SETTINGS_KEY = original;
});

test('getContext reloads changes across operations while preserving in-flight contexts and the database', async () => {
  process.env.CONTENT_DATABASE_URL = 'postgresql://settings-test:unused@localhost/settings-test';
  const query = mock.method(pg.Pool.prototype, 'query', async (sql: string, params?: unknown[]) => db.query(sql, params));
  try {
    await saveSettings(db, { CONTENT_OPENROUTER_API_KEY: 'first-runtime-key', CONTENT_POSTIZ_SYNC: '0' });
    const before = await getContext();
    assert.equal(before.env.openrouterApiKey, 'first-runtime-key');
    assert.equal(before.adapters.claude.configured, true);
    assert.equal(await getContext(), before);
    await saveSettings(db, { CONTENT_OPENROUTER_API_KEY: 'second-runtime-key', CONTENT_POSTIZ_SYNC: '1', CONTENT_DAILY_BUDGET_USD: '0' });
    const after = await getContext();
    assert.notEqual(after, before);
    assert.equal(after.db, before.db);
    assert.equal(before.env.openrouterApiKey, 'first-runtime-key');
    assert.equal(after.env.openrouterApiKey, 'second-runtime-key');
    assert.equal(after.env.postizSync, true);
    assert.equal(after.env.dailyBudgetUsd, 0);
    assert.equal(process.env.CONTENT_OPENROUTER_API_KEY, 'server-key');
  } finally { query.mock.restore(); }
});

test('a missing settings table preserves old installations; a database outage is not silently ignored', async () => {
  await db.query('drop table content.runtime_settings');
  assert.deepEqual(await readSettings(db), { values: {}, ready: false });
  const query = mock.method(db, 'query', async () => { throw new Error('database unavailable'); });
  try { await assert.rejects(readSettings(db), /database unavailable/); }
  finally { query.mock.restore(); }
});
