// The founder's feedback, put to work:
//  1. reviseItem — "Request changes" rewrites that one post with the feedback (one LLM call);
//     nothing upstream re-runs, and QC then reads the new text (the decision cache only skips
//     unchanged text).
//  2. refreshLessons — every few review notes, the notes are condensed into at most 10 standing
//     rules saved on the brand kit; brand-context.ts adds them to every draft. This is the
//     system's memory of what the founder wants (retrieval of past feedback, not a trained model).
import type { ModuleContext } from '../modules/module.ts';
import { createRepo, type ContentItemRow } from '../db/repo.ts';
import { parseJsonObject } from '../modules/llm-json.ts';
import { brandSystem } from '../prompts/brand-context.ts';
import { buildRevisePrompt, buildLessonsPrompt, LESSONS_SYSTEM, CHANGE_REASONS } from '../prompts/feedback.ts';
import { loadBrand } from './brand-service.ts';

/** New notes needed before the rules are re-learned. */
const NOTES_PER_REFRESH = 3;
const MAX_RULES = 10;

/** Picked reasons + the typed note → one feedback text. Unknown reasons are dropped. */
export function feedbackText(reasons: unknown, note: string | null | undefined): string {
  const picked = Array.isArray(reasons) ? reasons.filter((r): r is string => (CHANGE_REASONS as readonly string[]).includes(r)) : [];
  return [picked.join(', '), note?.trim()].filter(Boolean).join('. ');
}

/** Rewrite one draft from the feedback. Throws on an LLM or parse failure (the caller keeps the old text). */
export async function reviseItem(ctx: ModuleContext, item: ContentItemRow, feedback: string): Promise<ContentItemRow> {
  if (!ctx.adapters.claude.configured) throw new Error('No AI model is configured.');
  await loadBrand(ctx);
  const raw = await ctx.adapters.claude.complete(
    buildRevisePrompt({ platform: item.platform, title: item.title, hook: item.hook ?? null, body: item.body, cta: item.cta, feedback }),
    { system: brandSystem(), maxTokens: 4000 });
  const o = parseJsonObject(raw);
  const pick = (k: string) => (typeof o[k] === 'string' && (o[k] as string).trim() ? (o[k] as string).trim() : undefined);
  const body = pick('body');
  if (!body) throw new Error('the rewrite came back empty');
  const row = await createRepo(ctx.db).updateItemCopy(item.id, { hook: pick('hook'), body, cta: pick('cta') });
  if (!row) throw new Error('the post is no longer editable');
  return row;
}

/** Re-learn the standing rules when enough new notes came in since the last time. Never throws. */
export async function refreshLessons(ctx: ModuleContext, opts: { force?: boolean } = {}): Promise<boolean> {
  try {
    if (!ctx.adapters.claude.configured) return false;
    const kit = await ctx.db.query<{ fresh: number }>(
      `select count(a.*)::int as fresh from content.brand_kit bk
         left join content.approvals a on a.decision in ('changes_requested', 'rejected') and coalesce(a.note, '') <> ''
          and (bk.learned_at is null or a.created_at > bk.learned_at)
        where bk.id group by bk.id`);
    if (!kit.rows.length) return false; // no brand saved yet
    const fresh = kit.rows[0]!.fresh;
    const notes = (await ctx.db.query<{ platform: string; decision: string; note: string }>(
      `select ci.platform::text as platform, a.decision::text as decision, a.note
         from content.approvals a join content.content_items ci on ci.id = a.content_item_id
        where a.decision in ('changes_requested', 'rejected') and coalesce(a.note, '') <> ''
        order by a.created_at desc limit 40`)).rows;
    if (!notes.length || (!opts.force && fresh < NOTES_PER_REFRESH)) return false;

    const b = await loadBrand(ctx);
    const raw = await ctx.adapters.claude.complete(
      buildLessonsPrompt(b.learnedRules, notes.map((n) => ({ platform: n.platform, decision: n.decision === 'rejected' ? 'rejected' : 'changes', note: n.note }))),
      { system: LESSONS_SYSTEM, maxTokens: 1200 });
    const list = parseJsonObject(raw).rules;
    if (!Array.isArray(list)) return false; // an unusable reply never wipes the rules already learned
    const rules = (Array.isArray(list) ? list : []).filter((r): r is string => typeof r === 'string' && !!r.trim())
      .map((r) => r.trim().slice(0, 160)).slice(0, MAX_RULES);
    await ctx.db.query(`update content.brand_kit set learned_rules = $1, learned_at = now() where id`, [JSON.stringify(rules)]);
    await loadBrand(ctx);
    return true;
  } catch (e) {
    ctx.logger.warn(`learning from feedback failed: ${(e as Error).message}`);
    return false;
  }
}
