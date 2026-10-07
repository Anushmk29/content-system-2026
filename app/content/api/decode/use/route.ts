import { NextResponse } from 'next/server';
import { getContext, useDecode, stealFormat } from '@pratapai/content-pipeline';
import { denied } from '../../guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// POST /content/api/decode/use
// Body: { formatId? | postId?, mode: 'use' | 'counter' | 'steal', platforms?: string[], styleId? }.
// use/counter → an Ideas signal (`counter` spends one LLM call). steal → our own drafts for the
// chosen platforms, checked and waiting in Approvals (one draft call + QC, about a minute).
export async function POST(req: Request) {
  const no = denied(req);
  if (no) return no;
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const target = {
      formatId: typeof b.formatId === 'string' ? b.formatId : undefined,
      postId: typeof b.postId === 'string' ? b.postId : undefined,
    };
    if (b.mode === 'steal') {
      const r = await stealFormat(getContext(), {
        ...target,
        platforms: Array.isArray(b.platforms) ? b.platforms.filter((p): p is string => typeof p === 'string') : [],
        styleId: typeof b.styleId === 'string' && b.styleId ? b.styleId : undefined,
      });
      const parts = [
        `${r.items} post${r.items === 1 ? '' : 's'} written`,
        r.toApproval ? `${r.toApproval} waiting in Approvals` : '',
        r.needProof ? `${r.needProof} need proof for a number first (Board)` : '',
        r.creativeErrors.length ? `creative failed — ${r.creativeErrors.join('; ')}` : '',
      ].filter(Boolean);
      return NextResponse.json({ ok: true, ...r, status: r.creativeErrors.length ? 'degraded' : 'ok', message: `${parts.join(' · ')} · $${r.costUsd.toFixed(2)}` });
    }
    const mode = b.mode === 'counter' ? 'counter' : 'use';
    const out = await useDecode(getContext(), { ...target, mode });
    return NextResponse.json({ ok: true, ...out, message: mode === 'use' ? 'Added to Ideas' : 'Counter-angle added to Ideas' });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
