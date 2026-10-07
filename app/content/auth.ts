// Login for a single-client install: one password for the client, one for the admin (us).
// The session is a signed cookie `role.expiry.sig`; changing either password logs everyone out.
// No dependency: node:crypto only. Read by middleware.ts (Node runtime) and the login route.
import { createHmac, timingSafeEqual } from 'node:crypto';

export type Role = 'client' | 'admin';
export const SESSION_COOKIE = 'content_session';
export const SESSION_DAYS = 30;

const secret = (name: string) => process.env[name]?.trim() || '';
const clientPw = () => secret('CONTENT_RUN_SECRET');
const adminPw = () => secret('CONTENT_ADMIN_SECRET');

function same(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** No client password configured: dev runs open, production refuses to serve. */
export const openMode = () => !clientPw();

/** Admin password wins if both match; null when it matches neither. */
export function roleForPassword(given: string | null | undefined): Role | null {
  if (!given) return null;
  if (adminPw() && same(given, adminPw())) return 'admin';
  if (clientPw() && same(given, clientPw())) return 'client';
  return null;
}

const sig = (body: string) =>
  createHmac('sha256', `${clientPw()}\0${adminPw()}`).update(body).digest('base64url');

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

/** Pages and routes only the admin sees: engine health, run log, Jev training data. */
export const ADMIN_PATHS = ['/content/system', '/content/training', '/content/api/dataset', '/content/api/decisions'];
export const isAdminPath = (p: string) => ADMIN_PATHS.some((a) => p === a || p.startsWith(`${a}/`));
