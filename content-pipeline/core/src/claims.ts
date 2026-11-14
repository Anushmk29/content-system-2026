// Honest-numbers gate (Bible §7 / §10.3).
// Any claim without a real proof URL blocks publishing. The QC gate uses this; the
// publish gate itself is the v_publish_ready SQL view.
import type { Claim } from './types.ts';

export const hasUnprovenClaims = (claims: Claim[]): boolean => claims.some((c) => !c.proofUrl?.trim());
