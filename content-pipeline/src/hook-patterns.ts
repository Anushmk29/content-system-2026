// One hook taxonomy for Jev, the Decode breakdown, drafting and the learning loop. Merged from
// competitor-hunter's 6 hook types and goviralbro's hook patterns (both MIT, Charles Dove).
export const HOOK_PATTERNS = {
  contradiction: 'challenges a common belief ("Stop doing X", "X is a lie")',
  number_specific: 'leads with a specific number or result ("I cut costs 43% in 30 days")',
  newsjack: 'rides a fresh news event, launch or trend',
  outcome_build: 'shows the end result first, then how it was built',
  how_to: 'promises a method or steps ("How to…", "3 ways to…")',
  question: 'opens with a direct question to the reader',
  story: 'opens inside a personal or client story',
  other: 'none of the above',
} as const;
export type HookPattern = keyof typeof HOOK_PATTERNS;
export const HOOK_PATTERN_KEYS = Object.keys(HOOK_PATTERNS) as HookPattern[];
export const isHookPattern = (v: unknown): v is HookPattern => typeof v === 'string' && v in HOOK_PATTERNS;
