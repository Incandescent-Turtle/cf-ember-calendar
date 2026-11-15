// Number and date formatting shared by the panels and the methodology page.
import type { Label } from './analytics';
import { dekadRange, MONTHS_LONG, MONTHS_SHORT } from './time';

export const LABEL_TEXT: Record<Label, string> = {
  below: 'Below normal',
  normal: 'Normal',
  above: 'Above normal',
  extreme: 'Extreme',
};
export const LABEL_RULE = 'Below normal < 25th percentile ≤ Normal ≤ 75th < Above normal < 90th ≤ Extreme';

export const n0 = (x: number) => (Number.isFinite(x) ? Math.round(x).toLocaleString('en-US') : '—');
export const k2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '—');
export const ord = (p: number) => {
  const n = Math.round(p);
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${s}`;
};
export const yearSpan = (ys: number[]) => (ys.length ? `${ys[0]}–${ys[ys.length - 1]}` : '—');
export const monthRun = (months: number[]) =>
  months.length === 1 ? MONTHS_LONG[months[0]] : `${MONTHS_SHORT[months[0]]}–${MONTHS_SHORT[months[months.length - 1]]}`;
export const fmtP = (p: number) => (p < 0.001 ? '< 0.001' : p.toFixed(p < 0.01 ? 3 : 2));
export const dayRange = (tA: number, tB: number) => {
  const a = dekadRange(tA)[0];
  const b = dekadRange(tB)[1];
  return `${MONTHS_SHORT[Number(a.slice(5, 7)) - 1]} ${Number(a.slice(8))}–${Number(b.slice(8))}`;
};
