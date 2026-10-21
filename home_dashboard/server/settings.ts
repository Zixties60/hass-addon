import fs from 'node:fs';
import path from 'node:path';
import { parseRef } from './influx.js';
import {
  CLIMATE_METRICS,
  type ClimateMetric,
  type DashboardSettings,
  type EnergySettings,
  type TariffSettings,
  type TariffTier,
} from '../shared/types.js';

export const DEFAULT_SETTINGS: DashboardSettings = {
  energy: {
    solar: [],
    gridImport: [],
    gridExport: [],
    batteryCharge: [],
    batteryDischarge: [],
    consumption: [],
    solarPower: [],
    gridPower: [],
    gridExportPower: [],
    batteryPower: [],
    consumptionPower: [],
    batterySoc: [],
    invertGridPower: false,
    invertBatteryPower: false,
    devices: [],
    importPrice: 0,
    exportPrice: 0,
    currency: '',
    tariff: { progressive: false, tiers: [], billingDay: 1, adder: 0, fixedCharge: 0, vat: 0 },
  },
  climate: { autoFromHA: true, areas: [], exclude: [] },
};

const LIST_KEYS = [
  'solar',
  'gridImport',
  'gridExport',
  'batteryCharge',
  'batteryDischarge',
  'consumption',
  'solarPower',
  'gridPower',
  'gridExportPower',
  'batteryPower',
  'consumptionPower',
  'batterySoc',
] as const satisfies readonly (keyof EnergySettings)[];

const entityList = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && parseRef(x) !== null))] : [];
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown, max = 100) => (typeof v === 'string' ? v.slice(0, max) : '');
const metrics = new Set<string>(CLIMATE_METRICS.map((m) => m.key));

function normalizeTariff(t: any): TariffSettings {
  const pos = (v: unknown) => Math.max(0, num(v));
  // Tiers ascending by bound; only the last one may be unbounded.
  const tiers = (Array.isArray(t?.tiers) ? t.tiers : [])
    .slice(0, 20)
    .map((x: any) => ({ upTo: typeof x?.upTo === 'number' && x.upTo > 0 ? x.upTo : null, rate: pos(x?.rate) }))
    .sort((a: TariffTier, b: TariffTier) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity))
    .filter((x: TariffTier, i: number, all: TariffTier[]) => i === 0 || x.upTo !== all[i - 1].upTo);
  if (tiers.length) tiers[tiers.length - 1].upTo = null;
  const day = Math.round(num(t?.billingDay));
  return {
    progressive: t?.progressive === true,
    tiers,
    billingDay: day >= 1 && day <= 28 ? day : 1,
    adder: num(t?.adder),
    fixedCharge: pos(t?.fixedCharge),
    vat: Math.min(100, pos(t?.vat)),
  };
}

/** Coerces untrusted input into a valid settings object. */
export function normalizeSettings(input: any): DashboardSettings {
  const e = input?.energy ?? {};
  const c = input?.climate ?? {};
  const energy = { ...DEFAULT_SETTINGS.energy };
  for (const k of LIST_KEYS) energy[k] = entityList(e[k]);
  energy.invertGridPower = e.invertGridPower === true;
  energy.invertBatteryPower = e.invertBatteryPower === true;
  energy.devices = (Array.isArray(e.devices) ? e.devices : [])
    .filter((d: any) => typeof d?.entity === 'string' && parseRef(d.entity))
    .map((d: any) => ({ entity: d.entity, name: str(d.name) || undefined }));
  energy.importPrice = num(e.importPrice);
  energy.exportPrice = num(e.exportPrice);
  energy.currency = str(e.currency, 8);
  energy.tariff = normalizeTariff(e.tariff);

  const areas = (Array.isArray(c.areas) ? c.areas : []).map((a: any, i: number) => ({
    id: str(a?.id, 64) || `area_${i}`,
    name: str(a?.name) || `Area ${i + 1}`,
    sensors: (Array.isArray(a?.sensors) ? a.sensors : [])
      .filter((s: any) => typeof s?.entity === 'string' && parseRef(s.entity))
      .map((s: any) => ({
        entity: s.entity,
        metric: (metrics.has(s.metric) ? s.metric : 'other') as ClimateMetric,
      })),
  }));

  return {
    energy,
    climate: { autoFromHA: c.autoFromHA !== false, areas, exclude: entityList(c.exclude) },
  };
}

export class SettingsStore {
  private file: string;
  private current: DashboardSettings | null = null;
  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'dashboard-settings.json');
  }

  exists(): boolean {
    return fs.existsSync(this.file);
  }

  get(): DashboardSettings {
    if (!this.current) {
      try {
        this.current = normalizeSettings(JSON.parse(fs.readFileSync(this.file, 'utf8')));
      } catch {
        this.current = normalizeSettings({});
      }
    }
    return this.current;
  }

  save(input: unknown): DashboardSettings {
    const s = normalizeSettings(input);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(s, null, 2));
    this.current = s;
    return s;
  }
}
