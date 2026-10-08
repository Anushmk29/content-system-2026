// Second line behind middleware.ts: routes that spend tokens or change content check the
// role middleware resolved from the login cookie (or x-content-secret for cron).
import { NextResponse } from 'next/server';
import { getContext, logAction } from '@pratapai/content-pipeline';
import { openMode } from '../auth';

const roleOf = (req: Request) => req.headers.get('x-content-role');

/** Null when the request may proceed, else the 401/403 to return. The admin only watches:
 *  any change to the client's account is refused. Every client change is logged for the admin. */
export function denied(req: Request): NextResponse | null {
  const r = roleOf(req);
  if (r !== 'client' && r !== 'admin') return NextResponse.json({ ok: false, error: 'locked', locked: true }, { status: 401 });
  if (req.method === 'GET') return null;
  // Local dev with no passwords set runs as admin and must still be able to change things.
  if (r === 'admin' && !openMode()) return NextResponse.json({ ok: false, error: 'View only: the admin login can’t change the client’s account.' }, { status: 403 });
  void logAction(getContext(), { role: r, method: req.method, path: new URL(req.url).pathname });
  return null;
}

/** Same, but admin only. */
export function deniedAdmin(req: Request): NextResponse | null {
  return roleOf(req) === 'admin' ? null : NextResponse.json({ ok: false, error: 'admin only' }, { status: 403 });
}

/** Postgres errors carry `severity` + a 5-char SQLSTATE `code`; their text names tables and columns. */
const isDbError = (e: unknown) =>
  !!e && typeof e === 'object' && 'severity' in e && typeof (e as { code?: unknown }).code === 'string';

/** A route handler behind denied() (or deniedAdmin with `admin`); a throw becomes a 400 `{ ok: false, [key]: message }`.
 *  Database errors are logged and replaced by a generic message so schema details never reach the browser. */
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
        console.error(`[content] ${req.method} ${new URL(req.url).pathname}:`, e);
        return NextResponse.json({ ok: false, [opts.key ?? 'error']: 'Something went wrong saving that. It has been logged.' }, { status: 500 });
      }
      return NextResponse.json({ ok: false, [opts.key ?? 'error']: (e as Error).message }, { status: 400 });
    }
  };
}
