import { NextResponse } from 'next/server';
import { getContext, logAction } from '@pratapai/content-pipeline';
import { SESSION_COOKIE, SESSION_DAYS, roleForPassword, signSession } from '../../auth';
import { clientIp, limited } from '../../rate-limit';

// Behind a TLS-terminating proxy req.url says http:, so production always marks the cookie Secure.
const cookie = (req: Request) => ({
  httpOnly: true, sameSite: 'lax' as const, path: '/content',
  secure: process.env.NODE_ENV === 'production' || new URL(req.url).protocol === 'https:',
});

// POST /content/api/login { password } → session cookie. DELETE → log out.
export async function POST(req: Request) {
  // Per IP. No global cap: anyone could trip it and lock every user out. Production refuses
  // passwords under 16 characters (auth.ts configProblem), so per-IP limits are enough.
  if (limited(`login:${clientIp(req)}`, 10)) {
    return NextResponse.json({ ok: false, error: 'Too many tries — wait a minute.' }, { status: 429 });
  }
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  const role = roleForPassword(typeof password === 'string' ? password : null);
  if (!role) return NextResponse.json({ ok: false, error: 'Wrong password.' }, { status: 401 });
  if (role === 'client') void logAction(getContext(), { role, method: 'LOGIN', path: '/content/login' });
  const res = NextResponse.json({ ok: true, role });
  res.cookies.set(SESSION_COOKIE, signSession(role), { ...cookie(req), maxAge: SESSION_DAYS * 86_400 });
  return res;
}

export async function DELETE(req: Request) {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { ...cookie(req), maxAge: 0 });
  return res;
}
