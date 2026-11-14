// Every /content page and API needs a login (or the x-content-secret header, for cron).
// The resolved role is passed on as `x-content-role`; anything a browser sent under that
// name is dropped first, so routes can trust it (src/app/content/_lib/api-guard.ts reads it).
// Also here: rate limits (secret guessing, money-spending routes) and the CSRF origin check.
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, configProblem, isAdminPath, isCreativeCheckPath, isSpendPath, openMode, roleForSecret, sameOrigin, verifySession, type Role } from '@/app/content/_lib/auth';
import { clientIp, limited } from '@/app/content/_lib/rate-limit';

const PUBLIC = ['/content/login', '/content/api/login'];
const MAX_BODY_BYTES = 60 * 1024 * 1024; // one MP4 (50 MB) plus form overhead
const tooMany = () => NextResponse.json({ ok: false, error: 'Too many requests — wait a minute and try again.' }, { status: 429 });

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const api = path.startsWith('/content/api/');
  // Creative Check is paused; keep its pages, API and saved data available for later.
  if (isCreativeCheckPath(path)) {
    return api
      ? NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 })
      : NextResponse.redirect(new URL('/content', req.url));
  }
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  const headers = new Headers(req.headers);
  headers.delete('x-content-role');
  headers.set('x-content-path', path); // the layout needs it (first-run setup redirect)
  const pass = (role?: Role) => {
    if (role) headers.set('x-content-role', role);
    return NextResponse.next({ request: { headers } });
  };

  if (path === '/content/api/healthz') return pass(); // uptime probe: up/down only, no data
  const problem = configProblem();
  if (problem) return new NextResponse(problem, { status: 503 });
  if (PUBLIC.includes(path)) return pass();
  if (openMode()) return pass('admin'); // `next dev` without a password

  const secret = req.headers.get('x-content-secret');
  // Cap secret guesses per IP; cron makes a handful of calls a minute. No global cap: anyone could
  // trip it and lock cron out, and a 16+ character secret can't be guessed at 20 tries a minute anyway.
  if (secret && limited(`secret:${clientIp(req)}`, 20)) return tooMany();
  const secretRole = roleForSecret(secret, path);
  const role = secretRole ?? verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!role) {
    if (api) return NextResponse.json({ ok: false, error: 'locked', locked: true }, { status: 401 });
    const to = new URL('/content/login', req.url);
    to.searchParams.set('next', path + req.nextUrl.search);
    return NextResponse.redirect(to);
  }
  if (role !== 'admin' && isAdminPath(path)) {
    return api ? NextResponse.json({ ok: false, error: 'admin only' }, { status: 403 }) : NextResponse.redirect(new URL('/content', req.url));
  }
  // Only a matching secret skips the check. Host, not X-Forwarded-Host: Caddy passes Host through,
  // and a client can set X-Forwarded-Host to anything.
  if (write && !secretRole && !sameOrigin(req.headers.get('origin'), req.headers.get('host'))) {
    return NextResponse.json({ ok: false, error: 'Cross-site request refused.' }, { status: 403 });
  }
  if (write && isSpendPath(path) && limited(`spend:${role}`, 30)) return tooMany();
  // Route handlers buffer the whole body before checking file sizes; refuse oversized uploads up front.
  if (write && Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: 'That upload is too large (60 MB max).' }, { status: 413 });
  }
  return pass(role);
}

export const config = { matcher: ['/content', '/content/:path*'], runtime: 'nodejs' };
