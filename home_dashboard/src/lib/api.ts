import type {
  AppInfo,
  DashboardSettings,
  EnergyResult,
  EnergySettings,
  EntityInfo,
  LiveResult,
  PowerResult,
  ResolvedClimateArea,
  Series,
} from '../../shared/types';

export const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

// Relative URLs: works both at "/" and under HA ingress ("/api/hassio_ingress/<token>/").
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`api/${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as T;
}

export interface TimeQuery {
  start: Date;
  stop: Date;
  every: string;
}

const qs = (q: TimeQuery) =>
  new URLSearchParams({ start: q.start.toISOString(), stop: q.stop.toISOString(), every: q.every, tz: TZ }).toString();

export const api = {
  info: () => request<AppInfo>('info'),
  entities: (refresh = false) => request<EntityInfo[]>(`entities${refresh ? '?refresh=1' : ''}`),
  series: (entities: string[], q: TimeQuery) =>
    request<{ series: Series[] }>('series', {
      method: 'POST',
      body: JSON.stringify({
        entities,
        start: q.start.toISOString(),
        stop: q.stop.toISOString(),
        every: q.every,
        tz: TZ,
      }),
    }).then((r) => r.series),
  energy: (q: TimeQuery) => request<EnergyResult>(`energy?${qs(q)}`),
  power: (q: TimeQuery) => request<PowerResult>(`power?${qs(q)}`),
  live: () => request<LiveResult>('live'),
  climate: () => request<ResolvedClimateArea[]>('climate'),
  settings: () => request<DashboardSettings>('settings'),
  saveSettings: (s: DashboardSettings) =>
    request<DashboardSettings>('settings', { method: 'PUT', body: JSON.stringify(s) }),
  haEnergyPrefs: () => request<Partial<EnergySettings>>('ha/energy-prefs'),
};
