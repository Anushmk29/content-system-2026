// Request-scoped loaders shared by the layout and pages (React cache dedupes per request,
// so the adapter health probes — incl. a Postiz HTTP call — run once per page view).
import { cache } from 'react';
import { getContext, getSystemHealth } from '@pratapai/content-pipeline';

export const loadHealth = cache(() => getSystemHealth(getContext()));

/** Next 15 page props: searchParams arrive as a promise of string | string[]. */
export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function params(sp: SearchParams): Promise<Record<string, string | undefined>> {
  const raw = await sp;
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
}
