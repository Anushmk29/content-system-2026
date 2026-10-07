// Minimal structured logger. Prefixed so host-app logs stay readable.
type Level = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string, meta?: unknown): void;
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
  child(scope: string): Logger;
}

function emit(scope: string, level: Level, msg: string, meta?: unknown): void {
  const line = `[content:${scope}] ${msg}`;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
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
