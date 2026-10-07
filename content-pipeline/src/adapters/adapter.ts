// Common adapter contract. Each external integration is wrapped so that:
//  * a missing key => 'unconfigured' (not a crash),
//  * a failing call => caught and reported, never thrown to the orchestrator.
import type { HealthReport } from '../health.ts';

export interface Adapter {
  readonly id: string;
  readonly configured: boolean;
  healthCheck(): Promise<HealthReport>;
}
