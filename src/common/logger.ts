/* eslint-disable no-console */
export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

export const createLogger = (requestId?: string): Logger => {
  const prefix = requestId ? `[req:${requestId}]` : '';

  const log = (
    level: 'info' | 'warn' | 'error' | 'debug',
    message: string,
    meta?: Record<string, unknown>
  ) => {
    const payload = meta ? { ...meta, message } : message;
    switch (level) {
      case 'info':
        console.log(prefix, payload);
        break;
      case 'warn':
        console.warn(prefix, payload);
        break;
      case 'error':
        console.error(prefix, payload);
        break;
      case 'debug':
        console.debug(prefix, payload);
        break;
    }
  };

  return {
    info: (message, meta) => log('info', message, meta),
    warn: (message, meta) => log('warn', message, meta),
    error: (message, meta) => log('error', message, meta),
    debug: (message, meta) => log('debug', message, meta),
  };
};
