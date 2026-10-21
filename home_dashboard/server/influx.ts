import { InfluxDB, type QueryApi } from '@influxdata/influxdb-client';
import type { AppConfig } from './config.js';

// Home Assistant's InfluxDB integration writes one point per state change:
//   measurement = unit of measurement (or "<domain>.<object_id>" when unitless)
//   tags        = domain, entity_id (object id only), friendly_name, ...
//   fields      = value (numeric state), state (non-numeric state), plus attributes
// Every query below filters on the domain/entity_id tags and the field, so it works
// regardless of how measurements are named.

export interface EntityRef {
  id: string;
  domain: string;
  objectId: string;
  field: string;
}

const REF_RE = /^([a-z0-9_]+)\.([a-z0-9_]+)(?::([A-Za-z0-9_]+))?$/;
const DURATION_RE = /^\d+(mo|ms|s|m|h|d|w|y)$/;
const TZ_RE = /^[A-Za-z0-9_+\-/]{1,64}$/;

export function parseRef(id: string): EntityRef | null {
  const m = REF_RE.exec(id.trim());
  if (!m) return null;
  return { id: id.trim(), domain: m[1], objectId: m[2], field: m[3] ?? 'value' };
}

export function parseRefs(ids: unknown): EntityRef[] {
  if (!Array.isArray(ids)) return [];
  const out: EntityRef[] = [];
  for (const id of ids) {
    const ref = typeof id === 'string' ? parseRef(id) : null;
    if (ref && !out.some((r) => r.id === ref.id)) out.push(ref);
  }
  return out;
}

export function refKey(domain: string, objectId: string, field: string): string {
  return field === 'value' ? `${domain}.${objectId}` : `${domain}.${objectId}:${field}`;
}

export function checkDuration(d: string): string {
  if (!DURATION_RE.test(d)) throw new HttpError(400, `Invalid duration: ${d}`);
  return d;
}

export function checkTz(tz: string | undefined): string {
  return tz && TZ_RE.test(tz) ? tz : 'UTC';
}

export function checkTime(t: unknown, name: string): Date {
  const d = new Date(String(t));
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `Invalid ${name}`);
  return d;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const filterExpr = (refs: EntityRef[], field?: string) =>
  refs
    .map(
      (r) =>
        `(r.domain == "${r.domain}" and r.entity_id == "${r.objectId}" and r._field == "${field ?? r.field}")`,
    )
    .join(' or ');

/** UTC offset of `tz` at `at`, in minutes (e.g. 420 for UTC+7). */
export function tzOffsetMinutes(tz: string, at: Date): number {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
      })
        .formatToParts(at)
        .map((p) => [p.type, Number(p.value)]),
    );
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
  } catch {
    return 0;
  }
}

/** A signed minute count as a duration literal such as "7h" or "-3h30m" (valid in Flux and InfluxQL). */
export function minutesDuration(minutes: number): string {
  const sign = minutes < 0 ? '-' : '';
  const abs = Math.abs(minutes);
  return `${sign}${Math.floor(abs / 60)}h${abs % 60 ? `${abs % 60}m` : ''}`;
}

// Some InfluxDB builds (e.g. Alpine images without tzdata) cannot resolve named zones;
// after the first failure, fall back to the zone's fixed offset at the start of the range.
let namedZonesSupported = true;
const preamble = (tz: string, at: Date) =>
  namedZonesSupported
    ? `import "timezone"\noption location = timezone.location(name: "${tz}")\n`
    : `import "timezone"\noption location = timezone.fixed(offset: ${minutesDuration(tzOffsetMinutes(tz, at))})\n`;
const iso = (d: Date) => d.toISOString();
const KEY_COLS = '["domain", "entity_id", "_field"]';

/** Converts energy measurements to kWh and power to W, based on the unit used as measurement name. */
const SCALE = {
  energy: `|> map(fn: (r) => ({r with _value: if r._measurement == "Wh" then r._value / 1000.0 else if r._measurement == "MWh" then r._value * 1000.0 else r._value}))`,
  power: `|> map(fn: (r) => ({r with _value: if r._measurement == "kW" then r._value * 1000.0 else if r._measurement == "MW" then r._value * 1000000.0 else r._value}))`,
  none: '',
};

/** Same unit normalization as SCALE, applied in JavaScript. */
export function scaleValue(v: number, measurement: string | undefined, scale: SeriesOpts['scale']): number {
  if (scale === 'energy') return measurement === 'Wh' ? v / 1000 : measurement === 'MWh' ? v * 1000 : v;
  if (scale === 'power') return measurement === 'kW' ? v * 1000 : measurement === 'MW' ? v * 1_000_000 : v;
  return v;
}

export interface Row {
  _time: string;
  _value: number | string | null;
  _field: string;
  _measurement?: string;
  domain: string;
  entity_id: string;
  friendly_name?: string;
}

export interface SeriesOpts {
  refs: EntityRef[];
  start: Date;
  stop: Date;
  every: string;
  fn: 'mean' | 'max' | 'min' | 'last';
  tz: string;
  /** Unit normalization: energy to kWh, power to W. */
  scale?: 'energy' | 'power' | 'none';
  /** Numeric series repeat the previous value into empty windows; text series do not. */
  numeric?: boolean;
}

export interface EnergyOpts {
  refs: EntityRef[];
  start: Date;
  stop: Date;
  every: string;
  tz: string;
}

/** Query operations the dashboard needs, implemented for InfluxDB 1.x (InfluxQL) and 2.x (Flux). */
export interface TsBackend {
  readonly label: string;
  ping(): Promise<void>;
  /** Last point of every entity's value/state field within the lookback period. */
  catalog(lookbackDays: number): Promise<Row[]>;
  latest(refs: EntityRef[], lookback?: string): Promise<Row[]>;
  series(opts: SeriesOpts): Promise<Row[]>;
  /** Energy (kWh) per window from cumulative counters. */
  energy(opts: EnergyOpts): Promise<Row[]>;
}

/** InfluxDB 2.x backend using Flux. */
export class Influx2 implements TsBackend {
  readonly label = 'InfluxDB 2.x (Flux)';
  private api: QueryApi;
  constructor(private cfg: AppConfig['influx']) {
    this.api = new InfluxDB({ url: cfg.url, token: cfg.token, timeout: 60_000 }).getQueryApi(cfg.org);
  }

  query<T = Row>(flux: string): Promise<T[]> {
    return this.api.collectRows<T>(flux);
  }

  /** Runs a query that needs a time zone, retrying with a fixed offset if named zones are unavailable. */
  private async zoned(tz: string, at: Date, build: (pre: string) => string): Promise<Row[]> {
    try {
      return await this.query(build(preamble(tz, at)));
    } catch (e) {
      if (namedZonesSupported && /unknown time zone/i.test(String((e as Error).message))) {
        namedZonesSupported = false;
        console.warn(`InfluxDB cannot load time zone "${tz}"; using fixed UTC offsets instead`);
        return this.query(build(preamble(tz, at)));
      }
      throw e;
    }
  }

  async ping(): Promise<void> {
    await this.query(`buckets() |> filter(fn: (r) => r.name == "${this.cfg.bucket}") |> limit(n: 1)`);
  }

  private from() {
    return `from(bucket: "${this.cfg.bucket}")`;
  }

  /** Last point of every series that has a value/state field within the lookback period. */
  catalog(lookbackDays: number): Promise<Row[]> {
    return this.query(`${this.from()}
  |> range(start: -${Math.max(1, Math.round(lookbackDays))}d)
  |> filter(fn: (r) => r._field == "value" or r._field == "state")
  |> last()
  |> keep(columns: ["_time", "_value", "_field", "_measurement", "domain", "entity_id", "friendly_name"])`);
  }

  /** Latest point per series for the given entities (one row per underlying series). */
  latest(refs: EntityRef[], lookback = '7d'): Promise<Row[]> {
    if (!refs.length) return Promise.resolve([]);
    return this.query(`${this.from()}
  |> range(start: -${checkDuration(lookback)})
  |> filter(fn: (r) => ${filterExpr(refs)})
  |> last()
  |> keep(columns: ["_time", "_value", "_field", "_measurement", "domain", "entity_id"])`);
  }

  /**
   * Down-sampled numeric series. The value just before `start` is carried in so that
   * sparse (write-on-change) sensors start at the right level; empty windows repeat
   * the previous value because Home Assistant only writes when a state changes.
   */
  series(opts: SeriesOpts): Promise<Row[]> {
    const { refs, start, stop, every, fn, tz } = opts;
    if (!refs.length) return Promise.resolve([]);
    const filt = filterExpr(refs);
    const numeric = opts.numeric !== false;
    const cast = numeric ? `|> toFloat()\n  ${SCALE[opts.scale ?? 'none']}` : '';
    const carryStart = new Date(start.getTime() - 30 * 86_400_000);
    return this.zoned(tz, start, (pre) => `${pre}
prev = ${this.from()}
  |> range(start: ${iso(carryStart)}, stop: ${iso(start)})
  |> filter(fn: (r) => ${filt})
  ${cast}
  |> keep(columns: ["_time", "_value", "domain", "entity_id", "_field"])
  |> group(columns: ${KEY_COLS})
  |> sort(columns: ["_time"])
  |> last()
  |> map(fn: (r) => ({r with _time: ${iso(start)}}))

data = ${this.from()}
  |> range(start: ${iso(start)}, stop: ${iso(stop)})
  |> filter(fn: (r) => ${filt})
  ${cast}
  |> keep(columns: ["_time", "_value", "domain", "entity_id", "_field"])

union(tables: [prev, data])
  |> group(columns: ${KEY_COLS})
  |> sort(columns: ["_time"])
  |> range(start: ${iso(start)}, stop: ${iso(stop)})
  |> aggregateWindow(every: ${checkDuration(every)}, fn: ${fn}, createEmpty: ${numeric}, timeSrc: "_start")
  ${numeric ? '|> fill(usePrevious: true)' : ''}
  |> keep(columns: ["_time", "_value", "domain", "entity_id", "_field"])`);
  }

  /**
   * Energy consumed/produced per window from cumulative counters. Uses the difference
   * between consecutive readings; drops (meter resets, e.g. "daily yield" sensors) are ignored.
   */
  energy(opts: EnergyOpts): Promise<Row[]> {
    const { refs, start, stop, every, tz } = opts;
    if (!refs.length) return Promise.resolve([]);
    const filt = filterExpr(refs);
    const carryStart = new Date(start.getTime() - 30 * 86_400_000);
    return this.zoned(tz, start, (pre) => `${pre}
prev = ${this.from()}
  |> range(start: ${iso(carryStart)}, stop: ${iso(start)})
  |> filter(fn: (r) => ${filt})
  |> toFloat()
  ${SCALE.energy}
  |> keep(columns: ["_time", "_value", "domain", "entity_id", "_field"])
  |> group(columns: ${KEY_COLS})
  |> sort(columns: ["_time"])
  |> last()

data = ${this.from()}
  |> range(start: ${iso(start)}, stop: ${iso(stop)})
  |> filter(fn: (r) => ${filt})
  |> toFloat()
  ${SCALE.energy}
  |> keep(columns: ["_time", "_value", "domain", "entity_id", "_field"])

union(tables: [prev, data])
  |> group(columns: ${KEY_COLS})
  |> sort(columns: ["_time"])
  |> difference(nonNegative: true)
  |> range(start: ${iso(start)}, stop: ${iso(stop)})
  |> aggregateWindow(every: ${checkDuration(every)}, fn: sum, createEmpty: true, timeSrc: "_start")
  |> fill(value: 0.0)
  |> keep(columns: ["_time", "_value", "domain", "entity_id", "_field"])`);
  }
}

/** Groups rows into per-entity point lists, aligned on time. */
export function groupRows(rows: Row[]): Map<string, Map<number, number | string | null>> {
  const out = new Map<string, Map<number, number | string | null>>();
  for (const r of rows) {
    const key = refKey(r.domain, r.entity_id, r._field);
    let m = out.get(key);
    if (!m) out.set(key, (m = new Map()));
    m.set(Date.parse(r._time), r._value);
  }
  return out;
}
