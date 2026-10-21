import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import fs from 'node:fs';
import { loadConfig } from './config.js';
import { HomeAssistant } from './ha.js';
import { AutoBackend } from './backend.js';
import { checkDuration, checkTime, checkTz, HttpError, parseRefs } from './influx.js';
import { Services } from './services.js';
import { SettingsStore } from './settings.js';
import type { AppInfo } from '../shared/types.js';

const VERSION = process.env.APP_VERSION ?? 'dev';
const cfg = loadConfig();
const influx = new AutoBackend(cfg.influx);
const ha = new HomeAssistant(cfg.ha);
const settings = new SettingsStore(cfg.dataDir);
const svc = new Services(cfg, influx, ha, settings);

const app = new Hono();

app.onError((err, c) => {
  const status = err instanceof HttpError ? err.status : 500;
  if (status >= 500) console.error(`[${c.req.method} ${c.req.path}]`, err);
  return c.json({ error: err.message }, status as 400 | 500);
});

const range = (q: (k: string) => string | undefined) => ({
  start: checkTime(q('start'), 'start'),
  stop: checkTime(q('stop'), 'stop'),
  every: checkDuration(q('every') ?? '1h'),
  tz: checkTz(q('tz')),
});

/** Sampled series repeat the last value into empty windows, so never extend them past now. */
const untilNow = (d: Date) => new Date(Math.min(d.getTime(), Date.now()));

app.get('/api/info', async (c) => {
  let influxOk = true;
  let influxError: string | undefined;
  try {
    await influx.ping();
  } catch (e) {
    influxOk = false;
    influxError = (e as Error).message;
  }
  let haConnected = false;
  if (ha.enabled) haConnected = await ha.states().then(() => true, () => false);
  const info: AppInfo = {
    version: VERSION,
    mode: cfg.mode,
    haConnected,
    influxOk,
    influxError,
    influxBackend: `${influx.label}${influx.serverVersion ? ` · server ${influx.serverVersion}` : ''}`,
    allowSettingsEdit: cfg.allowSettingsEdit,
  };
  return c.json(info);
});

app.get('/api/entities', async (c) => c.json(await svc.entities(c.req.query('refresh') === '1')));

app.post('/api/series', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const refs = parseRefs(body.entities).slice(0, 40);
  const r = range((k) => body[k]);
  return c.json({ series: await svc.series(refs, r.start, untilNow(r.stop), r.every, r.tz) });
});

app.get('/api/latest', async (c) => {
  const ids = (c.req.query('entities') ?? '').split(',').filter(Boolean).slice(0, 100);
  return c.json(await svc.latest(ids));
});

app.get('/api/energy', async (c) => {
  const r = range((k) => c.req.query(k));
  return c.json(await svc.energy(r.start, r.stop, r.every, r.tz));
});

app.get('/api/power', async (c) => {
  const r = range((k) => c.req.query(k));
  return c.json(await svc.power(r.start, untilNow(r.stop), r.every, r.tz));
});

app.get('/api/live', async (c) => c.json(await svc.live()));

app.get('/api/climate', async (c) => c.json(await svc.climate()));

app.get('/api/settings', (c) => c.json(settings.get()));

app.put('/api/settings', async (c) => {
  if (!cfg.allowSettingsEdit) throw new HttpError(403, 'Editing settings is disabled in the add-on configuration');
  return c.json(settings.save(await c.req.json()));
});

app.get('/api/ha/energy-prefs', async (c) => {
  if (!ha.enabled) throw new HttpError(400, 'Home Assistant connection is not configured');
  return c.json(await ha.energyPrefs());
});

app.get('/api/ha/timezone', async (c) => c.json({ timeZone: ha.enabled ? await ha.timeZone() : null }));

app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

// Built web UI. Asset paths are relative so the app works behind HA ingress.
const webRoot = process.env.WEB_ROOT ?? './dist/web';
app.use('/*', serveStatic({ root: webRoot }));
app.get('*', (c) => {
  try {
    return c.html(fs.readFileSync(`${webRoot}/index.html`, 'utf8'));
  } catch {
    return c.text('Web UI not built. Run "npm run build".', 404);
  }
});

/** First start: copy the setup from Home Assistant's Energy dashboard if available. */
async function bootstrapSettings() {
  if (settings.exists() || !ha.enabled) return;
  try {
    const prefs = await ha.energyPrefs();
    settings.save({ ...settings.get(), energy: { ...settings.get().energy, ...prefs } });
    console.log('Imported energy configuration from Home Assistant');
  } catch (e) {
    console.log(`Energy preferences not imported: ${(e as Error).message}`);
  }
}

serve({ fetch: app.fetch, port: cfg.port }, () => {
  console.log(`Home Dashboard ${VERSION} (${cfg.mode}) listening on :${cfg.port}`);
  const i = cfg.influx;
  console.log(
    `InfluxDB ${i.url} (version: ${i.version}) 1.x database=${i.database} user=${i.username || '-'} | 2.x org=${i.org} bucket=${i.bucket}`,
  );
  console.log(`Home Assistant API: ${ha.enabled ? cfg.ha.restUrl : 'not configured'}`);
  void bootstrapSettings();
});
