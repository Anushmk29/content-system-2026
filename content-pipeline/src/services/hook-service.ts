// Hook library: every decoded opening, ranked by "x their usual" (the post's reactions over that
// account's own median). Competitors' posts and the client's own (competitors.is_self → "You").
// Drafting offers the top winners as patterns; the drawer can rewrite one post with a chosen hook.
import type { ModuleContext } from '../modules/module.ts';
import { parseJsonObject } from '../modules/llm-json.ts';
import { createRepo } from '../db/repo.ts';
import { EDITABLE_STATUSES } from '../../core/src/index.ts';
import { brandSystem } from '../prompts/brand-context.ts';
import { buildHookRewritePrompt } from '../prompts/draft.ts';
import { DRAFT_PLATFORMS, type DraftPlatform } from '../prompts/platform-playbooks.ts';
import { loadBrand } from './brand-service.ts';
import { editItemCopy } from './board-service.ts';
import { isHookPattern } from '../hook-patterns.ts';

export interface PatternWeight { pattern: string; posts: number; weight: number }

/** What each hook pattern earns on OUR published posts (content.v_hook_pattern_weights): ln-lift, shrunk. */
export async function hookPatternWeights(ctx: ModuleContext): Promise<PatternWeight[]> {
  return (await ctx.db.query<PatternWeight>(`select pattern, posts, weight from content.v_hook_pattern_weights order by weight desc`)).rows;
}

/** "Patterns that work for you / avoid" for the draft prompt; null until results exist. */
export async function patternAdvice(ctx: ModuleContext): Promise<string | null> {
  const w = await hookPatternWeights(ctx);
  const good = w.filter((x) => x.weight > 0.05), bad = w.filter((x) => x.weight < -0.05);
  if (!good.length && !bad.length) return null;
  return [good.length && `Patterns that work for you: ${good.map((x) => `${x.pattern} (${x.posts} posts)`).join(', ')}.`,
    bad.length && `Avoid: ${bad.map((x) => `${x.pattern} (${x.posts} posts)`).join(', ')}.`].filter(Boolean).join('\n');
}

export interface HookRow {
  id: string; hook: string; platform: string; format: string | null; source: string; self: boolean;
  handle: string | null; lift: number; url: string; posted_at: string | null;
  hunt: number | null; pattern: string | null;
}

/** Ranked hooks, best first. A post decoded in several runs counts once (its latest run). */
export async function listHooks(ctx: ModuleContext, opts: {
  platforms?: readonly string[]; days?: number; minLift?: number; ids?: string[]; limit?: number;
} = {}): Promise<HookRow[]> {
  return (await ctx.db.query<HookRow>(
    `select * from (
       select distinct on (p.url) p.id, p.hook, p.platform, f.name as format, coalesce(c.is_self, false) as self,
         case when c.is_self then 'You' else coalesce(c.name, '@' || p.handle, 'unknown') end as source,
         p.handle, p.vs_own_median::float8 as lift, p.url, p.hunt_score::float8 as hunt, p.hook_type as pattern,
         to_char(p.posted_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as posted_at
       from content.decoded_posts p
       join content.decode_runs r on r.id = p.run_id
       left join content.competitors c on c.id = p.competitor_id
       left join content.decode_formats f on f.id = p.format_id
       where p.hook is not null and p.vs_own_median is not null and not p.paid
         and ($1::text[] is null or p.platform = any($1))
         and ($2::int is null or p.posted_at > now() - make_interval(days => $2::int))
         and ($3::uuid[] is null or p.id = any($3))
       order by p.url, r.started_at desc
     ) h where ($4::float8 is null or h.lift > $4) order by h.hunt desc nulls last, h.lift desc limit $5`,
    [opts.platforms?.length ? [...opts.platforms] : null, opts.days ?? null, opts.ids ?? null, opts.minLift ?? null, opts.limit ?? 200],
  )).rows;
}

/** The drafting block: winners from the last 90 days on the target platforms (any platform if none match). */
export async function provenHooks(ctx: ModuleContext, platforms: readonly DraftPlatform[]): Promise<{ text: string; ids: string[] } | null> {
  let hooks = await listHooks(ctx, { platforms, days: 90, minLift: 1, limit: 30 });
  if (!hooks.length) hooks = await listHooks(ctx, { days: 90, minLift: 1, limit: 30 });
  if (!hooks.length) return null;
  // Learning loop: a pattern that works on OUR posts lifts its hooks, one that flops sinks them.
  const w = new Map((await hookPatternWeights(ctx).catch(() => [])).map((x) => [x.pattern, x.weight]));
  const rank = (h: HookRow) => h.lift * (1 + (h.pattern ? w.get(h.pattern) ?? 0 : 0));
  hooks = [...hooks].sort((a, b) => rank(b) - rank(a)).slice(0, 10);
  return {
    text: hooks.map((h, i) => `[${i + 1}] ${h.platform} · ${h.lift}x their usual · "${h.hook}"`).join('\n'),
    ids: hooks.map((h) => h.id),
  };
}

/** Drawer: rewrite one post's hook + body in the shape of a library hook. Same lock as hand edits. */
export async function rewriteWithHook(ctx: ModuleContext, itemId: string, hookId: unknown): Promise<{ ok: boolean; message: string; options?: HookOption[] }> {
  if (typeof hookId !== 'string') return { ok: false, message: 'Pick a hook.' };
  if (!ctx.adapters.claude.configured) return { ok: false, message: 'No AI configured.' };
  const repo = createRepo(ctx.db);
  const item = await repo.getItem(itemId);
  if (!item) return { ok: false, message: 'Post not found.' };
  if (!EDITABLE_STATUSES.includes(item.status)) return { ok: false, message: 'Copy is locked once approved.' };
  const [h] = await listHooks(ctx, { ids: [hookId], limit: 1 });
  if (!h) return { ok: false, message: 'That hook is no longer in the library.' };
  await loadBrand(ctx);
  const raw = await ctx.adapters.claude.complete(buildHookRewritePrompt({
    platform: (DRAFT_PLATFORMS as readonly string[]).includes(item.platform) ? item.platform as DraftPlatform : 'linkedin',
    hook: item.hook ?? '', body: item.body ?? '', pattern: h.hook, source: h.source, lift: h.lift,
  }), { system: brandSystem(), maxTokens: 4096 });
  const out = parseJsonObject(raw);
  const weights = new Map((await hookPatternWeights(ctx).catch(() => [])).map((x) => [x.pattern, x.weight]));
  // A reply without options (one plain hook) still counts as one option.
  const options = scoreHookOptions(Array.isArray(out.options) ? out.options : [{ hook: out.hook }], weights);
  const body = typeof out.body === 'string' ? out.body.trim() : '';
  if (!options.length || !body) return { ok: false, message: 'The AI reply was unusable, try again.' };
  const best = options[0]!;
  const r = await editItemCopy(ctx, itemId, { hook: best.hook, body });
  if (r.ok) {
    await ctx.db.query(`update content.content_items set hook_ref = $2, hook_pattern = coalesce($3, hook_pattern) where id = $1`,
      [itemId, h.id, best.pattern]);
  }
  return r.ok ? { ok: true, message: `Rewritten with that hook (score ${best.score})`, options } : r;
}

export interface HookOption { hook: string; pattern: string | null; contrast: number; patternStrength: number; platformFit: number; learned: number; score: number }

/** goviralbro's composite (MIT): 0.4·contrast + 0.35·pattern strength + 0.25·platform fit (1-10),
 *  plus what the pattern has learned on our own posts (weight × 10). Best first. */
export function scoreHookOptions(raw: unknown, weights: Map<string, number>): HookOption[] {
  const n = (v: unknown) => Math.min(10, Math.max(0, Number(v) || 0));
  return (Array.isArray(raw) ? raw : []).flatMap((o: Record<string, unknown>) => {
    const hook = typeof o?.hook === 'string' ? o.hook.trim() : '';
    if (!hook) return [];
    const pattern = isHookPattern(o.pattern) ? o.pattern : null;
    const learned = pattern ? weights.get(pattern) ?? 0 : 0;
    const score = 0.4 * n(o.contrast) + 0.35 * n(o.pattern_strength) + 0.25 * n(o.platform_fit) + 10 * learned;
    return [{ hook, pattern, contrast: n(o.contrast), patternStrength: n(o.pattern_strength), platformFit: n(o.platform_fit),
      learned: Math.round(learned * 100) / 100, score: Math.round(score * 10) / 10 }];
  }).sort((a, b) => b.score - a.score).slice(0, 5);
}

/** Drawer: swap in one of the other scored openings (no AI call). */
export async function applyHookOption(ctx: ModuleContext, itemId: string, hook: unknown, pattern?: unknown): Promise<{ ok: boolean; message: string }> {
  if (typeof hook !== 'string' || !hook.trim()) return { ok: false, message: 'Pick an opening.' };
  const r = await editItemCopy(ctx, itemId, { hook: hook.trim() });
  if (r.ok && isHookPattern(pattern)) await ctx.db.query(`update content.content_items set hook_pattern = $2 where id = $1`, [itemId, pattern]);
  return r.ok ? { ok: true, message: 'Opening swapped' } : r;
}
