import type { AppConfig } from './config.js';
import type { HomeAssistant } from './ha.js';
import { type EntityRef, groupRows, parseRef, refKey, type Row, type TsBackend } from './influx.js';
import type { SettingsStore } from './settings.js';
import type {
  EnergyResult,
  EntityInfo,
  EntityKind,
  LiveResult,
  PowerResult,
  ResolvedClimateArea,
  Series,
} from '../shared/types.js';

// Domains whose on/off style states HA stores as 1/0 in the "value" field.
const BINARY_DOMAINS = new Set([
  'binary_sensor',
  'switch',
  'light',
  'input_boolean',
  'fan',
  'lock',
  'cover',
  'automation',
  'script',
  'siren',
  'remote',
  'person',
  'device_tracker',
  'group',
  'sun',
]);

const sum = (xs: (number | null | undefined)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);

export class Services {
  private catalogCache: { at: number; list: EntityInfo[] } | null = null;

  constructor(
    private cfg: AppConfig,
    private influx: TsBackend,
    private ha: HomeAssistant,
    private settings: SettingsStore,
  ) {}

  // ---------- entity catalog ----------

  async entities(refresh = false): Promise<EntityInfo[]> {
    if (!refresh && this.catalogCache && Date.now() - this.catalogCache.at < 300_000) return this.catalogCache.list;
    const rows = await this.influx.catalog(this.cfg.entityLookbackDays);
    const states = this.ha.enabled ? await this.ha.states().catch(() => []) : [];
    const stateById = new Map(states.map((s) => [s.entity_id, s]));

    const byId = new Map<string, { fields: Set<string>; latest: Row; name?: string; measurement?: string }>();
    for (const r of rows) {
      const id = `${r.domain}.${r.entity_id}`;
      const e = byId.get(id);
      if (!e) {
        byId.set(id, { fields: new Set([r._field]), latest: r, name: r.friendly_name, measurement: r._measurement });
        continue;
      }
      e.fields.add(r._field);
      if (r._time > e.latest._time) {
        e.latest = r;
        e.name = r.friendly_name ?? e.name;
        if (r._field === 'value') e.measurement = r._measurement;
      }
    }

    const list: EntityInfo[] = [];
    for (const [id, e] of byId) {
      const [domain] = id.split('.');
      const st = stateById.get(id);
      const kind: EntityKind = e.fields.has('value') ? (BINARY_DOMAINS.has(domain) ? 'binary' : 'numeric') : 'text';
      const measurementUnit =
        e.measurement && e.measurement !== id && !/^[a-z0-9_]+\.[a-z0-9_]+$/.test(e.measurement) ? e.measurement : null;
      list.push({
        id,
        name: String(st?.attributes.friendly_name ?? e.name ?? id),
        unit: kind === 'numeric' ? ((st?.attributes.unit_of_measurement as string) ?? measurementUnit) : null,
        kind,
        last: e.latest._value,
        lastTime: e.latest._time,
        deviceClass: (st?.attributes.device_class as string) ?? null,
      });
    }
    list.sort((a, b) => a.name.localeCompare(b.name));
    this.catalogCache = { at: Date.now(), list };
    return list;
  }

  private async lookup(): Promise<Map<string, EntityInfo>> {
    const list = await this.entities().catch(() => [] as EntityInfo[]);
    return new Map(list.map((e) => [e.id, e]));
  }

  // ---------- history ----------

  async series(refs: EntityRef[], start: Date, stop: Date, every: string, tz: string): Promise<Series[]> {
    const info = await this.lookup();
    const kindOf = (r: EntityRef): EntityKind =>
      r.field !== 'value' ? 'numeric' : (info.get(r.id)?.kind ?? 'numeric');
    const numeric = refs.filter((r) => kindOf(r) === 'numeric');
    const binary = refs.filter((r) => kindOf(r) === 'binary');
    const text = refs.filter((r) => kindOf(r) === 'text').map((r) => ({ ...r, field: 'state' }));

    const [nRows, bRows, tRows] = await Promise.all([
      this.influx.series({ refs: numeric, start, stop, every, fn: 'mean', tz }),
      // max keeps short "on" periods visible after down-sampling
      this.influx.series({ refs: binary, start, stop, every, fn: 'max', tz }),
      this.influx.series({ refs: text, start, stop, every, fn: 'last', tz, numeric: false }),
    ]);
    const grouped = groupRows([...nRows, ...bRows, ...tRows]);

    return refs.map((r) => {
      const kind = kindOf(r);
      const key = kind === 'text' ? refKey(r.domain, r.objectId, 'state') : r.id;
      const pts = [...(grouped.get(key) ?? new Map()).entries()].sort((a, b) => a[0] - b[0]);
      const meta = info.get(r.id.split(':')[0]);
      return {
        entity: r.id,
        name: r.field !== 'value' ? `${meta?.name ?? r.id} (${r.field})` : (meta?.name ?? r.id),
        unit: r.field !== 'value' ? null : (meta?.unit ?? null),
        kind,
        points: pts.map(([t, v]) => [t, typeof v === 'number' ? Math.round(v * 1000) / 1000 : v]),
      };
    });
  }

  async latest(ids: string[]): Promise<Record<string, { value: number | string | null; time: string }>> {
    const refs = ids.map(parseRef).filter((r): r is EntityRef => r !== null);
    const rows = await this.influx.latest(refs, '30d');
    const out: Record<string, { value: number | string | null; time: string }> = {};
    for (const r of rows) {
      const key = refKey(r.domain, r.entity_id, r._field);
      if (!out[key] || r._time > out[key].time) out[key] = { value: r._value, time: r._time };
    }
    return out;
  }

  // ---------- energy ----------

  async energy(start: Date, stop: Date, every: string, tz: string): Promise<EnergyResult> {
    const s = this.settings.get().energy;
    const cats = ['solar', 'gridImport', 'gridExport', 'batteryCharge', 'batteryDischarge', 'consumption'] as const;
    const ids = new Set<string>([...cats.flatMap((c) => s[c]), ...s.devices.map((d) => d.entity)]);
    const refs = [...ids].map(parseRef).filter((r): r is EntityRef => r !== null);
    const grouped = groupRows(await this.influx.energy({ refs, start, stop, every, tz }));

    const timeSet = new Set<number>();
    for (const m of grouped.values()) for (const t of m.keys()) timeSet.add(t);
    const times = [...timeSet].sort((a, b) => a - b);
    const valuesOf = (id: string) => {
      const m = grouped.get(id);
      return times.map((t) => {
        const v = m?.get(t);
        return typeof v === 'number' ? v : 0;
      });
    };

    const categories = {} as EnergyResult['categories'];
    const configured: Record<string, boolean> = {};
    for (const c of cats) {
      const entities = s[c].map((entity) => ({ entity, values: valuesOf(entity) }));
      configured[c] = entities.length > 0;
      categories[c] = { entities, total: times.map((_, i) => sum(entities.map((e) => e.values[i]))) };
    }

    const consumptionDerived = !configured.consumption;
    if (consumptionDerived) {
      const k = categories;
      categories.consumption.total = times.map((_, i) =>
        Math.max(
          0,
          k.solar.total[i] +
            k.gridImport.total[i] -
            k.gridExport.total[i] +
            k.batteryDischarge.total[i] -
            k.batteryCharge.total[i],
        ),
      );
    }

    const info = await this.lookup();
    const devices = s.devices.map((d) => {
      const values = valuesOf(d.entity);
      const name = d.name || info.get(d.entity)?.name || d.entity;
      return { entity: d.entity, name, parent: d.parent, values, total: sum(values) };
    });

    return { times, configured, categories, consumptionDerived, devices };
  }

  // ---------- power ----------

  private powerRefs() {
    const s = this.settings.get().energy;
    const groups = {
      solar: s.solarPower,
      grid: s.gridPower,
      gridExport: s.gridExportPower,
      battery: s.batteryPower,
      consumption: s.consumptionPower,
      soc: s.batterySoc,
    };
    return { s, groups };
  }

  /** Combines per-entity values into the dashboard's power categories. */
  private combinePower(get: (id: string) => number | null | undefined) {
    const { s, groups } = this.powerRefs();
    const total = (ids: string[]) => {
      const vals = ids.map(get).filter((v): v is number => typeof v === 'number');
      return vals.length ? sum(vals) : null;
    };
    const solar = groups.solar.length ? total(groups.solar) : null;
    let grid: number | null = null;
    if (groups.grid.length || groups.gridExport.length) {
      const imp = total(groups.grid);
      const exp = total(groups.gridExport);
      grid = imp === null && exp === null ? null : (imp ?? 0) * (s.invertGridPower ? -1 : 1) - (exp ?? 0);
    }
    let battery: number | null = null;
    if (groups.battery.length) {
      const b = total(groups.battery);
      battery = b === null ? null : b * (s.invertBatteryPower ? -1 : 1);
    }
    let consumption: number | null = null;
    if (groups.consumption.length) consumption = total(groups.consumption);
    else if (solar !== null || grid !== null) consumption = Math.max(0, (solar ?? 0) + (grid ?? 0) + (battery ?? 0));
    let soc: number | null = null;
    if (groups.soc.length) {
      const vals = groups.soc.map(get).filter((v): v is number => typeof v === 'number');
      soc = vals.length ? sum(vals) / vals.length : null;
    }
    return { solar, grid, battery, consumption, soc };
  }

  async power(start: Date, stop: Date, every: string, tz: string): Promise<PowerResult> {
    const { groups } = this.powerRefs();
    const powerIds = [...groups.solar, ...groups.grid, ...groups.gridExport, ...groups.battery, ...groups.consumption];
    const parse = (ids: string[]) => [...new Set(ids)].map(parseRef).filter((r): r is EntityRef => r !== null);
    const [pRows, sRows] = await Promise.all([
      this.influx.series({ refs: parse(powerIds), start, stop, every, fn: 'mean', tz, scale: 'power' }),
      this.influx.series({ refs: parse(groups.soc), start, stop, every, fn: 'mean', tz }),
    ]);
    const grouped = groupRows([...pRows, ...sRows]);
    const timeSet = new Set<number>();
    for (const m of grouped.values()) for (const t of m.keys()) timeSet.add(t);
    const times = [...timeSet].sort((a, b) => a - b);

    const rows = times.map((t) =>
      this.combinePower((id) => {
        const v = grouped.get(id)?.get(t);
        return typeof v === 'number' ? v : null;
      }),
    );
    const col = (k: keyof ReturnType<Services['combinePower']>, enabled: boolean) =>
      enabled ? rows.map((r) => (r[k] === null ? null : Math.round(r[k]! * 10) / 10)) : null;
    return {
      times,
      solar: col('solar', groups.solar.length > 0),
      grid: col('grid', groups.grid.length + groups.gridExport.length > 0),
      battery: col('battery', groups.battery.length > 0),
      consumption: col('consumption', rows.some((r) => r.consumption !== null)),
      soc: col('soc', groups.soc.length > 0),
    };
  }

  async live(): Promise<LiveResult> {
    const { groups } = this.powerRefs();
    const ids = [...new Set(Object.values(groups).flat())];
    const refs = ids.map(parseRef).filter((r): r is EntityRef => r !== null);
    const rows = await this.influx.latest(refs, '1d');
    const latest = new Map<string, Row>();
    for (const r of rows) {
      const key = refKey(r.domain, r.entity_id, r._field);
      const cur = latest.get(key);
      if (!cur || r._time > cur._time) latest.set(key, r);
    }
    const scale = (r: Row) => {
      const v = Number(r._value);
      if (!Number.isFinite(v)) return null;
      if (r._measurement === 'kW') return v * 1000;
      if (r._measurement === 'MW') return v * 1_000_000;
      return v;
    };
    const combined = this.combinePower((id) => {
      const r = latest.get(id);
      return r ? scale(r) : null;
    });
    const updated = [...latest.values()].reduce<string | null>((a, r) => (!a || r._time > a ? r._time : a), null);
    return { ...combined, updated };
  }

  // ---------- climate ----------

  async climate(): Promise<ResolvedClimateArea[]> {
    const c = this.settings.get().climate;
    const areas: ResolvedClimateArea[] = [];
    const info = await this.lookup();

    if (c.autoFromHA && this.ha.enabled) {
      const sensors = await this.ha.areaSensors().catch(() => []);
      for (const s of sensors) {
        let area = areas.find((a) => a.id === s.areaId);
        if (!area) areas.push((area = { id: s.areaId, name: s.areaName, source: 'ha', sensors: [] }));
        area.sensors.push({ entity: s.entity, metric: s.metric, name: s.name, unit: s.unit, value: null, time: null });
      }
    }
    for (const m of c.areas) {
      let area = areas.find((a) => a.id === m.id || a.name.toLowerCase() === m.name.toLowerCase());
      if (!area) areas.push((area = { id: m.id, name: m.name, source: 'manual', sensors: [] }));
      for (const s of m.sensors) {
        if (area.sensors.some((x) => x.entity === s.entity)) continue;
        const meta = info.get(s.entity);
        area.sensors.push({
          ...s,
          name: meta?.name ?? s.entity,
          unit: meta?.unit ?? null,
          value: null,
          time: null,
        });
      }
    }

    const exclude = new Set(c.exclude);
    for (const a of areas) a.sensors = a.sensors.filter((s) => !exclude.has(s.entity));
    const visible = areas.filter((a) => a.sensors.length > 0);

    const latest = await this.latest(visible.flatMap((a) => a.sensors.map((s) => s.entity)));
    for (const a of visible) {
      for (const s of a.sensors) {
        const l = latest[s.entity];
        if (l && typeof l.value === 'number') {
          s.value = Math.round(l.value * 100) / 100;
          s.time = l.time;
        }
      }
    }
    return visible.sort((a, b) => a.name.localeCompare(b.name));
  }
}
