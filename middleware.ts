// Every /content page and API needs a login (or the x-content-secret header, for cron).
// The resolved role is passed on as `x-content-role`; anything a browser sent under that
// name is dropped first, so routes can trust it (app/content/api/guard.ts reads it).
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, isAdminPath, openMode, roleForPassword, verifySession, type Role } from './app/content/auth';

const PUBLIC = ['/content/login', '/content/api/login'];

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const api = path.startsWith('/content/api/');
  const headers = new Headers(req.headers);
  headers.delete('x-content-role');
  headers.set('x-content-path', path); // the layout needs it (first-run setup redirect)
  const pass = (role?: Role) => {
    if (role) headers.set('x-content-role', role);
    return NextResponse.next({ request: { headers } });
  };

  if (PUBLIC.includes(path)) return pass();
  if (openMode()) {
    if (process.env.NODE_ENV === 'production') return new NextResponse('Set CONTENT_RUN_SECRET before going live.', { status: 503 });
    return pass('admin'); // local dev without a password
  }

  const role = roleForPassword(req.headers.get('x-content-secret')) ?? verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!role) {
    if (api) return NextResponse.json({ ok: false, error: 'locked', locked: true }, { status: 401 });
    const to = new URL('/content/login', req.url);
    to.searchParams.set('next', path + req.nextUrl.search);
    return NextResponse.redirect(to);
  }
  if (role !== 'admin' && isAdminPath(path)) {
    return api ? NextResponse.json({ ok: false, error: 'admin only' }, { status: 403 }) : NextResponse.redirect(new URL('/content', req.url));
  }
  return pass(role);
}

export const config = { matcher: ['/content', '/content/:path*'], runtime: 'nodejs' };
