// Idea board, item detail drawer, copy edits and posting-time planning.
// An "idea" is an anchor plus every platform copy repurposed from it (anchor_id), so the
// board shows one card per idea instead of one row per platform.
import type { ModuleContext } from '../modules/module.ts';
import {
  createRepo, type ContentItemRow, type ClaimRow, type ApprovalLogRow, type PerformanceRow,
} from '../db/repo.ts';
import { CONTENT_STATUSES } from '../../core/src/index.ts';

export interface IdeaPiece {
  id: string;
  platform: string;
  status: string;
  scheduled_at: string | null;
  published_at: string | null;
}

export interface IdeaCard {
  id: string;             // the anchor's id
  title: string;
  pillar: string;
  funnelStage: string;
  owner: string | null;
  /** Least-advanced live stage across its pieces: the card sits where work is still owed. */
  stage: string;
  pieces: IdeaPiece[];
  createdAt: string;
  updatedAt: string;
}

// pg returns timestamps as Date objects even where rows are typed string; normalise to ISO.
const iso = (v: unknown): string => new Date(v as string).toISOString();
const isoOrNull = (v: unknown): string | null => (v == null ? null : iso(v));

const rank = (s: string) => CONTENT_STATUSES.indexOf(s as (typeof CONTENT_STATUSES)[number]);

/** Group items into idea cards, newest activity first. Pure, so it's unit-tested directly. */
export function groupIdeas(items: ContentItemRow[]): IdeaCard[] {
  const groups = new Map<string, ContentItemRow[]>();
  for (const it of items) {
    const key = it.anchor_id ?? it.id;
    groups.set(key, [...(groups.get(key) ?? []), it]);
  }
  const cards: IdeaCard[] = [];
  for (const [id, rows] of groups) {
    const anchor = rows.find((r) => r.id === id) ?? rows[0]!;
    const live = rows.filter((r) => r.status !== 'archived');
    const stage = live.length ? live.reduce((a, r) => (rank(r.status) < rank(a) ? r.status : a), live[0]!.status) : 'archived';
    const times = rows.map((r) => iso(r.updated_at ?? r.created_at)).sort();
    cards.push({
      id, title: anchor.title, pillar: anchor.pillar ?? '', funnelStage: anchor.funnel_stage ?? '',
      owner: anchor.owner ?? null, stage,
      pieces: rows.map((r) => ({
        id: r.id, platform: r.platform, status: r.status,
        scheduled_at: isoOrNull(r.scheduled_at), published_at: isoOrNull(r.published_at),
      })),
      createdAt: iso(anchor.created_at), updatedAt: times[times.length - 1]!,
    });
  }
  return cards.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export interface IdeaBoard {
  ideas: IdeaCard[];
  columns: { status: string; ideas: IdeaCard[] }[];
}

export async function getIdeaBoard(ctx: ModuleContext): Promise<IdeaBoard> {
  const ideas = groupIdeas(await createRepo(ctx.db).allItems());
  return { ideas, columns: CONTENT_STATUSES.map((status) => ({ status, ideas: ideas.filter((i) => i.stage === status) })) };
}

export interface ItemDetail {
  item: ContentItemRow;
  pieces: ContentItemRow[];
  claims: ClaimRow[];
  approvals: ApprovalLogRow[];
  performance: PerformanceRow | null;
}

export async function getItemDetail(ctx: ModuleContext, id: string): Promise<ItemDetail | null> {
  const repo = createRepo(ctx.db);
  const item = await repo.getItem(id);
  if (!item) return null;
  const [pieces, claims, approvals, performance] = await Promise.all([
    repo.ideaPieces(item.anchor_id ?? item.id), repo.claimsFor(id), repo.approvalsFor(id), repo.performanceFor(id),
  ]);
  return { item, pieces, claims, approvals, performance };
}

const MAX_COPY = 20_000;

/** Edit hook/body/CTA from the drawer. Refused once the item is approved (the reviewer signed that text). */
export async function editItemCopy(
  ctx: ModuleContext, id: string, patch: { hook?: unknown; body?: unknown; cta?: unknown },
): Promise<{ ok: boolean; message: string }> {
  const clean: Record<string, string> = {};
  for (const k of ['hook', 'body', 'cta'] as const) {
    const v = patch[k];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string' || v.length > MAX_COPY) return { ok: false, message: `${k} must be text under ${MAX_COPY} chars` };
    clean[k] = v;
  }
  if (!Object.keys(clean).length) return { ok: false, message: 'Nothing to save.' };
  const row = await createRepo(ctx.db).updateItemCopy(id, clean);
  return row ? { ok: true, message: 'Saved' } : { ok: false, message: 'Copy is locked once approved (or item not found).' };
}

/** Set the posting time for an approved item that hasn't gone to Postiz; the publisher honours it. */
export async function planItem(ctx: ModuleContext, id: string, at: unknown): Promise<{ ok: boolean; message: string }> {
  const when = typeof at === 'string' ? new Date(at) : null;
  if (!when || Number.isNaN(when.getTime())) return { ok: false, message: 'Invalid date.' };
  if (when.getTime() < Date.now()) return { ok: false, message: 'Pick a time in the future.' };
  const done = await createRepo(ctx.db).planItem(id, when.toISOString());
  return done
    ? { ok: true, message: `Planned for ${when.toISOString()}` }
    : { ok: false, message: 'Only approved items not yet sent to Postiz can be rescheduled here.' };
}

export interface CalendarData {
  /** Items with a planned, scheduled or published time in [from, to). */
  dated: (ContentItemRow & { at: string })[];
  /** Approved, not yet timed: drag onto a day to plan. */
  unplanned: ContentItemRow[];
}

export async function getCalendar(ctx: ModuleContext, from: Date, to: Date): Promise<CalendarData> {
  const items = await createRepo(ctx.db).allItems(1000);
  const dated: CalendarData['dated'] = [];
  for (const it of items) {
    const raw = it.published_at ?? it.scheduled_at;
    if (!raw) continue;
    const t = new Date(raw);
    if (t >= from && t < to) dated.push({ ...it, at: t.toISOString() });
  }
  const unplanned = items.filter((i) => i.status === 'approved' && !i.scheduled_at && !i.postiz_id);
  return { dated: dated.sort((a, b) => (a.at < b.at ? -1 : 1)), unplanned };
}
