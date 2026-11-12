import { NextResponse } from 'next/server';
import { getContext, getPipelineBoard } from '@pratapai/content-pipeline';
import { handle } from '../guard';

export const GET = handle(async () => NextResponse.json(await getPipelineBoard(getContext())));
