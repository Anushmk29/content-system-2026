import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createTranscriber } from './transcriber.ts';

test('tool detection never blocks the event loop with synchronous child processes', async () => {
  const sync = mock.method(childProcess, 'spawnSync', () => { throw new Error('Synchronous tool detection blocks page requests'); });
  syncBuiltinESMExports();
  try {
    const adapter = createTranscriber({ ytdlp: '__missing_settings_test_ytdlp__', python: '__missing_settings_test_python__' });
    const health = await adapter.healthCheck();
    assert.equal(health.state, 'unconfigured');
    assert.equal(adapter.configured, false);
    assert.equal((await adapter.healthCheck()).state, 'unconfigured');
    assert.equal(sync.mock.callCount(), 0);
  } finally { sync.mock.restore(); syncBuiltinESMExports(); }
});
