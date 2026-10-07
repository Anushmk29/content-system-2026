// Test-only Db adapter: an in-process Postgres (pglite) loaded with the real db/schema.sql,
// so tests exercise the actual SQL, views and generated columns instead of faking queries.
// Excluded from the build (tsconfig.build.json); pglite is a devDependency.
import { readFileSync } from 'node:fs';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import type { Db, QueryResult } from './client.ts';
import { report } from '../health.ts';

const SCHEMA = readFileSync(new URL('../../../db/schema.sql', import.meta.url), 'utf8')
  .replace(/create extension[^;]*;/i, ''); // gen_random_uuid() is built in

type Queryable = Pick<PGlite | Transaction, 'query'>;

const run = async <T>(q: Queryable, text: string, params?: unknown[]): Promise<QueryResult<T>> => {
  const r = await q.query<T>(text, params);
  return { rows: r.rows, rowCount: r.affectedRows || r.rows.length };
};

/** A fresh database with the content schema applied. */
export async function createTestDb(): Promise<Db> {
  const pg = new PGlite();
  await pg.exec(SCHEMA);
  const healthCheck = async () => report('database', 'ok', 'pglite');
  const on = (q: Queryable): Db => {
    const db: Db = {
      query: (text, params) => run(q, text, params),
      healthCheck,
      tx: q === pg ? (fn) => pg.transaction((t) => fn(on(t))) : (fn) => fn(db),
    };
    return db;
  };
  return on(pg);
}
