import { NextResponse } from 'next/server';
import { getContext, runModules, MODULES } from '@pratapai/content-pipeline';
import { handle } from '../guard';

// A full run can take many minutes; scheduled runs should use the CLI (npm run pipeline), see docs/DEPLOY.md.
export const maxDuration = 800;

// POST /content/api/run  → run the whole pipeline once. A module already running elsewhere is skipped.
// Protected by CONTENT_RUN_SECRET when set: send it as `x-content-secret`.
export const POST = handle(async () => NextResponse.json(await runModules(MODULES, getContext())));
