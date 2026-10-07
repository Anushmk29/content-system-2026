// UTM builder (Bible §13.2).
// Format: utm_source={platform}&utm_medium=organic&utm_campaign={campaign}&utm_content={item_id}
import type { Platform } from './types.ts';

export interface UtmParams {
  source: Platform | string;
  medium?: string;       // organic | email | community (default organic)
  campaign: string;      // ai_readiness | content_pipeline | crm_automation | ...
  content: string;       // content_item id or slug
}

/**
 * Append UTM params to a URL, preserving any existing query string and hash.
 * Returns the original string unchanged if it isn't a valid URL.
 */
export function buildUtmUrl(baseUrl: string, params: UtmParams): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return baseUrl;
  }
  url.searchParams.set('utm_source', String(params.source));
  url.searchParams.set('utm_medium', params.medium ?? 'organic');
  url.searchParams.set('utm_campaign', params.campaign);
  url.searchParams.set('utm_content', params.content);
  return url.toString();
}
