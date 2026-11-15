// Dekad time axis (CONTRACTS.md → Time axis). Twin of pipeline/grid.py dekad_*.
// t = (year − 2000)·36 + (month − 1)·3 + (dekad − 1); dekad 3 runs day 21 → month end. UTC.

export const FIRST_YEAR = 2000;

/** Dekad index of a UTC date (Date or 'YYYY-MM-DD'). */
export function dekadIndex(d: Date | string): number {
  const [y, m, day] =
    typeof d === 'string' ? parseIsoDate(d) : [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
  return (y - FIRST_YEAR) * 36 + (m - 1) * 3 + Math.min(Math.floor((day - 1) / 10), 2);
}

/** Inclusive [first day, last day] of dekad t, as 'YYYY-MM-DD'. */
export function dekadRange(t: number): [string, string] {
  const y = dekadYear(t);
  const m = dekadMonth(t) + 1;
  const k = t % 3;
  const endDay = k === 2 ? daysInMonth(y, m) : 10 * (k + 1);
  return [iso(y, m, 1 + 10 * k), iso(y, m, endDay)];
}

/** Calendar month 0–11 of dekad t. */
export const dekadMonth = (t: number): number => Math.floor(t / 3) % 12;
/** Year of dekad t. */
export const dekadYear = (t: number): number => FIRST_YEAR + Math.floor(t / 36);
/** Month index (0 = Jan 2000) of dekad t. */
export const dekadMonthIndex = (t: number): number => Math.floor(t / 3);

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

export function parseIsoDate(s: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) throw new Error(`bad date ${s}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

const pad = (n: number) => String(n).padStart(2, '0');
export const iso = (y: number, m1: number, d: number) => `${y}-${pad(m1)}-${pad(d)}`;

export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
