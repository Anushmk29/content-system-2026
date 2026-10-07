// Hook library: every decoded opening, ranked by "x their usual" (the post's reactions over that
// account's own median). Competitors' posts and the client's own (competitors.is_self → "You").
// Drafting offers the top winners as patterns; the drawer can rewrite one post with a chosen hook.
import type { ModuleContext } from '../modules/module.ts';
import { parseJsonObject } from '../modules/llm-json.ts';
import { createRepo } from '../db/repo.ts';
import { brandSystem, buildHookRewritePrompt, DRAFT_PLATFORMS, type DraftPlatform } from '../prompts/brand-brain.ts';
import { loadBrand } from './brand-service.ts';
import { editItemCopy } from './board-service.ts';

export interface HookRow {
  id: string; hook: string; platform: string; format: string | null; source: string; self: boolean;
  handle: string | null; lift: number; url: string; posted_at: string | null;
}

/** Ranked hooks, best first. A post decoded in several runs counts once (its latest run). */
export async function listHooks(ctx: ModuleContext, opts: {
  platforms?: readonly string[]; days?: number; minLift?: number; ids?: string[]; limit?: number;
} = {}): Promise<HookRow[]> {
  return (await ctx.db.query<HookRow>(
    `select * from (
       select distinct on (p.url) p.id, p.hook, p.platform, f.name as format, coalesce(c.is_self, false) as self,
         case when c.is_self then 'You' else coalesce(c.name, '@' || p.handle, 'unknown') end as source,
         p.handle, p.vs_own_median::float8 as lift, p.url,
         to_char(p.posted_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as posted_at
       from content.decoded_posts p
       join content.decode_runs r on r.id = p.run_id
       left join content.competitors c on c.id = p.competitor_id
       left join content.decode_formats f on f.id = p.format_id
       where p.hook is not null and p.vs_own_median is not null
         and ($1::text[] is null or p.platform = any($1))
         and ($2::int is null or p.posted_at > now() - make_interval(days => $2::int))
         and ($3::uuid[] is null or p.id = any($3))
       order by p.url, r.started_at desc
     ) h where ($4::float8 is null or h.lift > $4) order by h.lift desc limit $5`,
    [opts.platforms?.length ? [...opts.platforms] : null, opts.days ?? null, opts.ids ?? null, opts.minLift ?? null, opts.limit ?? 200],
  )).rows;
}

/** The drafting block: winners from the last 90 days on the target platforms (any platform if none match). */
export async function provenHooks(ctx: ModuleContext, platforms: readonly DraftPlatform[]): Promise<{ text: string; ids: string[] } | null> {
  let hooks = await listHooks(ctx, { platforms, days: 90, minLift: 1, limit: 10 });
  if (!hooks.length) hooks = await listHooks(ctx, { days: 90, minLift: 1, limit: 10 });
  if (!hooks.length) return null;
  return {
    text: hooks.map((h, i) => `[${i + 1}] ${h.platform} · ${h.lift}x their usual · "${h.hook}"`).join('\n'),
    ids: hooks.map((h) => h.id),
  };
}

/** Drawer: rewrite one post's hook + body in the shape of a library hook. Same lock as hand edits. */
export async function rewriteWithHook(ctx: ModuleContext, itemId: string, hookId: unknown): Promise<{ ok: boolean; message: string }> {
  if (typeof hookId !== 'string') return { ok: false, message: 'Pick a hook.' };
  if (!ctx.adapters.claude.configured) return { ok: false, message: 'No AI configured.' };
  const repo = createRepo(ctx.db);
  const item = await repo.getItem(itemId);
  if (!item) return { ok: false, message: 'Post not found.' };
  if (!['idea', 'draft', 'qc_passed', 'needs_approval'].includes(item.status)) return { ok: false, message: 'Copy is locked once approved.' };
  const [h] = await listHooks(ctx, { ids: [hookId], limit: 1 });
  if (!h) return { ok: false, message: 'That hook is no longer in the library.' };
  await loadBrand(ctx);
  const raw = await ctx.adapters.claude.complete(buildHookRewritePrompt({
    platform: (DRAFT_PLATFORMS as readonly string[]).includes(item.platform) ? item.platform as DraftPlatform : 'linkedin',
    hook: item.hook ?? '', body: item.body ?? '', pattern: h.hook, source: h.source, lift: h.lift,
  }), { system: brandSystem(), maxTokens: 4096 });
  const out = parseJsonObject(raw);
  if (typeof out.hook !== 'string' || typeof out.body !== 'string' || !out.body.trim()) return { ok: false, message: 'The AI reply was unusable, try again.' };
  const r = await editItemCopy(ctx, itemId, { hook: out.hook.trim(), body: out.body.trim() });
  if (r.ok) await ctx.db.query(`update content.content_items set hook_ref = $2 where id = $1`, [itemId, h.id]);
  return r.ok ? { ok: true, message: 'Rewritten with that hook' } : r;
}
