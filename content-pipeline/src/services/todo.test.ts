import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../db/test-db.ts';
import type { ModuleContext } from '../modules/module.ts';
import { createTodo, updateTodo } from './todo-service.ts';

test('todo create and edit reject bad input instead of reaching the database', async () => {
  const ctx = { db: await createTestDb() } as unknown as ModuleContext;
  const t = await createTodo(ctx, { title: '  Ship it ', priority: 9 });
  assert.equal(t.title, 'Ship it');
  assert.equal(t.priority, 5);

  await assert.rejects(createTodo(ctx, null as never), /JSON object/);
  await assert.rejects(createTodo(ctx, { title: 123 } as never), /title is required/);
  await assert.rejects(updateTodo(ctx, t.id, { title: '' }), /title is required/);
  await assert.rejects(updateTodo(ctx, t.id, { status: 'bogus' } as never), /status must be one of/);

  const u = await updateTodo(ctx, t.id, { priority: 99, status: 'done' });
  assert.equal(u?.priority, 5);
  assert.equal(u?.status, 'done');
});
