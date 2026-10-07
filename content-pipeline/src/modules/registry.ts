// The ordered pipeline (Bible Table 0). Source of truth for which modules exist.
import type { Module } from './module.ts';
import { marketSignalsModule } from './market-signals.module.ts';
import { researchModule } from './research.module.ts';
import { scoringModule } from './scoring.module.ts';
import { draftGeneratorModule } from './draft-generator.module.ts';
import { qcGateModule } from './qc-gate.module.ts';
import { publisherModule } from './publisher.module.ts';
import { analyticsModule } from './analytics.module.ts';
import { ownResultsModule } from './own-results.module.ts';
import { weeklyReviewModule } from './weekly-review.module.ts';

// Order = pipeline order (Bible Table 0):
// market signals → research → score → draft → QC → approve (human, in the dashboard) → publish → analytics → learn.
export const MODULES: Module[] = [
  marketSignalsModule,
  researchModule,
  scoringModule,
  draftGeneratorModule,
  qcGateModule,
  publisherModule,
  ownResultsModule,
  analyticsModule,
  weeklyReviewModule,
];

export function getModule(id: string): Module | undefined {
  return MODULES.find((m) => m.id === id);
}
