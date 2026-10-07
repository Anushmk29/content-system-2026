// Honest-numbers gate (Bible §7 / §10.3).
// Any claim without a real proof URL blocks publishing. The QC gate uses this; the
// publish gate itself is the v_publish_ready SQL view.
import type { Claim } from './types.ts';

function isProven(c: Claim): boolean {
  return typeof c.proofUrl === 'string' && c.proofUrl.trim().length > 0;
}

export function unprovenClaims(claims: Claim[]): Claim[] {
  return claims.filter((c) => !isProven(c));
}

export function hasUnprovenClaims(claims: Claim[]): boolean {
  return claims.some((c) => !isProven(c));
}
