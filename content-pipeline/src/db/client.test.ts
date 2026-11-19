import { test } from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { sslFor } from './client.ts';

test('remote TLS verifies certificates, trusts the Supabase CA, and requires an explicit opt-out', () => {
  const saved = { mode: process.env.CONTENT_DATABASE_SSL, ca: process.env.CONTENT_DATABASE_CA };
  delete process.env.CONTENT_DATABASE_SSL;
  delete process.env.CONTENT_DATABASE_CA;
  try {
    assert.deepEqual(sslFor('postgres://user:pass@db.example.com/db'), { rejectUnauthorized: true });
    assert.equal(sslFor('postgres://user:pass@localhost/db'), false);
    const ssl = sslFor('postgres://user:pass@aws-1-ap-south-1.pooler.supabase.com/db');
    assert.ok(ssl && ssl.rejectUnauthorized && ssl.ca);
    const certificate = new X509Certificate(ssl.ca);
    assert.equal(certificate.ca, true);
    assert.equal(certificate.fingerprint256, '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA');
    process.env.CONTENT_DATABASE_SSL = 'require';
    assert.deepEqual(sslFor('postgres://user:pass@aws-1-ap-south-1.pooler.supabase.com/db'), ssl);
    delete process.env.CONTENT_DATABASE_SSL;
    assert.deepEqual(sslFor('postgres://user:pass@aws-1-ap-south-1.pooler.supabase.com/db?sslmode=require'), ssl);
    process.env.CONTENT_DATABASE_SSL = 'no-verify';
    assert.deepEqual(sslFor('postgres://user:pass@db.example.com/db'), { rejectUnauthorized: false });
    process.env.CONTENT_DATABASE_SSL = 'disable';
    assert.equal(sslFor('postgres://user:pass@db.example.com/db'), false);
  } finally {
    if (saved.mode === undefined) delete process.env.CONTENT_DATABASE_SSL; else process.env.CONTENT_DATABASE_SSL = saved.mode;
    if (saved.ca === undefined) delete process.env.CONTENT_DATABASE_CA; else process.env.CONTENT_DATABASE_CA = saved.ca;
  }
});
