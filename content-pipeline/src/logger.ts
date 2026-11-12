// Minimal structured logger. Readable `[content:scope] msg` lines in dev; one JSON object per line
// in production (or CONTENT_LOG_FORMAT=json) so a log shipper can index level/scope/msg.
type Level = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string, meta?: unknown): void;
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
  child(scope: string): Logger;
}

const json = () => (process.env.CONTENT_LOG_FORMAT ?? (process.env.NODE_ENV === 'production' ? 'json' : 'text')) === 'json';

function emit(scope: string, level: Level, msg: string, meta?: unknown): void {
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (json()) {
    fn(JSON.stringify({ t: new Date().toISOString(), level, scope, msg, ...(meta !== undefined ? { meta: meta instanceof Error ? meta.message : meta } : {}) }));
    return;
  }
  const line = `[content:${scope}] ${msg}`;
  if (meta !== undefined) fn(line, meta);
  else fn(line);
}

export function createLogger(scope = 'app'): Logger {
  return {
    debug: (m, meta) => emit(scope, 'debug', m, meta),
    info: (m, meta) => emit(scope, 'info', m, meta),
    warn: (m, meta) => emit(scope, 'warn', m, meta),
    error: (m, meta) => emit(scope, 'error', m, meta),
    child: (s) => createLogger(`${scope}:${s}`),
  };
}
