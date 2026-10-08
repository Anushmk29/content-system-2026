// Todo tracker service (FEATURE). Thin wrapper over the repo with light validation.
import type { ModuleContext } from '../modules/module.ts';
import { createRepo, type TodoRow } from '../db/repo.ts';
import { clamp1to5 } from '../../core/src/index.ts';

interface NewTodo {
  title: string;
  detail?: string;
  priority?: number;       // 1-5
}
interface TodoPatch {
  title?: string;
  detail?: string;
  status?: 'open' | 'in_progress' | 'done' | 'archived';
  priority?: number;
}

export async function listTodos(ctx: ModuleContext, status?: string): Promise<TodoRow[]> {
  return createRepo(ctx.db).listTodos(status);
}

export async function createTodo(ctx: ModuleContext, t: NewTodo): Promise<TodoRow> {
  if (!t.title || t.title.trim().length === 0) throw new Error('todo title is required');
  return createRepo(ctx.db).createTodo({
    title: t.title.trim(), detail: t.detail, priority: t.priority == null ? undefined : clamp1to5(t.priority),
  });
}

export async function updateTodo(ctx: ModuleContext, id: string, patch: TodoPatch): Promise<TodoRow | null> {
  return createRepo(ctx.db).updateTodo(id, patch);
}

export async function deleteTodo(ctx: ModuleContext, id: string): Promise<void> {
  await createRepo(ctx.db).deleteTodo(id);
}
