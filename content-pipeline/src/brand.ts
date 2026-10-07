// The one brand this install writes for. Saved on /content/brand (content.brand_kit) and
// loaded by services/brand-service.ts; prompts, parsers and creatives read it via brand().
// ponytail: one process-wide active brand — right for one brand per install; pass a Brand
// explicitly through the prompt builders if this ever serves several brands at once.
import type { DecodePlatform } from './adapters/apify.ts';

export interface BrandPillar { slug: string; label: string; description: string; /** target share of posts, % */ target: number }
export interface BrandOffer { label: string; url: string; cta: string; primary: boolean }
export type LogoCorner = 'tl' | 'tr' | 'bl' | 'br';

export interface Brand {
  name: string;
  tagline: string;
  audience: string;
  voice: string;
  voiceSamples: string[];
  pillars: BrandPillar[];
  offers: BrandOffer[];
  palette: string[];
  headingFont: string | null;
  bodyFont: string | null;
  hasLogo: boolean;
  logoCorner: LogoCorner;
  ownHandles: Partial<Record<DecodePlatform, string>>;
  onboardedAt: string | null;
  /** false = nothing saved yet; this is the built-in default. */
  saved: boolean;
}

/** What the pipeline writes as before a brand kit is saved (the original PRATAP AI brand brain). */
export const DEFAULT_BRAND: Brand = {
  name: 'PRATAP AI',
  tagline: 'practical AI builds for SME operators and founders',
  audience: `Founder-led SMEs and service businesses with manual workflows who know AI can help but
don't know where to start. Never adopt enterprise/procurement language.`,
  voice: `Calm, practical, premium, founder-led, NO hype:
- Outcome-first: start with business value, not tool names.
- Practical over theoretical: tell them what to do next.
- Specific over generic: concrete examples and workflows.
- Calm authority: no hype, no fearmongering, no "AI will replace everyone".
- Peer-to-peer: write like a builder/operator, not a guru.
- Proof-aware: NEVER invent metrics, clients, or results.
- Simple language: avoid jargon unless it improves clarity.`,
  voiceSamples: [],
  pillars: [
    { slug: 'practical_ai_for_operators', label: 'Practical AI for operators', description: 'How-to, practical AI use for running a business', target: 35 },
    { slug: 'proof_and_use_cases', label: 'Proof and use cases', description: 'Case studies, results, real client examples', target: 25 },
    { slug: 'founder_build_notes', label: 'Founder build notes', description: 'Behind-the-scenes of building, founder lessons', target: 25 },
    { slug: 'ai_readiness_and_offer', label: 'AI readiness and offer', description: 'Whether a business is ready for AI, our offer and pricing', target: 15 },
  ],
  offers: [{
    label: 'AI Readiness Call', url: 'https://pratapai.com/ai-readiness', primary: true,
    cta: 'Book an AI Readiness Call: a practical diagnostic of where AI saves time, which workflows to automate first, and what to fix.',
  }],
  palette: [],
  headingFont: null,
  bodyFont: null,
  hasLogo: false,
  logoCorner: 'br',
  ownHandles: {},
  onboardedAt: null,
  saved: false,
};

let active: Brand = DEFAULT_BRAND;
export const brand = (): Brand => active;
export const setBrand = (b: Brand): void => { active = b; };

/** Pillar slugs the LLM may answer with. Never empty: an unsaved list falls back to the default's. */
export const pillarSlugs = (b: Brand = active): string[] =>
  (b.pillars.length ? b.pillars : DEFAULT_BRAND.pillars).map((p) => p.slug);

/** The offer a post links to: its chosen one when valid, else the primary, else none. */
export function offerFor(idx: number | null | undefined, b: Brand = active): BrandOffer | null {
  return (idx != null ? b.offers[idx] : undefined) ?? b.offers.find((o) => o.primary) ?? b.offers[0] ?? null;
}

/** "Proof & use-cases!" → "proof_use_cases". */
export const slugify = (s: string): string =>
  s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
