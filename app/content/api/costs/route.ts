import { getContext, costsCsv, COST_RANGES, type CostRange } from '@pratapai/content-pipeline';
import { handle } from '../guard';

// GET /content/api/costs?range=7d (or range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD)
// → the cost ledger rows for that range as CSV. Admin only (also in middleware.ts).
export const GET = handle(async (req) => {
  const url = new URL(req.url);
  const r = url.searchParams.get('range') ?? '7d';
  const range: CostRange = (COST_RANGES as readonly string[]).includes(r) ? (r as CostRange) : '7d';
  const body = await costsCsv(getContext(), range, { from: url.searchParams.get('from') ?? undefined, to: url.searchParams.get('to') ?? undefined });
  return new Response(body, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="costs-${range}.csv"` },
  });
}, { admin: true });
