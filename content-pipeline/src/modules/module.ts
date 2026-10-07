// The module contract. Every pipeline stage is a Module. The orchestrator runs
// each one in isolation, so one failing module never breaks the others.
import type { Db } from '../db/client.ts';
import type { Logger } from '../logger.ts';
import type { ContentEnv } from '../env.ts';
import type { HealthReport } from '../health.ts';
import type { ClaudeAdapter } from '../adapters/claude.ts';
import type { PostizAdapter } from '../adapters/postiz.ts';
import type { JevAdapter } from '../adapters/jev.ts';
import type { ApifyAdapter } from '../adapters/apify.ts';
import type { TinyfishAdapter } from '../adapters/tinyfish.ts';

export type RunStatus = 'ok' | 'degraded' | 'error' | 'skipped' | 'running';

export interface Adapters {
  claude: ClaudeAdapter;
  postiz: PostizAdapter;
  jev: JevAdapter;
  apify: ApifyAdapter;
  tinyfish: TinyfishAdapter;
}

export interface ModuleContext {
  db: Db;
  env: ContentEnv;
  logger: Logger;
  adapters: Adapters;
}

export interface ModuleResult {
  status: RunStatus;
  itemsProcessed: number;
  message: string;
  meta?: Record<string, unknown>;
}

export interface Module {
  readonly id: string;            // stable id, also the module_runs.module_id
  readonly title: string;
  readonly description: string;
  /** Do the work. Throwing is allowed — the orchestrator catches and records it. */
  run(ctx: ModuleContext): Promise<ModuleResult>;
  /** Optional readiness probe shown on the dashboard. */
  healthCheck?(ctx: ModuleContext): Promise<HealthReport>;
}

export const ok = (itemsProcessed: number, message: string, meta?: Record<string, unknown>): ModuleResult =>
  ({ status: 'ok', itemsProcessed, message, meta });
export const degraded = (message: string, meta?: Record<string, unknown>): ModuleResult =>
  ({ status: 'degraded', itemsProcessed: 0, message, meta });
export const skipped = (message: string): ModuleResult =>
  ({ status: 'skipped', itemsProcessed: 0, message });
