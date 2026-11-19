import { getContext, costsCsv, costRange } from '@pratapai/content-pipeline';
import { handle } from '@/app/content/_lib/api-guard';

// GET /content/api/costs?range=7d (or range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD)
// → the cost ledger rows for that range as CSV. Admin only (also in src/middleware.ts).
export const GET = handle(async (req) => {
  const url = new URL(req.url);
  const range = costRange(url.searchParams.get('range'));
  const body = await costsCsv((await getContext()), range, { from: url.searchParams.get('from') ?? undefined, to: url.searchParams.get('to') ?? undefined });
  return new Response(body, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="costs-${range}.csv"` },
  });
}, { admin: true });
