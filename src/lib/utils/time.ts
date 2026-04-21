/**
 * Time calculation and formatting utilities for the Telegram Time Tracker.
 */

import type { TimeLog, TimeSpent } from '../../types/index';

/**
 * Calculates total time spent across an array of TimeLog intervals.
 *
 * For each log entry:
 * - Uses `paused_at` if present
 * - Otherwise uses `ended_at` if present
 * - Skips open intervals (neither paused_at nor ended_at)
 */
export function calculateTotalTime(timeLogs: TimeLog[]): TimeSpent {
  let totalMs = 0;

  for (const log of timeLogs) {
    const endStr = log.paused_at ?? log.ended_at;
    if (!endStr) continue; // open interval — skip

    const start = new Date(log.started_at).getTime();
    const end = new Date(endStr).getTime();
    const diff = end - start;
    if (diff > 0) {
      totalMs += diff;
    }
  }

  const totalMinutes = Math.floor(totalMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return { hours, minutes, totalMinutes };
}

/**
 * Formats a TimeSpent object into Ukrainian string format.
 * Example: "2 год 30 хв"
 */
export function formatTimeSpent(time: TimeSpent): string {
  return `${time.hours} год ${String(time.minutes).padStart(2, '0')} хв`;
}

/**
 * Formats a Date or ISO string into "ДД.ММ.РРРР ГГ:ХХ" format in UTC+2 timezone.
 * Example: "21.04.2026 14:30"
 */
export function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;

  // Format in Europe/Kiev (UTC+2 / UTC+3 DST) timezone
  const formatter = new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Kiev',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';

  const day = get('day');
  const month = get('month');
  const year = get('year');
  const hour = get('hour');
  const minute = get('minute');

  return `${day}.${month}.${year} ${hour}:${minute}`;
}

/**
 * Returns the start of the current day (midnight) in the given timezone.
 * Defaults to 'Europe/Kiev' (UTC+2).
 */
export function getStartOfDay(tz = 'Europe/Kiev'): Date {
  const now = new Date();

  // Get the current date components in the target timezone
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  // en-CA gives YYYY-MM-DD format
  const dateStr = formatter.format(now); // e.g. "2026-04-21"

  // Build midnight in that timezone by parsing as a local-tz ISO string
  // We use the trick of formatting midnight in the target tz back to UTC
  const [year, month, day] = dateStr.split('-').map(Number);

  // Create a date representing midnight in the target timezone
  // by finding the UTC time that corresponds to midnight local time
  return localMidnightToUTC(year, month, day, tz);
}

/**
 * Returns the start of the current week (Monday midnight) in the given timezone.
 * Defaults to 'Europe/Kiev' (UTC+2).
 * Week starts on Monday.
 */
export function getStartOfWeek(tz = 'Europe/Kiev'): Date {
  const now = new Date();

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });

  const parts = formatter.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';

  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const weekday = get('weekday'); // "Mon", "Tue", etc.

  // Map weekday abbreviation to ISO day number (Mon=1 ... Sun=7)
  const weekdayMap: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };
  const isoDow = weekdayMap[weekday] ?? 1;

  // Days to subtract to reach Monday
  const daysToMonday = isoDow - 1;
  const mondayDay = day - daysToMonday;

  // Handle month underflow by working with a Date object
  const approxDate = new Date(Date.UTC(year, month - 1, mondayDay));
  const mondayYear = approxDate.getUTCFullYear();
  const mondayMonth = approxDate.getUTCMonth() + 1;
  const mondayDayOfMonth = approxDate.getUTCDate();

  return localMidnightToUTC(mondayYear, mondayMonth, mondayDayOfMonth, tz);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Given a calendar date (year, month 1-12, day) and a timezone name,
 * returns the UTC Date that corresponds to midnight (00:00:00) in that timezone.
 */
function localMidnightToUTC(year: number, month: number, day: number, tz: string): Date {
  // Build an ISO-like string and parse it, then adjust for the tz offset
  // Strategy: create a Date at noon UTC for that calendar date, then use
  // Intl to find the offset, and subtract it.
  const noonUTC = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  // Get the UTC offset at that moment in the target timezone (in minutes)
  const offsetMinutes = getTimezoneOffsetMinutes(noonUTC, tz);

  // Midnight local = midnight UTC - offset
  // local_time = utc_time + offset  =>  utc_time = local_time - offset
  const midnightUTC = new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - offsetMinutes * 60_000);

  return midnightUTC;
}

/**
 * Returns the UTC offset in minutes for a given Date in the specified timezone.
 * Positive means ahead of UTC (e.g., UTC+2 → +120).
 */
function getTimezoneOffsetMinutes(date: Date, tz: string): number {
  // Format the date in the target timezone and in UTC, then diff
  const localStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);

  // Parse the formatted local time string
  // en-CA format: "YYYY-MM-DD, HH:MM:SS"
  const cleaned = localStr.replace(',', '');
  const localDate = new Date(cleaned + ' UTC'); // treat as UTC to get the numeric value

  const offsetMs = localDate.getTime() - date.getTime();
  return Math.round(offsetMs / 60_000);
}
