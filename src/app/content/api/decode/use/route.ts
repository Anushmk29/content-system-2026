import { NextResponse } from 'next/server';
import { getContext, useDecode, stealFormat, isVisualKind } from '@pratapai/content-pipeline';
import { handle } from '@/app/content/_lib/api-guard';

export const maxDuration = 300;

const MAX_BYTES = 15 * 1024 * 1024;

// POST /content/api/decode/use
// Body: { formatId? | postId?, mode: 'use' | 'counter' | 'steal', platforms?: string[], styleId? }.
// use/counter → an Ideas signal (`counter` spends one LLM call). steal → our own drafts for the
// chosen platforms, checked and waiting in Approvals (one draft call + QC, about a minute).
// Recreate = steal sent as multipart, plus kind ('image' | 'carousel'), fromPost (their images),
// file × 0-10 (more images to copy) and saveAsExample (a name: keep those images as an example).
export const POST = handle(async (req: Request) => {
  let b: Record<string, unknown>, refs: Buffer[] = [];
  if ((req.headers.get('content-type') ?? '').startsWith('multipart/')) {
    const form = await req.formData();
    const files = form.getAll('file').filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length > 10) throw new Error('At most 10 images.');
    if (files.some((f) => f.size > MAX_BYTES)) throw new Error('An image is over 15 MB.');
    refs = await Promise.all(files.map(async (f) => Buffer.from(await f.arrayBuffer())));
    b = { ...Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string')), platforms: form.getAll('platforms') };
  } else {
    b = (await req.json()) as Record<string, unknown>;
  }
  const target = {
    formatId: typeof b.formatId === 'string' ? b.formatId : undefined,
    postId: typeof b.postId === 'string' ? b.postId : undefined,
  };
  if (b.mode === 'steal') {
    const r = await stealFormat((await getContext()), {
      ...target,
      platforms: Array.isArray(b.platforms) ? b.platforms.filter((p): p is string => typeof p === 'string') : [],
      styleId: typeof b.styleId === 'string' && b.styleId ? b.styleId : undefined,
      kind: isVisualKind(b.kind) ? b.kind : undefined,
      fromPost: b.fromPost === '1' || b.fromPost === true,
      refs: refs.length ? refs : undefined,
      saveAsExample: typeof b.saveAsExample === 'string' ? b.saveAsExample : undefined,
    });
    const parts = [
      `${r.items} post${r.items === 1 ? '' : 's'} written`,
      r.toApproval ? `${r.toApproval} waiting in Approvals` : '',
      r.needProof ? `${r.needProof} need proof for a number first (Board)` : '',
      r.creativeErrors.length ? `creative failed — ${r.creativeErrors.join('; ')}` : '',
      r.exampleId ? 'their images saved as an example' : '',
    ].filter(Boolean);
    return NextResponse.json({ ok: true, ...r, status: r.creativeErrors.length ? 'degraded' : 'ok', message: `${parts.join(' · ')} · $${r.costUsd.toFixed(2)}` });
  }
  const mode = b.mode === 'counter' ? 'counter' : 'use';
  const out = await useDecode((await getContext()), { ...target, mode });
  return NextResponse.json({ ok: true, ...out, message: mode === 'use' ? 'Added to Ideas' : 'Counter-angle added to Ideas' });
});
