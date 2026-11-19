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
  /** Run `fn` only if no other process holds `key` (a Postgres advisory lock); null if it is held. */
  tryLock<T>(key: string, fn: () => Promise<T>): Promise<T | null>;
}

const run = async <T>(c: Pool | PoolClient, text: string, params?: unknown[]): Promise<QueryResult<T>> => {
  const res = await c.query(text, params);
  return { rows: res.rows as T[], rowCount: res.rowCount ?? res.rows.length };
};

// Supabase's private CA: https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt
const SUPABASE_CA = `-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----`;

// Verify remote database certificates. CONTENT_DATABASE_CA supplies the provider's CA
// when Node does not trust it. Explicit overrides: require | no-verify | disable.
export function sslFor(url: string): false | { rejectUnauthorized: boolean; ca?: string } {
  const mode = (process.env.CONTENT_DATABASE_SSL?.trim() || new URL(url).searchParams.get('sslmode') || '').toLowerCase();
  if (mode === 'disable') return false;
  const caPath = process.env.CONTENT_DATABASE_CA?.trim();
  if (caPath) return { rejectUnauthorized: true, ca: readFileSync(caPath, 'utf8') };
  if (mode === 'no-verify') return { rejectUnauthorized: false };
  const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url) || /\bhost=localhost\b/.test(url);
  if (isLocal && mode !== 'require') return false;
  const supabase = /@(?:[a-z0-9-]+\.pooler\.supabase\.com|db\.[a-z0-9-]+\.supabase\.co)[:/]/i.test(url);
  return supabase ? { rejectUnauthorized: true, ca: SUPABASE_CA } : { rejectUnauthorized: true };
}

// One pool per database URL for the whole process. `next dev` re-evaluates this module on reloads;
// a pool per evaluation stacked up past Supabase's 15 session clients (EMAXCONNSESSION).
const POOLS = ((globalThis as { __contentPools?: Map<string, Promise<Pool>> }).__contentPools ??= new Map());

export function createDb(databaseUrl: string | undefined): Db {
  async function getPool(): Promise<Pool> {
    if (!databaseUrl) throw new Error('CONTENT_DATABASE_URL is not set');
    let poolPromise = POOLS.get(databaseUrl);
    if (!poolPromise) {
      POOLS.set(databaseUrl, poolPromise = (async () => {
        const { default: pg } = await import('pg');
        const connection = new URL(databaseUrl);
        // pg's sslmode parsing otherwise overwrites the verified CA configured below.
        connection.searchParams.delete('sslmode');
        const pool = new pg.Pool({
          connectionString: connection.toString(),
          // Every checked-out connection is scoped to the content schema; no query runs past 2 min.
          options: '-c search_path=content,public -c statement_timeout=120000',
          ssl: sslFor(databaseUrl),
          max: 8, // ponytail: each module run pins one for its lock; web + scheduler = 16 on Supabase
          connectionTimeoutMillis: 10_000,
          idleTimeoutMillis: 30_000,
        });
        // An idle connection dropped by the server emits 'error'; unhandled, that kills the process.
        pool.on('error', (e) => console.error('[content] db pool error:', e.message));
        return pool;
      })());
    }
    return poolPromise;
  }

  const db: Db = {
    async query<T = Record<string, unknown>>(text: string, params?: unknown[]) {
      return run<T>(await getPool(), text, params);
    },

    async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
      const client = await (await getPool()).connect();
      const inner: Db = { query: (text, params) => run(client, text, params), healthCheck: db.healthCheck, tx: (f) => f(inner), tryLock: (k, f) => db.tryLock(k, f) };
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

    async tryLock<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
      // Session-level lock on a dedicated connection, so it holds for the whole of fn.
      const client = await (await getPool()).connect();
      try {
        const got = await client.query(`select pg_try_advisory_lock(hashtext($1)) as got`, [key]);
        if (!got.rows[0]?.got) return null;
        try {
          return await fn();
        } finally {
          await client.query(`select pg_advisory_unlock(hashtext($1))`, [key]).catch(() => {});
        }
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
