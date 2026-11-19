import { NextResponse } from 'next/server';
import { getContext, getPipelineBoard } from '@pratapai/content-pipeline';
import { handle } from '@/app/content/_lib/api-guard';

export const GET = handle(async () => NextResponse.json(await getPipelineBoard((await getContext()))));
