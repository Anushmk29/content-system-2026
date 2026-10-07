// Pure parser/validator for the Draft Generator's Claude response. Kept dependency-
// free (no db, no network) so it is fully unit-tested — the draft module trusts its
// output. An LLM can wrap JSON in prose or ```fences```; we recover the object and
// validate every field we rely on, failing loudly rather than writing garbage rows.
import { FUNNEL_STAGES, type FunnelStage } from '../../core/src/index.ts';
import { brand, pillarSlugs } from '../brand.ts';
import { parseJsonObject } from './llm-json.ts';
import { DRAFT_PLATFORMS, type DraftPlatform } from '../prompts/brand-brain.ts';

export interface DraftPiece {
  title: string;
  hook: string;
  body: string;
  cta: string;
  /** [n] of the proven hook pattern it used, when hooks were offered */
  hookFrom?: number;
}

export interface DraftSet {
  pillar: string;
  funnelStage: FunnelStage;
  // Only the platforms that were asked for are present (all five by default).
  linkedin?: DraftPiece;   // the anchor when present
  blog?: DraftPiece;
  x?: DraftPiece;          // body = thread, tweets separated by "---" lines
  instagram?: DraftPiece;  // body = carousel slides separated by "---" lines
  facebook?: DraftPiece;
  claims: string[];
  /** index into the brand's offers, when the model picked one */
  offer?: number;
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
  return {
    title: str('title'),
    body: str('body'),
    hook: typeof o.hook === 'string' ? o.hook.trim() : '',
    cta: typeof o.cta === 'string' ? o.cta.trim() : '',
    ...(Number.isInteger(o.hookFrom) ? { hookFrom: o.hookFrom as number } : {}),
  };
}

/** Validate the raw Claude string into a typed DraftSet, or throw a clear error. */
export function parseDraftResponse(raw: string, platforms: readonly DraftPlatform[] = DRAFT_PLATFORMS): DraftSet {
  const obj = parseJsonObject(raw);

  const pillar = obj.pillar;
  const pillars = pillarSlugs();
  if (typeof pillar !== 'string' || !pillars.includes(pillar)) {
    throw new Error(`pillar "${String(pillar)}" not one of ${pillars.join(', ')}`);
  }
  const funnelStage = obj.funnelStage;
  if (typeof funnelStage !== 'string' || !(FUNNEL_STAGES as readonly string[]).includes(funnelStage)) {
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
    funnelStage: funnelStage as FunnelStage,
    ...Object.fromEntries(platforms.map((p) => [p, piece(obj[p], p)])),
    claims,
    ...(Number.isInteger(obj.offer) && (obj.offer as number) >= 0 && (obj.offer as number) < brand().offers.length
      ? { offer: obj.offer as number } : {}),
  };
}
