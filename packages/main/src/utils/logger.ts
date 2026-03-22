/**
 * Production-grade logging service for MJ Forge main process.
 *
 * Log levels: debug < info < warn < error
 * In development (NODE_ENV !== 'production'), defaults to 'debug'.
 * In production, defaults to 'warn'.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let globalLevel: LogLevel =
  process.env.NODE_ENV === 'production' ? 'warn' : 'debug';

export function setLogLevel(level: LogLevel): void {
  globalLevel = level;
}

export function getLogLevel(): LogLevel {
  return globalLevel;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[globalLevel];
}

function timestamp(): string {
  return new Date().toISOString();
}

function formatMessage(level: LogLevel, tag: string, message: string): string {
  return `${timestamp()} [${level.toUpperCase()}] [${tag}] ${message}`;
}

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * Create a tagged logger instance.
 *
 * Usage:
 *   const log = createLogger('PoolManager');
 *   log.info('Connected to server');
 *   log.error('Connection failed', error);
 */
export function createLogger(tag: string): Logger {
  return {
    debug(message: string, ...args: unknown[]) {
      if (shouldLog('debug')) {
        console.debug(formatMessage('debug', tag, message), ...args);
      }
    },
    info(message: string, ...args: unknown[]) {
      if (shouldLog('info')) {
        console.log(formatMessage('info', tag, message), ...args);
      }
    },
    warn(message: string, ...args: unknown[]) {
      if (shouldLog('warn')) {
        console.warn(formatMessage('warn', tag, message), ...args);
      }
    },
    error(message: string, ...args: unknown[]) {
      if (shouldLog('error')) {
        console.error(formatMessage('error', tag, message), ...args);
      }
    },
  };
}
