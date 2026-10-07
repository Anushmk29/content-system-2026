import { NextResponse } from 'next/server';
import { SESSION_COOKIE, SESSION_DAYS, roleForPassword, signSession } from '../../auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const cookie = (req: Request) => ({
  httpOnly: true, sameSite: 'lax' as const, path: '/content',
  secure: new URL(req.url).protocol === 'https:',
});

// POST /content/api/login { password } → session cookie. DELETE → log out.
export async function POST(req: Request) {
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  const role = roleForPassword(typeof password === 'string' ? password : null);
  if (!role) return NextResponse.json({ ok: false, error: 'Wrong password.' }, { status: 401 });
  const res = NextResponse.json({ ok: true, role });
  res.cookies.set(SESSION_COOKIE, signSession(role), { ...cookie(req), maxAge: SESSION_DAYS * 86_400 });
  return res;
}

export async function DELETE(req: Request) {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { ...cookie(req), maxAge: 0 });
  return res;
}
