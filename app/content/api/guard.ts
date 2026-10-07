// Second line behind middleware.ts: routes that spend tokens or change content check the
// role middleware resolved from the login cookie (or x-content-secret for cron).
import { NextResponse } from 'next/server';

const roleOf = (req: Request) => req.headers.get('x-content-role');

/** Null when the request may proceed, else the 401 to return. */
export function denied(req: Request): NextResponse | null {
  const r = roleOf(req);
  return r === 'client' || r === 'admin' ? null : NextResponse.json({ ok: false, error: 'locked', locked: true }, { status: 401 });
}

/** Same, but admin only. */
export function deniedAdmin(req: Request): NextResponse | null {
  return roleOf(req) === 'admin' ? null : NextResponse.json({ ok: false, error: 'admin only' }, { status: 403 });
}
