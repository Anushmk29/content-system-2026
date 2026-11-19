import { getContext, runModules, MODULES } from '@pratapai/content-pipeline';
import { handle } from '@/app/content/_lib/api-guard';
import { runResponse } from '@/app/content/_lib/run-response';

// A full run can take many minutes; scheduled runs should use the CLI (npm run pipeline), see docs/operations/DEPLOY.md.
export const maxDuration = 800;

// POST /content/api/run  → run the whole pipeline once. A module already running elsewhere is skipped.
// Protected by CONTENT_RUN_SECRET when set: send it as `x-content-secret`.
export const POST = handle(async (req: Request) => runResponse(req, runModules(MODULES, await getContext())));
