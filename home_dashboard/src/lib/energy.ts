import type { EnergyResult } from '../../shared/types';

export interface Flows {
  solarToHome: number;
  solarToGrid: number;
  solarToBattery: number;
  gridToHome: number;
  gridToBattery: number;
  batteryToHome: number;
  home: number;
}

/**
 * Splits energy totals into flows. Solar serves exports first, then battery charging,
 * then the house; the grid covers what is left. This mirrors how HA's energy
 * dashboard approximates flows from meter totals.
 */
export function allocate(
  solar: number,
  gridImport: number,
  gridExport: number,
  charge: number,
  discharge: number,
  home: number,
): Flows {
  const solarToGrid = Math.min(solar, gridExport);
  const solarToBattery = Math.min(solar - solarToGrid, charge);
  const solarToHome = Math.max(0, solar - solarToGrid - solarToBattery);
  const gridToBattery = Math.max(0, charge - solarToBattery);
  const gridToHome = Math.max(0, gridImport - gridToBattery);
  return { solarToHome, solarToGrid, solarToBattery, gridToHome, gridToBattery, batteryToHome: discharge, home };
}

const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function totals(e: EnergyResult) {
  const c = e.categories;
  const t = {
    solar: total(c.solar.total),
    gridImport: total(c.gridImport.total),
    gridExport: total(c.gridExport.total),
    batteryCharge: total(c.batteryCharge.total),
    batteryDischarge: total(c.batteryDischarge.total),
    consumption: total(c.consumption.total),
  };
  const flows = allocate(t.solar, t.gridImport, t.gridExport, t.batteryCharge, t.batteryDischarge, t.consumption);
  return {
    ...t,
    flows,
    /** Share of the consumption not taken from the grid. */
    selfSufficiency: t.consumption > 0 ? Math.max(0, Math.min(1, 1 - flows.gridToHome / t.consumption)) : null,
    /** Share of solar production used on site (house + battery). */
    selfConsumption: t.solar > 0 ? Math.max(0, Math.min(1, 1 - t.gridExport / t.solar)) : null,
  };
}

export function bucketFlows(e: EnergyResult, i: number): Flows {
  const c = e.categories;
  return allocate(
    c.solar.total[i],
    c.gridImport.total[i],
    c.gridExport.total[i],
    c.batteryCharge.total[i],
    c.batteryDischarge.total[i],
    c.consumption.total[i],
  );
}

export const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

/** Empty bar segments are not drawn (a zero-height bar would still show its gap edge). */
export const nz = (v: number) => (v === 0 ? null : v);
