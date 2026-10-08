// Common adapter contract. Each external integration is wrapped so that:
//  * a missing key => 'unconfigured' (not a crash),
//  * a failing call => caught and reported, never thrown to the orchestrator.
import type { HealthReport } from '../health.ts';

export interface Adapter {
  readonly id: string;
  readonly configured: boolean;
  healthCheck(): Promise<HealthReport>;
}

/** Upstream error bodies can echo credentials back; blank anything key- or token-shaped. */
export const redact = (s: string) =>
  s.replace(/\b(Bearer\s+)\S+/gi, '$1***')
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, '$1-***')
    .replace(/([?&"']?(?:api[_-]?key|token|secret|password|authorization)["']?\s*[=:]\s*["']?)[^"'&\s,}]+/gi, '$1***');

/** fetch → parsed JSON; a non-2xx throws `${label} ${status}: <first 300 chars of the body, redacted>`. */
export async function fetchJson<T>(url: string, init: RequestInit, label: string): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${label} ${res.status}: ${redact((await res.text()).slice(0, 300))}`);
  return (await res.json()) as T;
}
