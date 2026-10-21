import { useQuery } from '@tanstack/react-query';
import { addMonths, differenceInCalendarDays } from 'date-fns';
import { useMemo } from 'react';
import type { EnergyResult, EnergySettings, TariffTier } from '../../shared/types';
import { api } from './api';
import { cycleStart, isCurrentPeriod, type Period, periodQuery } from './time';

export function pricingEnabled(s: EnergySettings | undefined): s is EnergySettings {
  if (!s) return false;
  const t = s.tariff;
  return !!(s.exportPrice || t.fixedCharge || t.adder || (t.progressive ? t.tiers.some((x) => x.rate) : s.importPrice));
}

/** Tiers in effect; a flat tariff is a single unbounded tier. */
export function effectiveTiers(s: EnergySettings): TariffTier[] {
  return s.tariff.progressive && s.tariff.tiers.length ? s.tariff.tiers : [{ upTo: null, rate: s.importPrice }];
}

/** Energy charge (before tax) for `kwh` imported since the start of the billing cycle. */
export function energyCharge(kwh: number, tiers: TariffTier[], adder: number): number {
  let cost = 0;
  let from = 0;
  for (const t of tiers) {
    const to = t.upTo ?? Infinity;
    if (kwh <= from) break;
    cost += (Math.min(kwh, to) - from) * t.rate;
    from = to;
  }
  return cost + Math.max(0, kwh) * adder;
}

/** The tier that the next imported kWh falls into. */
export function tierAt(kwh: number, tiers: TariffTier[]): { index: number; tier: TariffTier } {
  const index = Math.max(0, tiers.findIndex((t) => t.upTo === null || kwh < t.upTo));
  return { index, tier: tiers[index] };
}

export interface CostResult {
  /** Import energy + fixed charges, tax included. */
  importCost: number;
  exportCredit: number;
  net: number;
  /** What the self-consumed solar energy would have cost from the grid, tax included. */
  solarAvoided: number;
  /** Bill if all consumption had come from the grid (no solar, no export credit). */
  withoutSolar: number;
  /** withoutSolar − net: avoided import plus export credit. */
  saved: number;
  /** Net cost per display bucket (aligned with `bucketStarts`). */
  buckets: number[];
  /** Cost without solar per display bucket. */
  bucketsWithoutSolar: number[];
  /** Billing cycle containing the end of the period (or now). */
  cycle: { start: Date; end: Date; kwh: number; tierIndex: number; rate: number; nextAt: number | null };
}

/**
 * Prices daily energy totals. `daily` must start at the beginning of the billing cycle
 * containing `start`, so tiers already used up before the period are accounted for.
 */
export function computeCost(
  daily: EnergyResult,
  s: EnergySettings,
  start: Date,
  stop: Date,
  bucketStarts: number[] = [],
): CostResult {
  const t = s.tariff;
  const tiers = effectiveTiers(s);
  const tax = 1 + t.vat / 100;
  const charge = (kwh: number) => energyCharge(kwh, tiers, t.adder);
  const c = daily.categories;
  const now = Date.now();

  let cycleKey = -1;
  let cycleDays = 30;
  let cum = 0; // grid import so far in the cycle
  let cumNoSolar = 0; // the same if self-consumed solar had come from the grid
  let energy = 0;
  let fixed = 0;
  let avoided = 0;
  let exportCredit = 0;
  const buckets = bucketStarts.map(() => 0);
  const bucketsWithoutSolar = bucketStarts.map(() => 0);
  const lastDay = Math.min(now, stop.getTime() - 1);
  let cycleAtEnd = { start: cycleStart(lastDay, t.billingDay), kwh: 0 };

  daily.times.forEach((day, i) => {
    const cs = cycleStart(day, t.billingDay);
    if (cs.getTime() !== cycleKey) {
      cycleKey = cs.getTime();
      cycleDays = differenceInCalendarDays(addMonths(cs, 1), cs);
      cum = cumNoSolar = 0;
    }
    const imp = c.gridImport.total[i] ?? 0;
    const exp = c.gridExport.total[i] ?? 0;
    const solar = c.solar.total[i] ?? 0;
    const selfUsed = Math.max(0, solar - Math.min(solar, exp));

    const dayEnergy = charge(cum + imp) - charge(cum);
    const dayNoSolar = charge(cumNoSolar + imp + selfUsed) - charge(cumNoSolar);
    cum += imp;
    cumNoSolar += imp + selfUsed;
    if (cycleKey === cycleAtEnd.start.getTime() && day <= lastDay) cycleAtEnd = { start: cs, kwh: cum };

    if (day < start.getTime() || day >= stop.getTime() || day > now) return;
    const dayFixed = t.fixedCharge / cycleDays;
    const dayCredit = exp * s.exportPrice;
    energy += dayEnergy;
    fixed += dayFixed;
    avoided += dayNoSolar - dayEnergy;
    exportCredit += dayCredit;
    let b = -1;
    for (let k = 0; k < bucketStarts.length && bucketStarts[k] <= day; k++) b = k;
    if (b >= 0) {
      buckets[b] += (dayEnergy + dayFixed) * tax - dayCredit;
      bucketsWithoutSolar[b] += (dayNoSolar + dayFixed) * tax;
    }
  });

  const importCost = (energy + fixed) * tax;
  const net = importCost - exportCredit;
  const withoutSolar = (energy + avoided + fixed) * tax;
  const at = tierAt(cycleAtEnd.kwh, tiers);
  return {
    importCost,
    exportCredit,
    net,
    solarAvoided: avoided * tax,
    withoutSolar,
    saved: withoutSolar - net,
    buckets,
    bucketsWithoutSolar,
    cycle: {
      start: cycleAtEnd.start,
      end: addMonths(cycleAtEnd.start, 1),
      kwh: cycleAtEnd.kwh,
      tierIndex: at.index,
      rate: (at.tier.rate + t.adder) * tax,
      nextAt: at.tier.upTo,
    },
  };
}

/** Cost of a calendar period, using daily totals from the start of its first billing cycle. */
export function useCost(period: Period, s: EnergySettings | undefined, bucketStarts?: number[]) {
  const enabled = pricingEnabled(s);
  const q = periodQuery(period);
  const from = cycleStart(q.start, s?.tariff.billingDay ?? 1);  const { data } = useQuery({
    queryKey: ['energy-daily', from.getTime(), q.stop.getTime()],
    queryFn: () => api.energy({ start: from, stop: q.stop, every: '1d' }),
    enabled,
    refetchInterval: isCurrentPeriod(period) ? 300_000 : false,
  });
  return useMemo(
    () => (enabled && data ? computeCost(data, s, q.start, q.stop, bucketStarts) : null),
    [enabled, data, s, q.start.getTime(), q.stop.getTime(), bucketStarts],
  );
}
