// Login for a single-client install: one password for the client, one for the admin (us).
// The session is a signed cookie `role.expiry.sig`, keyed on CONTENT_SESSION_KEY plus both
// passwords: changing any of them logs everyone out.
// No dependency: node:crypto only. Read by middleware.ts (Node runtime) and the login route.
import { createHmac, timingSafeEqual } from 'node:crypto';

export type Role = 'client' | 'admin';
export const SESSION_COOKIE = 'content_session';
export const SESSION_DAYS = 7;

const secret = (name: string) => process.env[name]?.trim() || '';
const clientPw = () => secret('CONTENT_RUN_SECRET');
const adminPw = () => secret('CONTENT_ADMIN_SECRET');

function same(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** No client password configured: `next dev` runs open, anything else refuses to serve. */
export const openMode = () => !clientPw();

/** Why this install must not serve outside `next dev`, or null when it may. */
export function configProblem(nodeEnv = process.env.NODE_ENV): string | null {
  if (nodeEnv === 'development') return null;
  if (!clientPw()) return 'Set CONTENT_RUN_SECRET before going live.';
  if (!secret('CONTENT_DATABASE_URL')) return 'Set CONTENT_DATABASE_URL before going live.';
  if (clientPw().length < 16 || (adminPw() && adminPw().length < 16)) return 'CONTENT_RUN_SECRET and CONTENT_ADMIN_SECRET must be at least 16 characters.';
  if (secret('CONTENT_SESSION_KEY').length < 32) return 'Set CONTENT_SESSION_KEY to 32+ random characters (openssl rand -hex 32).';
  return null;
}

/** Admin password wins if both match; null when it matches neither. */
export function roleForPassword(given: string | null | undefined): Role | null {
  if (!given) return null;
  if (adminPw() && same(given, adminPw())) return 'admin';
  if (clientPw() && same(given, clientPw())) return 'client';
  return null;
}

/** Cron routes. With CONTENT_CRON_SECRET set, cron uses that instead of a login password. */
const RUN_PATH = /^\/content\/api\/(run|modules\/[^/]+\/run)$/;

/** The x-content-secret header → role. The cron secret only opens the run routes, as the client. */
export function roleForSecret(given: string | null | undefined, path: string): Role | null {
  const cron = secret('CONTENT_CRON_SECRET');
  if (given && cron && RUN_PATH.test(path) && same(given, cron)) return 'client';
  return roleForPassword(given);
}

const sig = (body: string) =>
  createHmac('sha256', `${secret('CONTENT_SESSION_KEY')}\0${clientPw()}\0${adminPw()}`).update(body).digest('base64url');

export function signSession(role: Role, now = Date.now()): string {
  const body = `${role}.${now + SESSION_DAYS * 86_400_000}`;
  return `${body}.${sig(body)}`;
}

export function verifySession(token: string | null | undefined, now = Date.now()): Role | null {
  const [role, exp, s] = (token ?? '').split('.');
  if ((role !== 'client' && role !== 'admin') || !exp || !s) return null;
  if (!same(s, sig(`${role}.${exp}`)) || Number(exp) < now) return null;
  return role;
}

/** Pages and routes only the admin sees: engine health, run log, Jev training data, spend. */
const ADMIN_PATHS = ['/content/system', '/content/training', '/content/costs', '/content/api/dataset', '/content/api/decisions', '/content/api/costs'];
export const isAdminPath = (p: string) => ADMIN_PATHS.some((a) => p === a || p.startsWith(`${a}/`));

/** Writes that spend money (LLM, Jev, Apify, image model) — rate limited in middleware. */
const SPEND_PATH = /^\/content\/api\/(run|modules\/[^/]+\/run|styles(\/[^/]+)?|brand\/voice|decode(\/use)?|items\/[^/]+\/asset|decisions\/seed|videos\/[^/]+|approvals\/[^/]+|topics\/[^/]+|check\/[^/]+\/run)$/;
export const isSpendPath = (p: string) => SPEND_PATH.test(p);

/** A cookie-authenticated write must come from our own pages (CSRF). No Origin = not a browser. */
export function sameOrigin(origin: string | null, host: string | null): boolean {
  if (!origin) return true;
  try { return !!host && new URL(origin).host === host; } catch { return false; }
}
