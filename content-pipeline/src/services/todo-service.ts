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

const STATUSES = ['open', 'in_progress', 'done', 'archived'];
const obj = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Send a JSON object.');
  return v as Record<string, unknown>;
};
const title = (v: unknown): string => {
  if (typeof v !== 'string' || !v.trim()) throw new Error('todo title is required');
  if (v.trim().length > 300) throw new Error('todo title is too long (300 characters max)');
  return v.trim();
};
const detail = (v: unknown): string | undefined => {
  if (v != null && typeof v !== 'string') throw new Error('detail must be text');
  if (typeof v === 'string' && v.length > 5000) throw new Error('detail is too long (5,000 characters max)');
  return v ?? undefined;
};

export async function createTodo(ctx: ModuleContext, body: NewTodo): Promise<TodoRow> {
  const t = obj(body);
  return createRepo(ctx.db).createTodo({
    title: title(t.title), detail: detail(t.detail), priority: t.priority == null ? undefined : clamp1to5(t.priority),
  });
}

export async function updateTodo(ctx: ModuleContext, id: string, body: TodoPatch): Promise<TodoRow | null> {
  const p = obj(body);
  if (p.status != null && !STATUSES.includes(p.status as string)) throw new Error(`status must be one of: ${STATUSES.join(', ')}`);
  return createRepo(ctx.db).updateTodo(id, {
    title: p.title == null ? undefined : title(p.title),
    detail: detail(p.detail),
    status: p.status as TodoPatch['status'],
    priority: p.priority == null ? undefined : clamp1to5(p.priority),
  });
}

export async function deleteTodo(ctx: ModuleContext, id: string): Promise<void> {
  await createRepo(ctx.db).deleteTodo(id);
}
