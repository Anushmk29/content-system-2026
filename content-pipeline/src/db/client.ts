// Postgres client. Lazy + isolated: the Pool is created on first use, pg is
// imported dynamically so pure-logic code can run/test without the driver, and
// every connection sets search_path to the `content` schema so we never read or
// write the host app's tables by accident.
import { readFileSync } from 'node:fs';
import type { Pool, PoolClient } from 'pg';
import type { HealthReport } from '../health.ts';
import { report } from '../health.ts';

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
  healthCheck(): Promise<HealthReport>;
  /** Run `fn` on one connection inside begin/commit; rolls back if it throws. Nested calls join the outer one. */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
}

const run = async <T>(c: Pool | PoolClient, text: string, params?: unknown[]): Promise<QueryResult<T>> => {
  const res = await c.query(text, params);
  return { rows: res.rows as T[], rowCount: res.rowCount ?? res.rows.length };
};

// Managed Postgres (Supabase, Neon, RDS, …) require TLS, and their certs are signed
// by chains Node doesn't bundle — so a plain connection throws either
// "no encryption" or "self-signed certificate in certificate chain". We enable TLS for
// any non-local host (without forcing the operator to append ?sslmode=require), and skip
// it for localhost. Override with CONTENT_DATABASE_SSL = require | no-verify | disable.
// CONTENT_DATABASE_CA = path to the provider's CA cert (Supabase: Database settings → SSL
// certificate) turns full verification on for remote hosts.
function sslFor(url: string): false | { rejectUnauthorized: boolean; ca?: string } {
  const mode = (process.env.CONTENT_DATABASE_SSL ?? '').trim().toLowerCase();
  if (mode === 'disable') return false;
  const caPath = process.env.CONTENT_DATABASE_CA?.trim();
  if (caPath) return { rejectUnauthorized: true, ca: readFileSync(caPath, 'utf8') };
  if (mode === 'require') return { rejectUnauthorized: true };
  if (mode === 'no-verify') return { rejectUnauthorized: false };
  const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url) || /\bhost=localhost\b/.test(url);
  // Default: TLS on for remote hosts, relaxed verification (Supabase's pooler cert chain
  // isn't in Node's trust store); off for local dev.
  return isLocal ? false : { rejectUnauthorized: false };
}

export function createDb(databaseUrl: string | undefined): Db {
  let poolPromise: Promise<Pool> | null = null;

  async function getPool(): Promise<Pool> {
    if (!databaseUrl) throw new Error('CONTENT_DATABASE_URL is not set');
    if (!poolPromise) {
      poolPromise = (async () => {
        const { default: pg } = await import('pg');
        return new pg.Pool({
          connectionString: databaseUrl,
          // Every checked-out connection is scoped to the content schema.
          options: '-c search_path=content,public',
          ssl: sslFor(databaseUrl),
          max: 5,
        });
      })();
    }
    return poolPromise;
  }

  const db: Db = {
    async query<T = Record<string, unknown>>(text: string, params?: unknown[]) {
      return run<T>(await getPool(), text, params);
    },

    async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
      const client = await (await getPool()).connect();
      const inner: Db = { query: (text, params) => run(client, text, params), healthCheck: db.healthCheck, tx: (f) => f(inner) };
      try {
        await client.query('begin');
        const out = await fn(inner);
        await client.query('commit');
        return out;
      } catch (e) {
        await client.query('rollback').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },

    async healthCheck(): Promise<HealthReport> {
      if (!databaseUrl) return report('database', 'unconfigured', 'CONTENT_DATABASE_URL not set');
      try {
        const pool = await getPool();
        const r = await pool.query('select 1 as ok', []);
        const ok = (r.rows[0] as { ok?: number } | undefined)?.ok === 1;
        return ok
          ? report('database', 'ok', 'connected; search_path=content')
          : report('database', 'degraded', 'connected but unexpected ping result');
      } catch (e) {
        return report('database', 'error', `connection failed: ${(e as Error).message}`);
      }
    },
  };
  return db;
}
