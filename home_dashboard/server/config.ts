import fs from 'node:fs';

export interface AppConfig {
  port: number;
  dataDir: string;
  mode: 'addon' | 'standalone';
  influx: {
    /** "auto" detects the server version from /ping. */
    version: 'auto' | '1' | '2';
    url: string;
    // 1.x (e.g. the official InfluxDB add-on)
    database: string;
    username: string;
    password: string;
    // 2.x
    token: string;
    org: string;
    bucket: string;
  };
  ha: { restUrl: string | null; wsUrl: string | null; token: string | null };
  allowSettingsEdit: boolean;
  entityLookbackDays: number;
}

/** Reads add-on options (/data/options.json) and lets environment variables override them. */
export function loadConfig(): AppConfig {
  const dataDir = process.env.DATA_DIR ?? '/data';
  let opts: Record<string, unknown> = {};
  try {
    opts = JSON.parse(fs.readFileSync(`${dataDir}/options.json`, 'utf8'));
  } catch {
    // Not running as an add-on, or no options yet.
  }
  const pick = (env: string, key: string, def = ''): string => {
    const v = process.env[env] ?? opts[key];
    return v === undefined || v === null ? def : String(v);
  };

  const supervisorToken = process.env.SUPERVISOR_TOKEN;
  const mode: AppConfig['mode'] = supervisorToken ? 'addon' : 'standalone';

  let ha: AppConfig['ha'] = { restUrl: null, wsUrl: null, token: null };
  const haUrl = pick('HA_URL', 'ha_url').replace(/\/+$/, '');
  const haToken = pick('HA_TOKEN', 'ha_token');
  if (haUrl && haToken) {
    ha = { restUrl: `${haUrl}/api`, wsUrl: `${haUrl.replace(/^http/, 'ws')}/api/websocket`, token: haToken };
  } else if (supervisorToken) {
    ha = {
      restUrl: 'http://supervisor/core/api',
      wsUrl: 'ws://supervisor/core/websocket',
      token: supervisorToken,
    };
  }

  const allow = pick('ALLOW_SETTINGS_EDIT', 'allow_settings_edit', 'true');
  const version = pick('INFLUX_VERSION', 'influx_version', 'auto');

  return {
    port: Number(process.env.PORT ?? 8099),
    dataDir,
    mode,
    influx: {
      version: version === '1' || version === '2' ? version : 'auto',
      // Default: the official InfluxDB add-on (Home Assistant Community Apps).
      url: pick('INFLUX_URL', 'influx_url', 'http://a0d7b954-influxdb:8086').replace(/\/+$/, ''),
      database: pick('INFLUX_DATABASE', 'influx_database', 'homeassistant'),
      username: pick('INFLUX_USERNAME', 'influx_username'),
      password: pick('INFLUX_PASSWORD', 'influx_password'),
      token: pick('INFLUX_TOKEN', 'influx_token'),
      org: pick('INFLUX_ORG', 'influx_org', 'homeassistant'),
      bucket: pick('INFLUX_BUCKET', 'influx_bucket', 'homeassistant'),
    },
    ha,
    allowSettingsEdit: allow !== 'false',
    entityLookbackDays: Number(pick('ENTITY_LOOKBACK_DAYS', 'entity_lookback_days', '30')) || 30,
  };
}
