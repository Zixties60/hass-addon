import type { AppConfig } from './config.js';
import {
  checkDuration,
  type EnergyOpts,
  type EntityRef,
  type Row,
  scaleValue,
  type SeriesOpts,
  type TsBackend,
  tzOffsetMinutes,
} from './influx.js';

// InfluxDB 1.x backend (InfluxQL over the /query HTTP API), e.g. the official
// "InfluxDB" add-on from Home Assistant Community Apps. It returns the same rows as the
// Flux backend. Steps InfluxQL can't do (carrying values across empty windows, counter
// differences, calendar months) happen here in JavaScript.

interface V1Series {
  name: string;
  tags?: Record<string, string>;
  columns: string[];
  values: [number, unknown][];
}
interface V1Result {
  statement_id: number;
  series?: V1Series[];
  error?: string;
}

const DAY = 86_400_000;
const CARRY_MS = 30 * DAY;
const UNIT_MS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: DAY, w: 7 * DAY };

const lit = (d: Date) => `'${d.toISOString()}'`;
// Tag values and field names are validated by parseRef (lowercase/underscore identifiers only).
const where = (refs: EntityRef[]) =>
  `(${refs.map((r) => `("domain" = '${r.domain}' AND "entity_id" = '${r.objectId}')`).join(' OR ')})`;

function byField(refs: EntityRef[]): Map<string, EntityRef[]> {
  const m = new Map<string, EntityRef[]>();
  for (const r of refs) m.set(r.field, [...(m.get(r.field) ?? []), r]);
  return m;
}

function durationMs(d: string): number {
  const m = /^(\d+)(ms|s|m|h|d|w)$/.exec(d);
  if (!m) throw new Error(`Unsupported InfluxQL duration: ${d}`);
  return Number(m[1]) * UNIT_MS[m[2]];
}

const entityKey = (s: V1Series) => `${s.tags?.domain ?? ''}.${s.tags?.entity_id ?? ''}`;
const hasEntity = (s: V1Series) => Boolean(s.tags?.domain && s.tags?.entity_id);

// Builds without tzdata cannot resolve named zones; fall back to a fixed offset (see influx.ts).
let namedZonesSupported = true;

interface Grouping {
  time: (every: string) => string;
  tz: string;
}

export class Influx1 implements TsBackend {
  readonly label = 'InfluxDB 1.x (InfluxQL)';
  constructor(private cfg: AppConfig['influx']) {}

  private async run(statements: string[]): Promise<V1Result[]> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    };
    if (this.cfg.username) {
      headers.Authorization = `Basic ${Buffer.from(`${this.cfg.username}:${this.cfg.password}`).toString('base64')}`;
    }
    const res = await fetch(`${this.cfg.url}/query`, {
      method: 'POST',
      headers,
      body: new URLSearchParams({ q: statements.join(';\n'), db: this.cfg.database, epoch: 'ms' }),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let json: { results?: V1Result[]; error?: string };
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`InfluxDB HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    if (!res.ok || json.error) throw new Error(`InfluxDB: ${json.error ?? `HTTP ${res.status}`}`);
    const results = json.results ?? [];
    for (const r of results) if (r.error) throw new Error(`InfluxDB: ${r.error}`);
    return results;
  }

  /** Runs statements that use GROUP BY time(), aligning windows to local time in `tz`. */
  private async zoned(tz: string, at: Date, build: (g: Grouping) => string[]): Promise<V1Result[]> {
    const grouping = (): Grouping => {
      if (namedZonesSupported) return { time: (every) => `time(${every})`, tz: ` tz('${tz}')` };
      // Shift windows so they start at local midnight: offset = -utcOffset, modulo the window size.
      const shift = -tzOffsetMinutes(tz, at) * 60_000;
      return {
        time: (every) => {
          const size = durationMs(every);
          const off = ((shift % size) + size) % size;
          return off ? `time(${every}, ${Math.round(off / 60_000)}m)` : `time(${every})`;
        },
        tz: '',
      };
    };
    try {
      return await this.run(build(grouping()));
    } catch (e) {
      if (namedZonesSupported && /time ?zone/i.test(String((e as Error).message))) {
        namedZonesSupported = false;
        console.warn(`InfluxDB cannot load time zone "${tz}"; using fixed UTC offsets instead`);
        return this.run(build(grouping()));
      }
      throw e;
    }
  }

  async ping(): Promise<void> {
    // Fails with "database not found" (unlike SHOW MEASUREMENTS) and needs only read access.
    await this.run([`SHOW RETENTION POLICIES ON "${this.cfg.database.replace(/["\\]/g, '\\$&')}"`]);
  }

  private rows(results: V1Result[], field: string, withName = false): Row[] {
    const out: Row[] = [];
    for (const r of results) {
      for (const s of r.series ?? []) {
        if (!hasEntity(s)) continue;
        for (const [time, v] of s.values) {
          out.push({
            _time: new Date(time).toISOString(),
            _value: v as Row['_value'],
            _field: field,
            _measurement: s.name,
            domain: s.tags!.domain,
            entity_id: s.tags!.entity_id,
            ...(withName && s.tags?.friendly_name ? { friendly_name: s.tags.friendly_name } : {}),
          });
        }
      }
    }
    return out;
  }

  async catalog(lookbackDays: number): Promise<Row[]> {
    const since = `now() - ${Math.max(1, Math.round(lookbackDays))}d`;
    const fields = ['value', 'state'];
    const results = await this.run(
      fields.map(
        (f) => `SELECT last("${f}") AS v FROM /.*/ WHERE time > ${since} GROUP BY "domain", "entity_id", "friendly_name"`,
      ),
    );
    return results.flatMap((r, i) => this.rows([r], fields[i], true));
  }

  async latest(refs: EntityRef[], lookback = '7d'): Promise<Row[]> {
    if (!refs.length) return [];
    const groups = [...byField(refs)];
    const results = await this.run(
      groups.map(
        ([field, rs]) =>
          `SELECT last("${field}") AS v FROM /.*/ WHERE ${where(rs)} AND time > now() - ${checkDuration(lookback)} GROUP BY "domain", "entity_id"`,
      ),
    );
    return results.flatMap((r, i) => this.rows([r], groups[i][0]));
  }

  /**
   * Window aggregates plus the last value before `start`. Numeric series carry that value
   * (and every later one) forward through empty windows, like the Flux backend.
   */
  async series(o: SeriesOpts): Promise<Row[]> {
    if (!o.refs.length) return [];
    const numeric = o.numeric !== false;
    const startMs = o.start.getTime();
    const out: Row[] = [];

    for (const [field, refs] of byField(o.refs)) {
      const w = where(refs);
      const [data, carry] = await this.zoned(o.tz, o.start, (g) => [
        `SELECT ${o.fn}("${field}") AS v FROM /.*/ WHERE ${w} AND time >= ${lit(o.start)} AND time < ${lit(o.stop)} ` +
          `GROUP BY ${g.time(checkDuration(o.every))}, "domain", "entity_id" fill(${numeric ? 'null' : 'none'})${g.tz}`,
        `SELECT last("${field}") AS v FROM /.*/ WHERE ${w} AND time >= ${lit(new Date(startMs - CARRY_MS))} AND time < ${lit(o.start)} GROUP BY "domain", "entity_id"`,
      ]);

      const value = (v: unknown, s: V1Series) =>
        v === null || v === undefined ? null : numeric ? scaleValue(Number(v), s.name, o.scale) : (v as string | number);

      // An entity can span several measurements (e.g. after a unit change): merge them.
      const ents = new Map<string, { domain: string; entity_id: string; buckets: Map<number, unknown>; carry?: [number, unknown] }>();
      const entity = (s: V1Series) => {
        const key = entityKey(s);
        let e = ents.get(key);
        if (!e) ents.set(key, (e = { domain: s.tags!.domain, entity_id: s.tags!.entity_id, buckets: new Map() }));
        return e;
      };
      for (const s of data.series ?? []) {
        if (!hasEntity(s)) continue;
        const e = entity(s);
        for (const [time, v] of s.values) {
          const val = value(v, s);
          if (!e.buckets.has(time) || (e.buckets.get(time) === null && val !== null)) e.buckets.set(time, val);
        }
      }
      for (const s of carry.series ?? []) {
        if (!hasEntity(s) || !s.values.length) continue;
        const e = entity(s);
        const [time, v] = s.values[0];
        if (!e.carry || time > e.carry[0]) e.carry = [time, value(v, s)];
      }

      for (const e of ents.values()) {
        const push = (time: number, v: unknown) =>
          out.push({
            _time: new Date(Math.max(time, startMs)).toISOString(),
            _value: v as Row['_value'],
            _field: field,
            domain: e.domain,
            entity_id: e.entity_id,
          });
        const times = [...e.buckets.keys()].sort((a, b) => a - b);
        if (numeric) {
          let prev = e.carry?.[1] ?? null;
          if (prev !== null && (!times.length || times[0] > startMs)) push(startMs, prev);
          for (const time of times) {
            const v = e.buckets.get(time) ?? prev;
            prev = v;
            if (v !== null) push(time, v);
          }
        } else {
          if (e.carry && e.carry[1] !== null) push(startMs, e.carry[1]);
          for (const time of times) if (e.buckets.get(time) !== null) push(time, e.buckets.get(time));
        }
      }
    }
    return out;
  }

  /**
   * Energy per window from cumulative counters: the last reading of each window minus the
   * previous one. A drop to less than half the previous reading is a meter reset (e.g. a
   * "daily yield" sensor at midnight) and counts the new reading; smaller dips are noise and count 0.
   */
  async energy(o: EnergyOpts): Promise<Row[]> {
    if (!o.refs.length) return [];
    // Differences are taken on sub-windows shorter than a day, so counters that reset daily
    // still register; the sub-windows are then summed into local days or calendar months
    // (InfluxQL has no month windows).
    const rollup =
      o.every === '1d'
        ? new Intl.DateTimeFormat('en-CA', { timeZone: o.tz, year: 'numeric', month: '2-digit', day: '2-digit' })
        : o.every === '1mo'
          ? new Intl.DateTimeFormat('en-CA', { timeZone: o.tz, year: 'numeric', month: '2-digit' })
          : null;
    const every = o.every === '1d' ? '1h' : o.every === '1mo' ? '3h' : checkDuration(o.every);
    const startMs = o.start.getTime();
    const w = where(o.refs);
    const [data, carry] = await this.zoned(o.tz, o.start, (g) => [
      `SELECT last("value") AS v FROM /.*/ WHERE ${w} AND time >= ${lit(o.start)} AND time < ${lit(o.stop)} ` +
        `GROUP BY ${g.time(every)}, "domain", "entity_id" fill(null)${g.tz}`,
      `SELECT last("value") AS v FROM /.*/ WHERE ${w} AND time >= ${lit(new Date(startMs - CARRY_MS))} AND time < ${lit(o.start)} GROUP BY "domain", "entity_id"`,
    ]);

    const ents = new Map<string, { domain: string; entity_id: string; buckets: Map<number, number | null>; carry?: [number, number] }>();
    const entity = (s: V1Series) => {
      const key = entityKey(s);
      let e = ents.get(key);
      if (!e) ents.set(key, (e = { domain: s.tags!.domain, entity_id: s.tags!.entity_id, buckets: new Map() }));
      return e;
    };
    for (const s of data.series ?? []) {
      if (!hasEntity(s)) continue;
      const e = entity(s);
      for (const [time, v] of s.values) {
        const val = v === null ? null : scaleValue(Number(v), s.name, 'energy');
        if (!e.buckets.has(time) || (e.buckets.get(time) === null && val !== null)) e.buckets.set(time, val);
      }
    }
    for (const s of carry.series ?? []) {
      if (!hasEntity(s) || !s.values.length) continue;
      const e = entity(s);
      const [time, v] = s.values[0];
      if (v !== null && (!e.carry || time > e.carry[0])) e.carry = [time, scaleValue(Number(v), s.name, 'energy')];
    }

    const out: Row[] = [];
    for (const e of ents.values()) {
      let prev: number | null = e.carry?.[1] ?? null;
      const windows: [number, number][] = [];
      for (const time of [...e.buckets.keys()].sort((a, b) => a - b)) {
        const v = e.buckets.get(time) ?? null;
        let used = 0;
        if (v !== null) {
          if (prev !== null) {
            const diff = v - prev;
            used = diff >= 0 ? diff : v < prev / 2 ? v : 0;
          }
          prev = v;
        }
        windows.push([Math.max(time, startMs), used]);
      }

      let result = windows;
      if (rollup) {
        const groups = new Map<string, [number, number]>();
        for (const [time, used] of windows) {
          const key = rollup.format(time);
          const g = groups.get(key);
          if (g) g[1] += used;
          else groups.set(key, [time, used]);
        }
        result = [...groups.values()];
      }
      for (const [time, used] of result) {
        out.push({ _time: new Date(time).toISOString(), _value: used, _field: 'value', domain: e.domain, entity_id: e.entity_id });
      }
    }
    return out;
  }
}
