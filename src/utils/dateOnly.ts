/**
 * DST-safe "date-only" utility module.
 *
 * All domain dates are plain "YYYY-MM-DD" strings.
 * Internally uses UTC-only Date arithmetic — never local time.
 * Exports ONLY string-in / string-out (or string-in / number-out).
 */

/** Parse "YYYY-MM-DD" to a UTC-midnight Date. Internal only. */
function toUTC(iso: string): Date {
  return new Date(iso + "T00:00:00Z");
}

/** Format a UTC Date back to "YYYY-MM-DD". Internal only. */
function fmt(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ── Public API ──

/** Compare two date strings. Returns -1, 0, or 1. */
export function compareDates(a: string, b: string): -1 | 0 | 1 {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Add (or subtract) calendar days. DST-safe. */
export function addDays(dateStr: string, n: number): string {
  const d = toUTC(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}

/**
 * Number of calendar days from start to end, INCLUSIVE of both endpoints.
 * start === end → 1.
 */
export function diffDaysInclusive(start: string, end: string): number {
  const ms = toUTC(end).getTime() - toUTC(start).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

/** Return the later of two dates. */
export function maxDate(a: string, b: string): string {
  return a >= b ? a : b;
}

/** Return the earlier of two dates. */
export function minDate(a: string, b: string): string {
  return a <= b ? a : b;
}

// ── ISO-week helpers (ISO-8601: week starts Monday) ──

/** ISO weekday: 1=Mon … 7=Sun */
function isoWeekday(dateStr: string): number {
  const jsDay = toUTC(dateStr).getUTCDay(); // 0=Sun
  return jsDay === 0 ? 7 : jsDay;
}

/** Monday of the ISO week containing dateStr. */
export function startOfISOWeek(dateStr: string): string {
  const wd = isoWeekday(dateStr); // 1=Mon
  return addDays(dateStr, 1 - wd);
}

/** Sunday of the ISO week containing dateStr. */
export function endOfISOWeek(dateStr: string): string {
  const wd = isoWeekday(dateStr); // 7=Sun
  return addDays(dateStr, 7 - wd);
}

/**
 * ISO week identifier, e.g. "2026-W10".
 * Handles year boundaries correctly (ISO year may differ from calendar year).
 */
export function getISOWeekId(dateStr: string): string {
  const d = toUTC(dateStr);

  // Find the Thursday of the same ISO week (ISO rule: week belongs to the year of its Thursday)
  const dayOfWeek = d.getUTCDay(); // 0=Sun
  const isoDay = dayOfWeek === 0 ? 7 : dayOfWeek; // 1=Mon..7=Sun
  const thursday = new Date(d.getTime());
  thursday.setUTCDate(thursday.getUTCDate() + (4 - isoDay));

  const isoYear = thursday.getUTCFullYear();

  // Jan 4 is always in week 1
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Day = jan4.getUTCDay() === 0 ? 7 : jan4.getUTCDay();
  const startOfWeek1 = new Date(jan4.getTime());
  startOfWeek1.setUTCDate(startOfWeek1.getUTCDate() - (jan4Day - 1));

  const weekNum = Math.round((thursday.getTime() - startOfWeek1.getTime()) / (7 * 86_400_000)) + 1;

  return `${isoYear}-W${String(weekNum).padStart(2, "0")}`;
}

/** Given "YYYY-WNN", return { startDate (Mon), endDate (Sun) }. */
export function getISOWeekRange(weekId: string): { startDate: string; endDate: string } {
  const match = weekId.match(/^(\d{4})-W(\d{2})$/);
  if (!match) throw new Error(`Invalid ISO week id: ${weekId}`);

  const year = parseInt(match[1], 10);
  const week = parseInt(match[2], 10);

  // Jan 4 is always in week 1
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() === 0 ? 7 : jan4.getUTCDay();
  const startOfWeek1 = new Date(jan4.getTime());
  startOfWeek1.setUTCDate(startOfWeek1.getUTCDate() - (jan4Day - 1));

  // Target week Monday
  const mondayMs = startOfWeek1.getTime() + (week - 1) * 7 * 86_400_000;
  const monday = new Date(mondayMs);
  const sunday = new Date(mondayMs + 6 * 86_400_000);

  return { startDate: fmt(monday), endDate: fmt(sunday) };
}

/**
 * ISO weekday index: 0=Mon, 1=Tue, ..., 6=Sun.
 * Useful for weekday-based allocation logic.
 */
export function isoWeekdayIndex(dateStr: string): number {
  const jsDay = toUTC(dateStr).getUTCDay(); // 0=Sun
  return jsDay === 0 ? 6 : jsDay - 1;
}

/** Format a "YYYY-MM" month key from a date string. */
export function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7);
}

/**
 * Add (or subtract) calendar months. DST-safe.
 * Clamps to last day of target month if original day overflows
 * (e.g. Jan 31 + 1 month → Feb 28).
 */
export function addMonths(dateStr: string, n: number): string {
  const d = toUTC(dateStr);
  const origDay = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + n);
  // If the day changed (overflow), clamp to last day of target month
  if (d.getUTCDate() !== origDay) {
    d.setUTCDate(0); // sets to last day of previous month (i.e. the target month)
  }
  return fmt(d);
}

/** Today as "YYYY-MM-DD" in UTC. */
export function todayISO(): string {
  return fmt(new Date());
}
