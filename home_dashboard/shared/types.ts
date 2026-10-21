// Types shared by the server and the web UI.

export type ClimateMetric =
  | 'temperature'
  | 'humidity'
  | 'pm25'
  | 'pm10'
  | 'co2'
  | 'voc'
  | 'pressure'
  | 'illuminance'
  | 'other';

export const CLIMATE_METRICS: { key: ClimateMetric; label: string }[] = [
  { key: 'temperature', label: 'Temperature' },
  { key: 'humidity', label: 'Humidity' },
  { key: 'pm25', label: 'PM2.5' },
  { key: 'pm10', label: 'PM10' },
  { key: 'co2', label: 'CO₂' },
  { key: 'voc', label: 'VOC' },
  { key: 'pressure', label: 'Pressure' },
  { key: 'illuminance', label: 'Illuminance' },
  { key: 'other', label: 'Other' },
];

export interface ClimateSensor {
  entity: string;
  metric: ClimateMetric;
}

export interface ClimateArea {
  id: string;
  name: string;
  sensors: ClimateSensor[];
}

export interface EnergySettings {
  // Energy counters (kWh / Wh, total or total_increasing). Several entities are summed.
  solar: string[];
  gridImport: string[];
  gridExport: string[];
  batteryCharge: string[];
  batteryDischarge: string[];
  /** Optional measured consumption. When empty, consumption is derived from the flows. */
  consumption: string[];
  // Instantaneous power (W / kW).
  solarPower: string[];
  /** Grid power, positive = importing. */
  gridPower: string[];
  /** Optional separate export power sensor (positive = exporting). */
  gridExportPower: string[];
  /** Battery power, positive = discharging. */
  batteryPower: string[];
  consumptionPower: string[];
  batterySoc: string[];
  invertGridPower: boolean;
  invertBatteryPower: boolean;
  devices: { entity: string; name?: string }[];
  /** Flat import rate per kWh (used when the tariff is not progressive). */
  importPrice: number;
  exportPrice: number;
  currency: string;
  tariff: TariffSettings;
}

export interface TariffTier {
  /** Upper bound of the tier in kWh per billing cycle; null = no limit (last tier). */
  upTo: number | null;
  rate: number;
}

export interface TariffSettings {
  /** Tiered rates by grid import within the billing cycle instead of the flat import price. */
  progressive: boolean;
  tiers: TariffTier[];
  /** Day of the month a billing cycle starts (1–28). */
  billingDay: number;
  /** Extra charge per imported kWh on top of every tier (fuel adjustment, network fee…). */
  adder: number;
  /** Fixed charge per billing cycle (service fee). */
  fixedCharge: number;
  /** Tax in percent on import energy and fixed charges. */
  vat: number;
}

export interface ClimateSettings {
  autoFromHA: boolean;
  areas: ClimateArea[];
  exclude: string[];
}

export interface DashboardSettings {
  energy: EnergySettings;
  climate: ClimateSettings;
}

export type EntityKind = 'numeric' | 'binary' | 'text';

export interface EntityInfo {
  id: string; // e.g. sensor.solar_power (optionally sensor.x:attribute)
  name: string;
  unit: string | null;
  kind: EntityKind;
  last: number | string | null;
  lastTime: string | null;
  deviceClass?: string | null;
  area?: string | null;
}

export interface Series {
  entity: string;
  name: string;
  unit: string | null;
  kind: EntityKind;
  points: [number, number | string | null][];
}

export interface EnergyCategoryData {
  total: number[];
  entities: { entity: string; values: number[] }[];
}

export interface EnergyResult {
  times: number[];
  configured: Record<string, boolean>;
  categories: Record<
    'solar' | 'gridImport' | 'gridExport' | 'batteryCharge' | 'batteryDischarge' | 'consumption',
    EnergyCategoryData
  >;
  consumptionDerived: boolean;
  devices: { entity: string; name: string; values: number[]; total: number }[];
}

export interface PowerResult {
  times: number[];
  solar: (number | null)[] | null;
  grid: (number | null)[] | null;
  battery: (number | null)[] | null;
  consumption: (number | null)[] | null;
  soc: (number | null)[] | null;
}

export interface LiveResult {
  solar: number | null;
  grid: number | null;
  battery: number | null;
  consumption: number | null;
  soc: number | null;
  updated: string | null;
}

export interface ResolvedClimateArea {
  id: string;
  name: string;
  source: 'ha' | 'manual';
  sensors: (ClimateSensor & {
    name: string;
    unit: string | null;
    value: number | null;
    time: string | null;
  })[];
}

export interface AppInfo {
  version: string;
  mode: 'addon' | 'standalone';
  haConnected: boolean;
  influxOk: boolean;
  influxError?: string;
  influxBackend?: string;
  allowSettingsEdit: boolean;
}
