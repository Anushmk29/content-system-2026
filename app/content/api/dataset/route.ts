import { getContext, exportDataset } from '@pratapai/content-pipeline';
import { handle } from '../guard';

// GET /content/api/dataset → training dataset as JSONL download.
//   ?queue=1          only Jev-vs-LLM disagreements you haven't labelled yet
//   ?workspace=<id>   per-customer slice (default 'default')
// Admin only (the engine's training data), see middleware.ts.
export const GET = handle(async (req: Request) => {
  const ctx = getContext();
  const url = new URL(req.url);
  const body = await exportDataset(ctx, {
    workspace: url.searchParams.get('workspace') ?? undefined,
    queue: url.searchParams.get('queue') === '1',
  });
  return new Response(body, {
    headers: {
      'content-type': 'application/x-ndjson',
      'content-disposition': 'attachment; filename="decisions.jsonl"',
    },
  });
}, { admin: true });
