// Apply db/schema.sql to CONTENT_DATABASE_URL in ONE transaction: all of it or none of it, so a
// failure halfway can never leave the views it drops and recreates missing. The file is
// re-runnable (create if not exists / add column if not exists), so this is also the upgrade path.
// Each applied version is recorded in content.schema_version.
//   npm run migrate              (from content-pipeline/; reads ../.env)
// ponytail: one idempotent file, not numbered migrations; split into files if two people change the schema at once.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { sslFor } from '../src/db/client.ts';

const url = process.env.CONTENT_DATABASE_URL;
if (!url) {
  console.error('CONTENT_DATABASE_URL is not set');
  process.exit(1);
}
const sql = readFileSync(new URL('../../db/schema.sql', import.meta.url), 'utf8');
const sha = createHash('sha256').update(sql).digest('hex').slice(0, 12);

const client = new pg.Client({ connectionString: url, ssl: sslFor(url) });
await client.connect();
try {
  await client.query('begin');
  await client.query(sql);
  await client.query(`create table if not exists content.schema_version (sha text primary key, applied_at timestamptz not null default now())`);
  await client.query(`insert into content.schema_version (sha) values ($1) on conflict (sha) do update set applied_at = now()`, [sha]);
  await client.query('commit');
  console.log(`schema applied (${sha})`);
} catch (e) {
  await client.query('rollback').catch(() => {});
  console.error(`schema NOT applied, nothing changed: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
