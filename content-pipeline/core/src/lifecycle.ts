// Content item lifecycle (Bible §12.2): the only legal status moves. Every status write
// in the engine goes through this table (src/db/content-items.ts), so e.g. an approval can't
// land on an item that is already scheduled in Postiz.
import type { ContentStatus } from './types.ts';

export const CONTENT_EVENTS = {
  submit:       { from: ['draft'], to: 'needs_approval' },            // QC passed → human lane
  approve:      { from: ['needs_approval'], to: 'approved' },
  changes:      { from: ['needs_approval', 'approved'], to: 'draft' },
  reject:       { from: ['draft', 'needs_approval', 'approved'], to: 'archived' },
  schedule:     { from: ['approved'], to: 'queued' },                 // handed to Postiz
  go_live:      { from: ['queued'], to: 'published' },
  upload:       { from: ['approved'], to: 'published' },              // a filmed Short, uploaded by hand
  capture:      { from: ['published'], to: 'performance_captured' },
} as const satisfies Record<string, { from: readonly ContentStatus[]; to: ContentStatus }>;

export type ContentEvent = keyof typeof CONTENT_EVENTS;

/** Signed off by a human or safe_auto, whether or not it has gone out yet. */
export const APPROVED_STATUSES = ['approved', 'queued', 'published', 'performance_captured'] as const;
/** Has actually been out in the world. */
export const LIVE_STATUSES = ['published', 'performance_captured'] as const;
