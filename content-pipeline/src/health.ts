// Shared health vocabulary used by adapters, modules, and the dashboard.

export type HealthState = 'ok' | 'degraded' | 'error' | 'unconfigured';

export interface HealthReport {
  id: string;            // adapter/module id
  state: HealthState;
  message: string;       // human-readable one-liner
  checkedAt: string;     // ISO timestamp
  meta?: Record<string, unknown>;
}

export function report(
  id: string,
  state: HealthState,
  message: string,
  meta?: Record<string, unknown>,
): HealthReport {
  return { id, state, message, checkedAt: new Date().toISOString(), meta };
}

// Roll many reports into one overall state (worst wins, but 'unconfigured'
// alone is not an outage — it's "not turned on yet").
export function rollup(reports: HealthReport[]): HealthState {
  if (reports.some((r) => r.state === 'error')) return 'error';
  if (reports.some((r) => r.state === 'degraded')) return 'degraded';
  if (reports.length > 0 && reports.every((r) => r.state === 'unconfigured')) return 'unconfigured';
  return 'ok';
}
