// Every /content page and API needs a login (or the x-content-secret header, for cron).
// The resolved role is passed on as `x-content-role`; anything a browser sent under that
// name is dropped first, so routes can trust it (app/content/api/guard.ts reads it).
// Also here: rate limits (secret guessing, money-spending routes) and the CSRF origin check.
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, isAdminPath, isSpendPath, openMode, roleForSecret, sameOrigin, verifySession, type Role } from './app/content/auth';
import { clientIp, limited } from './app/content/rate-limit';

const PUBLIC = ['/content/login', '/content/api/login'];
const tooMany = () => NextResponse.json({ ok: false, error: 'Too many requests — wait a minute and try again.' }, { status: 429 });

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const api = path.startsWith('/content/api/');
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
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

  const secret = req.headers.get('x-content-secret');
  // Cap secret guesses per IP; cron makes a handful of calls a minute.
  if (secret && limited(`secret:${clientIp(req)}`, 20)) return tooMany();
  const role = roleForSecret(secret, path) ?? verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!role) {
    if (api) return NextResponse.json({ ok: false, error: 'locked', locked: true }, { status: 401 });
    const to = new URL('/content/login', req.url);
    to.searchParams.set('next', path + req.nextUrl.search);
    return NextResponse.redirect(to);
  }
  if (role !== 'admin' && isAdminPath(path)) {
    return api ? NextResponse.json({ ok: false, error: 'admin only' }, { status: 403 }) : NextResponse.redirect(new URL('/content', req.url));
  }
  if (write && !secret && !sameOrigin(req.headers.get('origin'), req.headers.get('x-forwarded-host') ?? req.headers.get('host'))) {
    return NextResponse.json({ ok: false, error: 'Cross-site request refused.' }, { status: 403 });
  }
  if (write && isSpendPath(path) && limited(`spend:${role}`, 30)) return tooMany();
  return pass(role);
}

export const config = { matcher: ['/content', '/content/:path*'], runtime: 'nodejs' };
