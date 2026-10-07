import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasUnprovenClaims, unprovenClaims } from '../src/claims.ts';

test('hasUnprovenClaims flags null / empty / whitespace proof', () => {
  assert.equal(hasUnprovenClaims([{ claimText: 'a', proofUrl: null }]), true);
  assert.equal(hasUnprovenClaims([{ claimText: 'a', proofUrl: '' }]), true);
  assert.equal(hasUnprovenClaims([{ claimText: 'a', proofUrl: '   ' }]), true);
  assert.equal(hasUnprovenClaims([{ claimText: 'a', proofUrl: 'https://proof' }]), false);
});

test('no claims at all is publishable (nothing to prove)', () => {
  assert.equal(hasUnprovenClaims([]), false);
});

test('unprovenClaims returns only the unproven ones', () => {
  const out = unprovenClaims([
    { claimText: 'proven', proofUrl: 'https://x' },
    { claimText: 'bad', proofUrl: null },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.claimText, 'bad');
});
