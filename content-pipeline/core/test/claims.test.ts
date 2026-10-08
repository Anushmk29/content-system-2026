import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasUnprovenClaims } from '../src/claims.ts';

test('hasUnprovenClaims flags null / empty / whitespace proof', () => {
  assert.equal(hasUnprovenClaims([{ claimText: 'a', proofUrl: null }]), true);
  assert.equal(hasUnprovenClaims([{ claimText: 'a', proofUrl: '' }]), true);
  assert.equal(hasUnprovenClaims([{ claimText: 'a', proofUrl: '   ' }]), true);
  assert.equal(hasUnprovenClaims([{ claimText: 'a', proofUrl: 'https://proof' }]), false);
});

test('no claims at all is publishable (nothing to prove)', () => {
  assert.equal(hasUnprovenClaims([]), false);
});
