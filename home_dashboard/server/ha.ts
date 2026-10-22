import type { AppConfig } from './config.js';
import type { ClimateMetric, EnergySettings } from '../shared/types.js';

export interface HaState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
}

export interface HaAreaSensor {
  areaId: string;
  areaName: string;
  entity: string;
  name: string;
  metric: ClimateMetric;
  unit: string | null;
}

const DEVICE_CLASS_METRIC: Record<string, ClimateMetric> = {
  temperature: 'temperature',
  humidity: 'humidity',
  pm25: 'pm25',
  pm10: 'pm10',
  carbon_dioxide: 'co2',
  volatile_organic_compounds: 'voc',
  volatile_organic_compounds_parts: 'voc',
  atmospheric_pressure: 'pressure',
  pressure: 'pressure',
  illuminance: 'illuminance',
};

/** Read-only Home Assistant client (REST + one-shot websocket commands). */
export class HomeAssistant {
  private cache = new Map<string, { at: number; value: unknown }>();
  constructor(private cfg: AppConfig['ha']) {}

  get enabled(): boolean {
    return Boolean(this.cfg.restUrl && this.cfg.token);
  }

  private async cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
    const value = await load();
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  async rest<T>(path: string): Promise<T> {
    if (!this.enabled) throw new Error('Home Assistant connection is not configured');
    const res = await fetch(`${this.cfg.restUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.cfg.token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Home Assistant ${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  /** Opens a websocket, authenticates, runs the commands and closes it. */
  ws(commands: Record<string, unknown>[]): Promise<unknown[]> {
    const { wsUrl, token } = this.cfg;
    if (!wsUrl || !token) return Promise.reject(new Error('Home Assistant connection is not configured'));
    return new Promise((resolve, reject) => {
      const sock = new WebSocket(wsUrl);
      const results = new Map<number, unknown>();
      const finish = (err?: Error) => {
        clearTimeout(timer);
        try {
          sock.close();
        } catch {
          /* already closed */
        }
        if (err) reject(err);
        else resolve(commands.map((_, i) => results.get(i + 1)));
      };
      const timer = setTimeout(() => finish(new Error('Home Assistant websocket timeout')), 15_000);
      sock.onerror = () => finish(new Error('Home Assistant websocket error'));
      sock.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data));
        if (msg.type === 'auth_required') sock.send(JSON.stringify({ type: 'auth', access_token: token }));
        else if (msg.type === 'auth_invalid') finish(new Error('Home Assistant rejected the access token'));
        else if (msg.type === 'auth_ok') commands.forEach((c, i) => sock.send(JSON.stringify({ ...c, id: i + 1 })));
        else if (msg.type === 'result') {
          results.set(msg.id, msg.success ? msg.result : null);
          if (results.size === commands.length) finish();
        }
      };
    });
  }

  states(): Promise<HaState[]> {
    return this.cached('states', 60_000, () => this.rest<HaState[]>('/states'));
  }

  async timeZone(): Promise<string | null> {
    try {
      const cfg = await this.cached('config', 3_600_000, () => this.rest<{ time_zone?: string }>('/config'));
      return cfg.time_zone ?? null;
    } catch {
      return null;
    }
  }

  /** Climate-type sensors grouped by HA area (entity area, falling back to the device's area). */
  areaSensors(): Promise<HaAreaSensor[]> {
    return this.cached('areaSensors', 300_000, async () => {
      const [areas, entities, devices] = (await this.ws([
        { type: 'config/area_registry/list' },
        { type: 'config/entity_registry/list' },
        { type: 'config/device_registry/list' },
      ])) as [
        { area_id: string; name: string }[] | null,
        { entity_id: string; area_id: string | null; device_id: string | null; disabled_by: string | null }[] | null,
        { id: string; area_id: string | null }[] | null,
      ];
      const states = await this.states();
      const areaName = new Map((areas ?? []).map((a) => [a.area_id, a.name]));
      const deviceArea = new Map((devices ?? []).map((d) => [d.id, d.area_id]));
      const stateById = new Map(states.map((s) => [s.entity_id, s]));
      const out: HaAreaSensor[] = [];
      for (const e of entities ?? []) {
        if (e.disabled_by || !e.entity_id.startsWith('sensor.')) continue;
        const areaId = e.area_id ?? (e.device_id ? deviceArea.get(e.device_id) : null);
        if (!areaId || !areaName.has(areaId)) continue;
        const st = stateById.get(e.entity_id);
        const metric = DEVICE_CLASS_METRIC[String(st?.attributes.device_class ?? '')];
        if (!st || !metric) continue;
        out.push({
          areaId,
          areaName: areaName.get(areaId)!,
          entity: e.entity_id,
          name: String(st.attributes.friendly_name ?? e.entity_id),
          metric,
          unit: (st.attributes.unit_of_measurement as string) ?? null,
        });
      }
      return out;
    });
  }

  /** Converts HA's Energy dashboard preferences into dashboard settings. */
  async energyPrefs(): Promise<Partial<EnergySettings>> {
    const [prefs] = (await this.ws([{ type: 'energy/get_prefs' }])) as [
      { energy_sources?: Record<string, any>[]; device_consumption?: Record<string, any>[] } | null,
    ];
    if (!prefs) throw new Error('Energy dashboard is not configured in Home Assistant');
    const isEntity = (s: unknown): s is string => typeof s === 'string' && /^[a-z0-9_]+\.[a-z0-9_]+$/.test(s);
    const out: Partial<EnergySettings> = {
      solar: [],
      gridImport: [],
      gridExport: [],
      batteryCharge: [],
      batteryDischarge: [],
      solarPower: [],
      gridPower: [],
      batteryPower: [],
      devices: [],
    };
    const push = (arr: string[] | undefined, v: unknown) => {
      if (arr && isEntity(v) && !arr.includes(v)) arr.push(v);
    };
    for (const src of prefs.energy_sources ?? []) {
      if (src.type === 'solar') {
        push(out.solar, src.stat_energy_from);
        push(out.solarPower, src.stat_rate);
      } else if (src.type === 'battery') {
        push(out.batteryDischarge, src.stat_energy_from);
        push(out.batteryCharge, src.stat_energy_to);
        push(out.batteryPower, src.stat_rate);
      } else if (src.type === 'grid') {
        for (const f of src.flow_from ?? []) push(out.gridImport, f.stat_energy_from);
        for (const f of src.flow_to ?? []) push(out.gridExport, f.stat_energy_to);
        push(out.gridImport, src.stat_energy_from);
        push(out.gridExport, src.stat_energy_to);
        for (const p of src.power ?? []) push(out.gridPower, p.stat_rate);
        push(out.gridPower, src.stat_rate);
      }
    }
    for (const d of prefs.device_consumption ?? []) {
      if (isEntity(d.stat_consumption)) {
        out.devices!.push({
          entity: d.stat_consumption,
          name: d.name || undefined,
          parent: isEntity(d.included_in_stat) ? d.included_in_stat : undefined,
        });
      }
    }
    return out;
  }
}
