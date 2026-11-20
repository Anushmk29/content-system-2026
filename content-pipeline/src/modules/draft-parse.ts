// Pure parser/validator for the Draft Generator's Claude response. Kept dependency-
// free (no db, no network) so it is fully unit-tested — the draft module trusts its
// output. An LLM can wrap JSON in prose or ```fences```; we recover the object and
// validate every field we rely on, failing loudly rather than writing garbage rows.
import { FUNNEL_STAGES, isFunnelStage, type FunnelStage } from '../../core/src/index.ts';
import { brand, pillarSlugs } from '../brand.ts';
import { parseJsonObject } from './llm-json.ts';
import { DEFAULT_DRAFT_PLATFORMS, type DraftPlatform } from '../prompts/platform-playbooks.ts';
import { isHookPattern, type HookPattern } from '../hook-patterns.ts';

export interface DraftPiece {
  title: string;
  hook: string;
  body: string;
  cta: string;
  /** [n] of the proven hook pattern it used, when hooks were offered */
  hookFrom?: number;
  /** The kind of opening (hook-patterns.ts) — what the learning loop scores. */
  hookPattern?: HookPattern;
  /** Scored alternative openings (raw); the draft module keeps the best by hook-service's score. */
  hookOptions?: unknown[];
}

export interface DraftSet {
  pillar: string;
  funnelStage: FunnelStage;
  // Only the platforms that were asked for are present (all four by default).
  linkedin?: DraftPiece;   // the anchor when present
  x?: DraftPiece;          // body = thread, tweets separated by "---" lines
  instagram?: DraftPiece;  // body = carousel slides separated by "---" lines
  facebook?: DraftPiece;
  reddit?: DraftPiece;     // posted by hand; body ends with a "TL;DR:" line
  youtube?: DraftPiece;    // body = Short filming card, beats separated by "---" lines
  claims: string[];
  /** index into the brand's offers, when the model picked one */
  offer?: number;
}

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The CTA is shown (and posted) after the body: a body that already ends on it would say it twice. */
export function dropRepeatedCta(body: string, cta: string): string {
  if (!norm(cta)) return body;
  const lines = body.trimEnd().split('\n');
  const last = lines[lines.length - 1] ?? '';
  if (norm(last) !== norm(cta) && !(norm(cta).length > 15 && norm(last).endsWith(norm(cta)))) return body;
  lines.pop();
  while (lines.length && /^\s*(---)?\s*$/.test(lines[lines.length - 1]!)) lines.pop(); // the gap or slide divider before it
  return lines.length ? lines.join('\n') : body;
}

function piece(v: unknown, where: string): DraftPiece {
  if (!v || typeof v !== 'object') throw new Error(`${where} is missing or not an object`);
  const o = v as Record<string, unknown>;
  const str = (k: string): string => {
    const s = o[k];
    if (typeof s !== 'string' || s.trim().length === 0) throw new Error(`${where}.${k} must be a non-empty string`);
    return s.trim();
  };
  // hook/cta are useful but non-fatal if blank; title/body are required.
  const cta = typeof o.cta === 'string' ? o.cta.trim() : '';
  return {
    title: str('title'),
    body: dropRepeatedCta(str('body'), cta),
    hook: typeof o.hook === 'string' ? o.hook.trim() : '',
    cta,
    ...(Number.isInteger(o.hookFrom) ? { hookFrom: o.hookFrom as number } : {}),
    ...(isHookPattern(o.hookPattern) ? { hookPattern: o.hookPattern } : {}),
    ...(Array.isArray(o.hookOptions) ? { hookOptions: o.hookOptions } : {}),
  };
}

/** Validate the raw Claude string into a typed DraftSet, or throw a clear error. */
export function parseDraftResponse(raw: string, platforms: readonly DraftPlatform[] = DEFAULT_DRAFT_PLATFORMS): DraftSet {
  const obj = parseJsonObject(raw);

  const pillar = obj.pillar;
  const pillars = pillarSlugs();
  if (typeof pillar !== 'string' || !pillars.includes(pillar)) {
    throw new Error(`pillar "${String(pillar)}" not one of ${pillars.join(', ')}`);
  }
  const funnelStage = obj.funnelStage;
  if (!isFunnelStage(funnelStage)) {
    throw new Error(`funnelStage "${String(funnelStage)}" not one of ${FUNNEL_STAGES.join(', ')}`);
  }

  const claimsRaw = obj.claims ?? [];
  if (!Array.isArray(claimsRaw)) throw new Error('claims must be an array');
  const claims = claimsRaw
    .filter((c): c is string => typeof c === 'string')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  return {
    pillar,
    funnelStage,
    ...Object.fromEntries(platforms.map((p) => [p, piece(obj[p], p)])),
    claims,
    ...(Number.isInteger(obj.offer) && (obj.offer as number) >= 0 && (obj.offer as number) < brand().offers.length
      ? { offer: obj.offer as number } : {}),
  };
}
