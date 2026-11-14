// Costs page (admin): where the money went, from content.cost_events, plus a check of the
// ledger against what OpenRouter and Apify themselves say they billed.
import type { ModuleContext } from '../modules/module.ts';

export const COST_RANGES = ['today', 'yesterday', '7d', '30d', 'month', 'custom'] as const;
export type CostRange = (typeof COST_RANGES)[number];
export const costRange = (s: string | null | undefined): CostRange => (COST_RANGES as readonly string[]).includes(s ?? '') ? (s as CostRange) : '7d';
// ponytail: one install = one Indian client, so days are IST. Make it a CONTENT_* setting when that changes.
const TZ = 'Asia/Kolkata';
/** Provider-side total and ledger total this far apart (and above a cent) is worth a look. */
const GAP_WARN = 0.05;

export interface CostRow { key: string; usd: number; calls: number; failed: number }
export interface CostOp { feature: string; refType: string | null; refId: string | null; usd: number; calls: number; at: string }
export interface Reconcile { source: string; window: string; billed: number; logged: number; partial: boolean; warn: boolean }
export interface Costs {
  from: string; to: string;          // local days, inclusive
  total: number; calls: number; failed: number; untagged: number;
  byProvider: CostRow[]; byFeature: CostRow[]; byModel: CostRow[];
  byDay: { day: string; usd: number }[];
  top: CostOp[];
  units: { items: number; perItem: number | null; published: number; perPublished: number | null; decodes: number; perDecode: number | null };
  ledgerSince: string | null;
  reconcile: Reconcile[];
  reconcileErrors: string[];
}

const localDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d); // YYYY-MM-DD
const isDay = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** A range → [from, to] local days, inclusive. */
export function costDays(range: CostRange, now = new Date(), custom: { from?: string; to?: string } = {}): [string, string] {
  const today = localDay(now);
  const back = (n: number) => localDay(new Date(now.getTime() - n * 86_400_000));
  switch (range) {
    case 'today': return [today, today];
    case 'yesterday': return [back(1), back(1)];
    case '7d': return [back(6), today];
    case '30d': return [back(29), today];
    case 'month': return [`${today.slice(0, 8)}01`, today];
    case 'custom': {
      const f = isDay(custom.from) ? custom.from : today, t = isDay(custom.to) ? custom.to : today;
      return f <= t ? [f, t] : [t, f];
    }
  }
}

// $1 tz, $2 from day, $3 to day (inclusive)
const IN_RANGE = `at >= ($2::date)::timestamp at time zone $1::text and at < ($3::date + 1)::timestamp at time zone $1::text`;
const num = (v: unknown) => Number(v ?? 0);

export async function getCosts(ctx: ModuleContext, range: CostRange, custom: { from?: string; to?: string } = {}): Promise<Costs> {
  const [from, to] = costDays(range, new Date(), custom);
  const p = [TZ, from, to];
  const q = <T>(sql: string) => ctx.db.query<T>(sql, p).then((r) => r.rows);
  const group = (col: string) => q<{ key: string | null; usd: string; calls: string; failed: string }>(
    `select ${col} as key, sum(cost_usd) as usd, count(*) as calls, count(*) filter (where not ok) as failed
     from content.cost_events where ${IN_RANGE} group by 1 order by 2 desc`)
    .then((rows) => rows.map((r) => ({ key: r.key ?? '—', usd: num(r.usd), calls: num(r.calls), failed: num(r.failed) })));

  const [byProvider, byFeature, byModel, byDay, top, units, since] = await Promise.all([
    group('provider'), group('feature'), group('model'),
    q<{ day: string; usd: string }>(
      `select to_char(d, 'YYYY-MM-DD') as day, coalesce(sum(e.cost_usd), 0) as usd
       from generate_series($2::date, $3::date, interval '1 day') d
       left join content.cost_events e on (e.at at time zone $1::text)::date = d::date
       group by d order by d`),
    q<{ feature: string; ref_type: string | null; ref_id: string | null; usd: string; calls: string; at: string }>(
      `select feature, ref_type, ref_id, sum(cost_usd) as usd, count(*) as calls, min(at)::text as at
       from content.cost_events where ${IN_RANGE}
       group by feature, ref_type, ref_id, case when ref_id is null then id end
       order by usd desc limit 20`),
    q<{ items: string; published: string; decodes: string }>(
      `select (select count(*) from content.content_items where created_at >= ($2::date)::timestamp at time zone $1::text and created_at < ($3::date + 1)::timestamp at time zone $1::text) as items,
              (select count(*) from content.content_items where published_at >= ($2::date)::timestamp at time zone $1::text and published_at < ($3::date + 1)::timestamp at time zone $1::text) as published,
              (select count(distinct ref_id) from content.cost_events where ref_type = 'decode_run' and ${IN_RANGE}) as decodes`),
    ctx.db.query<{ since: string | null }>(`select min(at)::text as since from content.cost_events`).then((r) => r.rows[0]?.since ?? null),
  ]);

  const sum = (rows: CostRow[]) => rows.reduce((s, r) => s + r.usd, 0);
  const total = sum(byProvider);
  const decodeUsd = sum(byFeature.filter((r) => r.key === 'decode'));
  const u = units[0]!;
  const per = (usd: number, n: number) => (n ? usd / n : null);
  const { rows: reconcile, errors } = await reconcileProviders(ctx, since);

  return {
    from, to, total,
    calls: byProvider.reduce((s, r) => s + r.calls, 0),
    failed: byProvider.reduce((s, r) => s + r.failed, 0),
    untagged: sum(byFeature.filter((r) => r.key === 'untagged')),
    byProvider, byFeature, byModel,
    byDay: byDay.map((d) => ({ day: d.day, usd: num(d.usd) })),
    top: top.map((t) => ({ feature: t.feature, refType: t.ref_type, refId: t.ref_id, usd: num(t.usd), calls: num(t.calls), at: t.at })),
    units: {
      items: num(u.items), perItem: per(total, num(u.items)),
      published: num(u.published), perPublished: per(total, num(u.published)),
      decodes: num(u.decodes), perDecode: per(decodeUsd, num(u.decodes)),
    },
    ledgerSince: since,
    reconcile, reconcileErrors: errors,
  };
}

// ---- reconcile: the providers' own numbers vs the ledger ----------------------
async function getJson<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return (await res.json()) as T;
}

/** Logged USD for these providers since `start` (and before `end`). */
async function logged(ctx: ModuleContext, providers: string[], start: Date, end?: Date): Promise<number> {
  const r = await ctx.db.query<{ usd: string | null }>(
    `select sum(cost_usd) as usd from content.cost_events where provider = any($1) and at >= $2 and ($3::timestamptz is null or at < $3)`,
    [providers, start.toISOString(), end?.toISOString() ?? null]);
  return num(r.rows[0]?.usd);
}

function row(source: string, window: string, billed: number, loggedUsd: number, start: Date, since: string | null): Reconcile {
  // A window that began before the ledger existed can't match; say so instead of warning.
  const partial = !since || new Date(since) > start;
  const gap = Math.abs(billed - loggedUsd);
  return { source, window, billed, logged: loggedUsd, partial, warn: !partial && gap > 0.01 && gap / Math.max(billed, loggedUsd) > GAP_WARN };
}

async function reconcileProviders(ctx: ModuleContext, since: string | null): Promise<{ rows: Reconcile[]; errors: string[] }> {
  const rows: Reconcile[] = [];
  const errors: string[] = [];
  const now = new Date();
  const utcDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  // Jev goes through the OpenRouter key too (Phase 0), so it's billed there.
  const OR = ['openrouter', 'jev'];

  const { openrouterApiKey: orKey, openrouterMgmtKey: mgmt, apifyToken } = ctx.env;
  if (mgmt) {
    try {
      // Per UTC day, last 30 completed days; show the last 7 with spend.
      const a = await getJson<{ data: { date: string; usage: number }[] }>('https://openrouter.ai/api/v1/activity', mgmt);
      const days = new Map<string, number>();
      for (const d of a.data) days.set(d.date.slice(0, 10), (days.get(d.date.slice(0, 10)) ?? 0) + Number(d.usage ?? 0));
      for (const day of [...days.keys()].sort().reverse().slice(0, 7)) {
        const start = new Date(`${day}T00:00:00Z`);
        rows.push(row('OpenRouter', `${day} (UTC)`, days.get(day)!, await logged(ctx, OR, start, new Date(start.getTime() + 86_400_000)), start, since));
      }
    } catch (e) { errors.push(`OpenRouter activity: ${(e as Error).message}`); }
  }
  if (orKey) {
    try {
      const k = (await getJson<{ data: { usage_daily?: number; usage_weekly?: number; usage_monthly?: number } }>('https://openrouter.ai/api/v1/key', orKey)).data;
      const monday = new Date(utcDay.getTime() - ((utcDay.getUTCDay() + 6) % 7) * 86_400_000);
      const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      for (const [label, billed, start] of [
        ['today (UTC)', k.usage_daily, utcDay], ['this week (UTC, from Mon)', k.usage_weekly, monday], ['this month (UTC)', k.usage_monthly, month],
      ] as const) {
        if (billed != null) rows.push(row('OpenRouter', label, Number(billed), await logged(ctx, OR, start), start, since));
      }
    } catch (e) { errors.push(`OpenRouter key: ${(e as Error).message}`); }
  }
  if (apifyToken) {
    try {
      const m = (await getJson<{ data: { usageCycle?: { startAt: string }; dailyServiceUsages?: { date: string; totalUsageCreditsUsd: number }[] } }>(
        'https://api.apify.com/v2/users/me/usage/monthly', apifyToken)).data;
      const daily = m.dailyServiceUsages ?? [];
      for (const d of daily.slice(-3).reverse()) {
        const start = new Date(d.date);
        rows.push(row('Apify', `${d.date.slice(0, 10)} (UTC)`, Number(d.totalUsageCreditsUsd), await logged(ctx, ['apify'], start, new Date(start.getTime() + 86_400_000)), start, since));
      }
      const cycle = new Date(m.usageCycle?.startAt ?? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      rows.push(row('Apify', 'billing cycle so far', daily.reduce((s, d) => s + Number(d.totalUsageCreditsUsd), 0), await logged(ctx, ['apify'], cycle), cycle, since));
    } catch (e) { errors.push(`Apify usage: ${(e as Error).message}`); }
  }
  return { rows, errors };
}

// ---- CSV export -----------------------------------------------------------------
const cell = (v: unknown) => {
  let s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`; // error text is third-party: never a formula
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function costsCsv(ctx: ModuleContext, range: CostRange, custom: { from?: string; to?: string } = {}): Promise<string> {
  const [from, to] = costDays(range, new Date(), custom);
  const cols = ['at', 'provider', 'kind', 'feature', 'model', 'ref_type', 'ref_id', 'input_tokens', 'output_tokens', 'units', 'cost_usd', 'ok', 'error', 'meta'];
  const { rows } = await ctx.db.query<Record<string, unknown>>(
    `select ${cols.join(', ')} from content.cost_events where ${IN_RANGE} order by at`, [TZ, from, to]);
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c] instanceof Date ? (r[c] as Date).toISOString() : r[c])).join(','))].join('\n') + '\n';
}
