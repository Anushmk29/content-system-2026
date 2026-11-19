// Second line behind src/middleware.ts: routes that spend tokens or change content check the
// role middleware resolved from the login cookie (or x-content-secret for cron).
import { NextResponse } from 'next/server';
import { buildContext, logAction } from '@pratapai/content-pipeline';
import { openMode } from './auth';

const roleOf = (req: Request) => req.headers.get('x-content-role');

/** Null when the request may proceed, else the 401/403 to return. The admin only watches:
 *  any change to the client's account is refused. Every client change is logged for the admin. */
function denied(req: Request): NextResponse | null {
  const r = roleOf(req);
  if (r !== 'client' && r !== 'admin') return NextResponse.json({ ok: false, error: 'locked', locked: true }, { status: 401 });
  if (req.method === 'GET' || req.method === 'HEAD') return null;
  // Local dev with no passwords set runs as admin and must still be able to change things.
  if (r === 'admin' && !openMode()) return NextResponse.json({ ok: false, error: 'View only: the admin login can’t change the client’s account.' }, { status: 403 });
  void logAction(buildContext(), { role: r, method: req.method, path: new URL(req.url).pathname });
  return null;
}

/** Same, but admin only. */
function deniedAdmin(req: Request): NextResponse | null {
  return roleOf(req) === 'admin' ? null : NextResponse.json({ ok: false, error: 'admin only' }, { status: 403 });
}

/** Postgres errors carry `severity` + a 5-char SQLSTATE `code`; their text names tables and columns. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isDbError = (e: unknown) =>
  !!e && typeof e === 'object' && 'severity' in e && typeof (e as { code?: unknown }).code === 'string';

/** A provider we call failed or timed out: not the caller's fault, so a 5xx, not a 400. */
const UPSTREAM = /^(OpenRouter|Anthropic|Postiz|Apify|Jev|TinyFish|YouTube)\b/;
function statusOf(e: unknown): number {
  const err = e as { name?: string; message?: string };
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 504;
  if (err?.name === 'BudgetExceeded') return 429;
  if (err?.message === 'Not found.') return 404;
  if (UPSTREAM.test(err?.message ?? '') || err?.message === 'fetch failed') return 502;
  return 400;
}

/** A route handler behind denied() (or deniedAdmin with `admin`). A throw becomes `{ ok: false, [key]: message }`:
 *  400 for bad input, 5xx when a provider failed. Database errors are logged and replaced by a generic
 *  message so schema details never reach the browser; a malformed id is a 404. */
export function handle<A extends unknown[]>(
  fn: (req: Request, ...rest: A) => Promise<Response>,
  opts: { admin?: boolean; key?: 'error' | 'message' } = {},
) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    const no = (opts.admin ? deniedAdmin : denied)(req);
    if (no) return no;
    try {
      return await fn(req, ...rest);
    } catch (e) {
      if (isDbError(e)) {
        // 22P02 = text that isn't a valid uuid/enum/number; 22021 = a NUL byte in it. From a malformed id in the URL that's a 404; from the body, bad input.
        if (['22P02', '22021'].includes((e as { code: string }).code)) {
          const params = await (rest[0] as { params?: Promise<Record<string, string>> } | undefined)?.params;
          const badId = Object.values(params ?? {}).some((v) => !UUID.test(v));
          return NextResponse.json({ ok: false, [opts.key ?? 'error']: badId ? 'Not found.' : 'One of the values sent isn’t valid.' }, { status: badId ? 404 : 400 });
        }
        console.error(`[content] ${req.method} ${new URL(req.url).pathname}:`, e);
        return NextResponse.json({ ok: false, [opts.key ?? 'error']: 'Something went wrong saving that. It has been logged.' }, { status: 500 });
      }
      // A TypeError is our code tripping over a body of the wrong shape (null, [], a string): its text
      // describes our internals, not the caller's mistake.
      if (e instanceof TypeError) {
        console.error(`[content] ${req.method} ${new URL(req.url).pathname}:`, e.message);
        return NextResponse.json({ ok: false, [opts.key ?? 'error']: 'That request isn’t valid.' }, { status: 400 });
      }
      const status = statusOf(e);
      if (status >= 500) console.error(`[content] ${req.method} ${new URL(req.url).pathname}:`, (e as Error).message);
      return NextResponse.json({ ok: false, [opts.key ?? 'error']: (e as Error).message }, { status });
    }
  };
}
