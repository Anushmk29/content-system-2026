// Only routine settings may override the server environment. Infrastructure and login secrets stay on the host.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { loadEnv } from '../env.ts';
import type { Db } from '../db/client.ts';
import type { ModuleContext } from '../modules/module.ts';

interface Setting {
  name: string; label: string; group: string; hint: string;
  secret?: boolean; options?: string[]; min?: number; max?: number; integer?: boolean; multiline?: boolean;
}
export const SETTINGS: Setting[] = [
  { name: 'CONTENT_OPENROUTER_API_KEY', label: 'OpenRouter API key', group: 'Connections', hint: 'Used for writing, research, images and Jev.', secret: true },
  { name: 'CONTENT_OPENROUTER_MGMT_KEY', label: 'OpenRouter management key', group: 'Connections', hint: 'Optional. Enables daily billing comparisons.', secret: true },
  { name: 'CONTENT_POSTIZ_API_URL', label: 'Postiz API URL', group: 'Connections', hint: 'Your publishing API, including its API path.' },
  { name: 'CONTENT_POSTIZ_API_KEY', label: 'Postiz API key', group: 'Connections', hint: 'Used to read channels and schedule posts.', secret: true },
  { name: 'CONTENT_APIFY_TOKEN', label: 'Apify token', group: 'Connections', hint: 'Competitor post collection.', secret: true },
  { name: 'CONTENT_TINYFISH_API_KEY', label: 'TinyFish API key', group: 'Connections', hint: 'Web search and competitor page research.', secret: true },
  { name: 'CONTENT_YOUTUBE_API_KEY', label: 'YouTube API key', group: 'Connections', hint: 'YouTube Data API v3.', secret: true },
  { name: 'CONTENT_X_BEARER_TOKEN', label: 'X bearer token', group: 'Connections', hint: 'Official X search API.', secret: true },
  ...[
    ['CONTENT_LLM_MODEL', 'Writing model', 'OpenRouter model ID. Leave empty for the built-in default.'],
    ['CONTENT_IMAGE_MODEL', 'Image model', 'An OpenRouter image model, such as qwen/qwen-image-3. A text model here breaks Create visual.'],
    ['CONTENT_RESEARCH_MODEL', 'Research model', 'OpenRouter model ID, tinyfish, or off.'],
    ['CONTENT_CHEAP_MODEL', 'Quick task model', 'OpenRouter model ID, or off to use the writing model.'],
    ['CONTENT_JEV_MODEL', 'Jev model', 'OpenRouter decision model ID.'],
  ].map(([name, label, hint]) => ({ name: name!, label: label!, hint: hint!, group: 'Models' })),
  { name: 'CONTENT_JEV_MODE', label: 'Jev mode', group: 'Models', hint: 'Shadow learns alongside the main model. Primary lets Jev decide.', options: ['off', 'shadow', 'primary'] },
  { name: 'CONTENT_JEV_PRIMARY_TASKS', label: 'Jev primary tasks', group: 'Models', hint: 'Comma-separated task names, such as topic_score,qc_signals.' },
  { name: 'CONTENT_DAILY_BUDGET_USD', label: 'Daily paid-call limit (USD)', group: 'Workflow', hint: 'Empty means no cap. Zero blocks paid calls.', min: 0 },
  { name: 'CONTENT_AUTO_SELECT_TOPICS', label: 'Topics automatically selected per run', group: 'Workflow', hint: '0 keeps selection manual.', min: 0, max: 10, integer: true },
  { name: 'CONTENT_TRANSCRIBE_CAP', label: 'Transcriptions per run', group: 'Workflow', hint: 'Maximum videos transcribed in one run.', min: 0, max: 200, integer: true },
  { name: 'CONTENT_POST_HOUR_UTC', label: 'Daily posting hour (UTC)', group: 'Workflow', hint: '4 means 09:30 in India.', min: 0, max: 23, integer: true },
  { name: 'CONTENT_WHISPER_MODEL', label: 'Transcription model', group: 'Workflow', hint: 'A local Whisper model, such as small.' },
  ...[
    ['CONTENT_POSTIZ_SYNC', 'Sync calendar to Postiz', 'Book or move posts when the calendar changes.'],
    ['CONTENT_PLATFORM_FIT', 'Choose platforms for each idea', 'Let Jev recommend suitable platforms.'],
    ['CONTENT_REVISE_ON_CHANGES', 'Rewrite after requested changes', 'Use review feedback to rewrite the post automatically.'],
    ['CONTENT_HUMANIZE_REWRITE', 'Humanize low-scoring drafts', 'Allow one extra rewrite during quality checks.'],
  ].map(([name, label, hint]) => ({ name: name!, label: label!, hint: hint!, group: 'Workflow', options: ['0', '1'] })),
  ...[
    ['CONTENT_MARKET_FEEDS', 'Market feeds', 'RSS or Atom URLs, optionally competitor=url.'],
    ['CONTENT_REDDIT_QUERIES', 'Reddit queries', 'Comma-separated search terms.'],
    ['CONTENT_X_QUERIES', 'X queries', 'Comma-separated search queries.'],
    ['CONTENT_TINYFISH_QUERIES', 'Web research queries', 'Search terms for market signals.'],
    ['CONTENT_TINYFISH_WATCH', 'Competitor pages to watch', 'Competitor page URLs for web research.'],
  ].map(([name, label, hint]) => ({ name: name!, label: label!, hint: hint!, group: 'Research inputs', multiline: true })),
];

function encryptionKey(): Buffer {
  const key = (process.env.CONTENT_SETTINGS_KEY || process.env.CONTENT_SESSION_KEY || '').trim();
  if (key.length < 32) throw new Error('Set CONTENT_SETTINGS_KEY or CONTENT_SESSION_KEY to 32+ characters on the server before saving settings.');
  return createHash('sha256').update(key).digest();
}

function sealSetting(name: string, value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(name));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.');
}

function unsealSetting(name: string, value: string): string {
  try {
    const [version, iv, tag, encrypted] = value.split('.');
    if (version !== 'v1' || !iv || !tag || encrypted === undefined) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
    decipher.setAAD(Buffer.from(name));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Saved settings could not be decrypted. Restore the original server settings encryption key.');
  }
}

export async function readSettings(db: Db): Promise<{ values: Record<string, string>; ready: boolean }> {
  try {
    const { rows } = await db.query<{ name: string; value: string }>('select name, value from content.runtime_settings order by name');
    const allowed = new Set(SETTINGS.map((s) => s.name));
    return { values: Object.fromEntries(rows.filter((r) => allowed.has(r.name)).map((r) => [r.name, unsealSetting(r.name, r.value)])), ready: true };
  } catch (e) {
    if ((e as { code?: string }).code === '42P01') return { values: {}, ready: false };
    throw e;
  }
}

export interface SettingView extends Setting { value?: string; configured: boolean; source: 'saved' | 'server' | 'default'; testable?: boolean }
export async function settingsView(db: Db): Promise<{ fields: SettingView[]; ready: boolean }> {
  const { values, ready } = await readSettings(db);
  return { ready, fields: SETTINGS.map((s) => {
    let value = values[s.name] ?? process.env[s.name]?.trim() ?? '';
    if (value && s.options?.includes('0')) value = /^(1|true|on|yes)$/i.test(value) ? '1' : '0';
    return { ...s, ...(!s.secret ? { value } : {}), configured: !!value, testable: !!s.secret && s.name in TESTABLE,
      source: s.name in values ? 'saved' : process.env[s.name]?.trim() ? 'server' : 'default' };
  }) };
}

export function validateSettings(input: unknown): Record<string, string | null> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Send a settings object.');
  const out: Record<string, string | null> = {};
  for (const [name, raw] of Object.entries(input)) {
    const setting = SETTINGS.find((s) => s.name === name);
    if (!setting) throw new Error('That setting cannot be changed here.');
    if (raw === null) { out[name] = null; continue; }
    if (typeof raw !== 'string' || raw.length > 8000 || /[\u0000\r]/.test(raw)) throw new Error(`${setting.label}: enter valid text (up to 8,000 characters).`);
    let value = raw.trim();
    if (!setting.multiline && /\n/.test(value)) throw new Error(`${setting.label}: enter a single line.`);
    if (setting.secret && !value) continue; // Empty password fields never erase an existing key.
    if (setting.options && value && !setting.options.includes(value)) throw new Error(`${setting.label}: choose one of the listed options.`);
    if (setting.min !== undefined && value) {
      const n = Number(value);
      if (!Number.isFinite(n) || n < setting.min || (setting.max !== undefined && n > setting.max) || (setting.integer && !Number.isInteger(n))) {
        throw new Error(`${setting.label}: enter ${setting.integer ? 'a whole number' : 'a number'} from ${setting.min}${setting.max === undefined ? ' upwards' : ` to ${setting.max}`}.`);
      }
      value = String(n); // Keep integer parsing consistent with loadEnv's decimal parseInt.
    }
    if (name === 'CONTENT_POSTIZ_API_URL' && value) {
      let url: URL;
      try { url = new URL(value); } catch { throw new Error('Postiz API URL: enter a full http:// or https:// address.'); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw new Error('Postiz API URL: use http:// or https:// without credentials, query or fragment.');
    }
    out[name] = value;
  }
  return out;
}

export async function saveSettings(db: Db, input: unknown): Promise<void> {
  const patch = validateSettings(input);
  loadEnv({ ...process.env, ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v ?? process.env[k]])) });
  const encrypted = Object.entries(patch).map(([name, value]) => [name, value === null ? null : sealSetting(name, value)] as const);
  await db.tx(async (tx) => {
    for (const [name, value] of encrypted) {
      if (value === null) await tx.query('delete from content.runtime_settings where name = $1', [name]);
      else await tx.query(`insert into content.runtime_settings (name, value) values ($1, $2)
        on conflict (name) do update set value = excluded.value, updated_at = now()`, [name, value]);
    }
  });
}

/** Which connection a key belongs to; only these get a Test button (X has no adapter to probe). */
const TESTABLE: Record<string, 'claude' | 'postiz' | 'apify' | 'tinyfish' | 'youtube'> = {
  CONTENT_OPENROUTER_API_KEY: 'claude', CONTENT_POSTIZ_API_URL: 'postiz', CONTENT_POSTIZ_API_KEY: 'postiz',
  CONTENT_APIFY_TOKEN: 'apify', CONTENT_TINYFISH_API_KEY: 'tinyfish', CONTENT_YOUTUBE_API_KEY: 'youtube',
};
export const testableSettings = Object.keys(TESTABLE);

/** "Configured" only means a value is saved; this makes a real call with it. */
export async function testConnection(ctx: ModuleContext, name: string): Promise<{ ok: boolean; message: string }> {
  const adapter = TESTABLE[name] ? ctx.adapters[TESTABLE[name]] : undefined;
  if (!adapter) return { ok: false, message: 'This setting has no connection test.' };
  const r = await adapter.healthCheck();
  return { ok: r.state === 'ok', message: r.message };
}
