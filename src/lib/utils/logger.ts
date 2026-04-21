/**
 * Logging utility for the Telegram Time Tracker.
 * Wraps console methods with ISO timestamp prefixes.
 */

function getTimestamp(): string {
  return new Date().toISOString();
}

export const logger = {
  /**
   * Logs an informational message to console.log.
   * Format: [2026-04-21T12:00:00.000Z] [INFO] message
   */
  info(message: string, ...args: unknown[]): void {
    console.log(`[${getTimestamp()}] [INFO] ${message}`, ...args);
  },

  /**
   * Logs an error message to console.error.
   * Format: [2026-04-21T12:00:00.000Z] [ERROR] message
   */
  error(message: string, ...args: unknown[]): void {
    console.error(`[${getTimestamp()}] [ERROR] ${message}`, ...args);
  },

  /**
   * Logs a warning message to console.warn.
   * Format: [2026-04-21T12:00:00.000Z] [WARN] message
   */
  warn(message: string, ...args: unknown[]): void {
    console.warn(`[${getTimestamp()}] [WARN] ${message}`, ...args);
  },
};
