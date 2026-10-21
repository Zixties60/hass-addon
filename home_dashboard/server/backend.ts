import type { AppConfig } from './config.js';
import { type EnergyOpts, type EntityRef, Influx2, type Row, type SeriesOpts, type TsBackend } from './influx.js';
import { Influx1 } from './influx1.js';

/**
 * Picks the InfluxDB 1.x or 2.x backend. With version "auto", the server version is read
 * from the X-Influxdb-Version header of /ping on first use (retried until it succeeds).
 */
export class AutoBackend implements TsBackend {
  private inner: TsBackend | null = null;
  private detecting: Promise<TsBackend> | null = null;
  serverVersion: string | null = null;

  constructor(private cfg: AppConfig['influx']) {
    if (cfg.version === '1') this.inner = new Influx1(cfg);
    if (cfg.version === '2') this.inner = new Influx2(cfg);
  }

  get label(): string {
    return this.inner?.label ?? 'InfluxDB (version not detected yet)';
  }

  private async readVersion(): Promise<string> {
    const res = await fetch(`${this.cfg.url}/ping`, { signal: AbortSignal.timeout(10_000) });
    const v = res.headers.get('x-influxdb-version') ?? '';
    this.serverVersion = v || null;
    return v;
  }

  private resolve(): Promise<TsBackend> {
    if (this.inner) return Promise.resolve(this.inner);
    this.detecting ??= this.readVersion()
      .then((v) => {
        const major = /^v?(\d+)/.exec(v)?.[1];
        // Unknown version: a token means 2.x, otherwise assume the 1.x add-on.
        const use2 = major ? major !== '1' : Boolean(this.cfg.token);
        this.inner = use2 ? new Influx2(this.cfg) : new Influx1(this.cfg);
        console.log(`Detected InfluxDB ${v || 'version unknown'}; using ${this.inner.label}`);
        return this.inner;
      })
      .finally(() => {
        this.detecting = null;
      });
    return this.detecting;
  }

  async ping(): Promise<void> {
    if (this.inner && !this.serverVersion) await this.readVersion().catch(() => undefined);
    await (await this.resolve()).ping();
  }
  async catalog(lookbackDays: number): Promise<Row[]> {
    return (await this.resolve()).catalog(lookbackDays);
  }
  async latest(refs: EntityRef[], lookback?: string): Promise<Row[]> {
    return (await this.resolve()).latest(refs, lookback);
  }
  async series(opts: SeriesOpts): Promise<Row[]> {
    return (await this.resolve()).series(opts);
  }
  async energy(opts: EnergyOpts): Promise<Row[]> {
    return (await this.resolve()).energy(opts);
  }
}
