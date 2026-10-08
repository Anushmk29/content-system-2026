// Common adapter contract. Each external integration is wrapped so that:
//  * a missing key => 'unconfigured' (not a crash),
//  * a failing call => caught and reported, never thrown to the orchestrator.
import type { HealthReport } from '../health.ts';

export interface Adapter {
  readonly id: string;
  readonly configured: boolean;
  healthCheck(): Promise<HealthReport>;
}

/** fetch → parsed JSON; a non-2xx throws `${label} ${status}: <first 300 chars of the body>`. */
export async function fetchJson<T>(url: string, init: RequestInit, label: string): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${label} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}
