import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runModules } from './orchestrator.ts';
import type { Module, ModuleContext } from './module.ts';
import { ok } from './module.ts';
import { createTestDb } from '../db/test-db.ts';
import { createRepo } from '../db/repo.ts';

const db = await createTestDb();
function fakeCtx() {
  const ctx = {
    db,
    env: {} as ModuleContext['env'],
    logger: { debug() {}, info() {}, warn() {}, error() {}, child() { return this; } },
    adapters: {} as ModuleContext['adapters'],
  } as unknown as ModuleContext;
  return { ctx };
}

const goodModule: Module = {
  id: 'good', title: 'Good', description: '',
  run: async () => ok(3, 'did work'),
};
const badModule: Module = {
  id: 'bad', title: 'Bad', description: '',
  run: async () => { throw new Error('boom'); },
};

test('a failing module does not stop the others', async () => {
  const { ctx } = fakeCtx();
  const records = await runModules([goodModule, badModule, goodModule], ctx);
  assert.equal(records.length, 3);
  assert.equal(records[0]?.status, 'ok');
  assert.equal(records[1]?.status, 'error');     // isolated
  assert.equal(records[2]?.status, 'ok');         // ran despite the failure before it
});

test('every run is recorded, and the health panel sees the latest outcome', async () => {
  const { ctx } = fakeCtx();
  await runModules([goodModule, badModule], ctx);
  const health = new Map((await createRepo(db).moduleHealth()).map((h) => [h.module_id, h]));
  assert.equal(health.get('good')?.status, 'ok');
  assert.equal(health.get('bad')?.status, 'error');
  assert.match(health.get('bad')?.message ?? '', /boom/);
  assert.ok(await createRepo(db).lastProductiveRun('good', 7), 'the weekly-review gate sees productive runs');
  assert.equal(await createRepo(db).lastProductiveRun('bad', 7), null);
});

test('modules run in pipeline order, each after the previous finished', async () => {
  const { ctx } = fakeCtx();
  const log: string[] = [];
  const step = (id: string, ms: number): Module => ({
    id, title: id, description: '',
    run: async () => { log.push(`${id}:start`); await new Promise((r) => setTimeout(r, ms)); log.push(`${id}:end`); return ok(0, ''); },
  });
  await runModules([step('a', 20), step('b', 0)], ctx);
  assert.deepEqual(log, ['a:start', 'a:end', 'b:start', 'b:end']);
});

test('runModules never rejects', async () => {
  const { ctx } = fakeCtx();
  await assert.doesNotReject(runModules([badModule, badModule], ctx));
});
