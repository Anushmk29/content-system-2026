// Todo tracker service (FEATURE). Thin wrapper over the repo with light validation.
import type { ModuleContext } from '../modules/module.ts';
import { createRepo, type TodoRow } from '../db/repo.ts';

export interface NewTodo {
  title: string;
  detail?: string;
  priority?: number;       // 1-5
  contentItemId?: string;
  dueDate?: string;        // YYYY-MM-DD
}
export interface TodoPatch {
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
  const priority = t.priority == null ? 3 : Math.min(5, Math.max(1, Math.round(t.priority)));
  return createRepo(ctx.db).createTodo({ ...t, title: t.title.trim(), priority });
}

export async function updateTodo(ctx: ModuleContext, id: string, patch: TodoPatch): Promise<TodoRow | null> {
  return createRepo(ctx.db).updateTodo(id, patch);
}

export async function deleteTodo(ctx: ModuleContext, id: string): Promise<void> {
  await createRepo(ctx.db).deleteTodo(id);
}
