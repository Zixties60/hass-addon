import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from 'date-fns';
import type { TimeQuery } from './api';

// ---------- rolling ranges (history, climate) ----------

export const PRESETS = [
  { key: '1h', label: 'Last hour', ms: 3_600_000 },
  { key: '6h', label: 'Last 6 hours', ms: 6 * 3_600_000 },
  { key: '24h', label: 'Last 24 hours', ms: 86_400_000 },
  { key: '7d', label: 'Last 7 days', ms: 7 * 86_400_000 },
  { key: '30d', label: 'Last 30 days', ms: 30 * 86_400_000 },
  { key: '90d', label: 'Last 90 days', ms: 90 * 86_400_000 },
  { key: '1y', label: 'Last year', ms: 365 * 86_400_000 },
] as const;

export type RangeValue = { preset: string } | { start: string; stop: string };

const STEPS: [string, number][] = [
  ['1m', 60_000],
  ['2m', 120_000],
  ['5m', 300_000],
  ['10m', 600_000],
  ['15m', 900_000],
  ['30m', 1_800_000],
  ['1h', 3_600_000],
  ['2h', 7_200_000],
  ['3h', 10_800_000],
  ['6h', 21_600_000],
  ['12h', 43_200_000],
  ['1d', 86_400_000],
  ['7d', 604_800_000],
];

/** Smallest "nice" window keeping the number of points under `maxPoints`. */
export function pickEvery(ms: number, maxPoints = 400): string {
  for (const [k, step] of STEPS) if (ms / step <= maxPoints) return k;
  return '7d';
}

export function resolveRange(r: RangeValue, maxPoints = 400): TimeQuery {
  let start: Date;
  let stop: Date;
  if ('preset' in r) {
    const p = PRESETS.find((x) => x.key === r.preset) ?? PRESETS[2];
    stop = new Date();
    start = new Date(stop.getTime() - p.ms);
  } else {
    start = new Date(r.start);
    stop = new Date(r.stop);
    if (!(stop > start)) stop = new Date(start.getTime() + 3_600_000);
  }
  return { start, stop, every: pickEvery(stop.getTime() - start.getTime(), maxPoints) };
}

export function rangeLabel(r: RangeValue): string {
  if ('preset' in r) return PRESETS.find((p) => p.key === r.preset)?.label ?? r.preset;
  return `${format(new Date(r.start), 'd MMM HH:mm')} – ${format(new Date(r.stop), 'd MMM HH:mm')}`;
}

/** Encodes a range for the URL: "24h" or "<startMs>-<stopMs>". */
export function encodeRange(r: RangeValue): string {
  return 'preset' in r ? r.preset : `${Date.parse(r.start)}-${Date.parse(r.stop)}`;
}

export function decodeRange(s: string | null, fallback: RangeValue = { preset: '24h' }): RangeValue {
  if (!s) return fallback;
  if (PRESETS.some((p) => p.key === s)) return { preset: s };
  const m = /^(\d+)-(\d+)$/.exec(s);
  if (m) return { start: new Date(Number(m[1])).toISOString(), stop: new Date(Number(m[2])).toISOString() };
  return fallback;
}

// ---------- calendar periods (energy, solar) ----------

export type PeriodKind = 'day' | 'week' | 'month' | 'year';

export interface Period {
  kind: PeriodKind;
  anchor: number; // any timestamp inside the period
}

export function periodQuery(p: Period): TimeQuery {
  const a = new Date(p.anchor);
  switch (p.kind) {
    case 'day': {
      const start = startOfDay(a);
      return { start, stop: addDays(start, 1), every: '1h' };
    }
    case 'week': {
      const start = startOfWeek(a, { weekStartsOn: 1 });
      return { start, stop: addWeeks(start, 1), every: '1d' };
    }
    case 'month': {
      const start = startOfMonth(a);
      return { start, stop: addMonths(start, 1), every: '1d' };
    }
    case 'year': {
      const start = startOfYear(a);
      return { start, stop: addYears(start, 1), every: '1mo' };
    }
  }
}

export function shiftPeriod(p: Period, dir: 1 | -1): Period {
  const shift = { day: addDays, week: addWeeks, month: addMonths, year: addYears }[p.kind];
  return { ...p, anchor: shift(new Date(p.anchor), dir).getTime() };
}

export function periodLabel(p: Period): string {
  const q = periodQuery(p);
  switch (p.kind) {
    case 'day':
      return format(q.start, 'EEE d MMM yyyy');
    case 'week':
      return `${format(q.start, 'd MMM')} – ${format(addDays(q.stop, -1), 'd MMM yyyy')}`;
    case 'month':
      return format(q.start, 'MMMM yyyy');
    case 'year':
      return format(q.start, 'yyyy');
  }
}

export function bucketLabel(kind: PeriodKind, t: number): string {
  if (kind === 'day') return format(t, 'HH:mm');
  if (kind === 'year') return format(t, 'MMM');
  if (kind === 'week') return format(t, 'EEE d');
  return format(t, 'd');
}

/** Axis bounds covering the whole local day of the first timestamp. */
export function dayBounds(times: number[]): { min?: number; max?: number } {
  if (!times.length) return {};
  const start = startOfDay(times[0]);
  return { min: start.getTime(), max: addDays(start, 1).getTime() };
}

export function isCurrentPeriod(p: Period): boolean {
  const q = periodQuery(p);
  return Date.now() >= q.start.getTime() && Date.now() < q.stop.getTime();
}
