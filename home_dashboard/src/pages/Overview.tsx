import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { dayBounds } from '../lib/time';
import type { PowerResult } from '../../shared/types';
import { areaStyle, baseOption, EChart, type EOption, lineSeries, timeAxis, valueAxis } from '../components/Chart';
import { Card, ChartCard, Empty, ErrorBox, Loading, PageHeader, SettingsLink, StatTile } from '../components/ui';
import { api } from '../lib/api';
import { CLIMATE_METRICS } from '../../shared/types';
import { climateStatus, METRIC_ORDER, StatusChip } from '../lib/climate';
import { totals } from '../lib/energy';
import { fmtEnergy, fmtNumber, fmtPercent, fmtPower, timeAgo } from '../lib/format';
import { useSettings } from '../lib/hooks';
import { type Tokens, useTokens } from '../lib/theme';
import { useEnergy } from './Energy';
import { usePower } from './Solar';

export function OverviewPage() {
  const t = useTokens();
  const { data: settings } = useSettings();
  const today = { kind: 'day' as const, anchor: Date.now() };
  const live = useQuery({ queryKey: ['live'], queryFn: api.live, refetchInterval: 15_000 });
  const energy = useEnergy(today);
  const power = usePower(today, '5m');
  const climate = useQuery({ queryKey: ['climate'], queryFn: api.climate, refetchInterval: 60_000 });

  const s = settings?.energy;
  const energyConfigured = s && (s.solar.length || s.gridImport.length || s.consumption.length || s.solarPower.length || s.gridPower.length);
  const tot = useMemo(() => (energy.data ? totals(energy.data) : null), [energy.data]);
  const l = live.data;
  const p = (w: number | null | undefined) => fmtPower(w);

  return (
    <div className="space-y-4">
      <PageHeader title="Overview">
        {l?.updated && <span className="text-xs text-muted">Live data · updated {timeAgo(l.updated)}</span>}
      </PageHeader>

      {!energyConfigured && settings ? (
        <Card>
          <Empty height={80}>
            Welcome! <SettingsLink>Open settings</SettingsLink> to choose your energy and solar entities.
          </Empty>
        </Card>
      ) : (
        <>
          {live.error && <ErrorBox error={live.error} />}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {s?.solarPower.length ? (
              <StatTile label="Solar now" {...p(l?.solar)} swatch={t.role.solar} hero />
            ) : null}
            {l?.consumption !== null && l?.consumption !== undefined && (
              <StatTile label="Home now" {...p(l.consumption)} swatch={t.role.home} hero={!s?.solarPower.length} />
            )}
            {s && (s.gridPower.length > 0 || s.gridExportPower.length > 0) && (
              <StatTile
                label={l?.grid !== null && l?.grid !== undefined && l.grid < 0 ? 'Exporting to grid' : 'Importing from grid'}
                {...p(l?.grid !== null && l?.grid !== undefined ? Math.abs(l.grid) : null)}
                swatch={l?.grid !== null && l?.grid !== undefined && l.grid < 0 ? t.role.gridExport : t.role.gridImport}
              />
            )}
            {s && (s.batterySoc.length > 0 || s.batteryPower.length > 0) && (
              <StatTile
                label="Battery"
                value={l?.soc !== null && l?.soc !== undefined ? fmtNumber(l.soc, 0) : '–'}
                unit="%"
                swatch={t.role.battery}
                sub={
                  l?.battery !== null && l?.battery !== undefined && Math.abs(l.battery) > 5
                    ? `${l.battery > 0 ? 'Discharging' : 'Charging'} ${p(Math.abs(l.battery)).value} ${p(Math.abs(l.battery)).unit}`
                    : 'Idle'
                }
              />
            )}
          </div>

          {tot && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              <StatTile label="Used today" {...fmtEnergy(tot.consumption)} swatch={t.role.home} />
              {energy.data?.configured.solar && <StatTile label="Solar today" {...fmtEnergy(tot.solar)} swatch={t.role.solar} />}
              {energy.data?.configured.gridImport && (
                <StatTile label="Imported today" {...fmtEnergy(tot.gridImport)} swatch={t.role.gridImport} />
              )}
              {energy.data?.configured.gridExport && (
                <StatTile label="Exported today" {...fmtEnergy(tot.gridExport)} swatch={t.role.gridExport} />
              )}
              <StatTile label="Self-sufficiency" value={fmtPercent(tot.selfSufficiency)} sub="today" />
            </div>
          )}

          {power.data && (power.data.solar || power.data.consumption || power.data.grid) && (
            <TodayPower power={power.data} t={t} />
          )}
        </>
      )}

      <ClimateSnapshot data={climate.data} loading={climate.isLoading} error={climate.error} />
    </div>
  );
}

function TodayPower({ power, t }: { power: PowerResult; t: Tokens }) {
  const option = useMemo<EOption>(() => {
    const pts = (arr: (number | null)[] | null) => power.times.map((x, i) => [x, arr?.[i] ?? null]);
    const base = baseOption(t);
    return {
      ...base,
      tooltip: { ...(base.tooltip as object), valueFormatter: (v: number) => (v === null ? '–' : `${fmtPower(v).value} ${fmtPower(v).unit}`) },
      xAxis: timeAxis(t, dayBounds(power.times)),
      yAxis: valueAxis(t, 'W'),
      series: [
        power.solar && lineSeries('Solar', t.role.solar, pts(power.solar), { areaStyle: areaStyle(t.role.solar) }),
        power.consumption && lineSeries('Home', t.role.home, pts(power.consumption)),
        power.grid && lineSeries('Grid (+import / −export)', t.role.gridImport, pts(power.grid)),
      ].filter(Boolean),
    };
  }, [power, t]);
  return (
    <ChartCard title="Power today" subtitle="5-minute average">
      <EChart option={option} height={280} />
    </ChartCard>
  );
}

function ClimateSnapshot({
  data,
  loading,
  error,
}: {
  data?: Awaited<ReturnType<typeof api.climate>>;
  loading: boolean;
  error: unknown;
}) {
  if (error) return <ErrorBox error={error} />;
  if (loading) return <Loading height={80} />;
  if (!data?.length) return null;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-medium">Climate</h2>
        <a href="#/climate" className="text-sm text-accent hover:underline">
          Details
        </a>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {data.map((a) => {
          // Show up to two headline metrics per area.
          const sensors = METRIC_ORDER.flatMap((m) => a.sensors.filter((s) => s.metric === m && s.value !== null)).slice(0, 2);
          const status = sensors
            .map((s) => climateStatus(s.metric, s.value, s.unit))
            .find((x) => x && x.status !== 'good');
          return (
            <a key={a.id} href={`#/climate?area=${encodeURIComponent(a.id)}`} className="block">
              <Card className="h-full hover:bg-surface-2">
                <div className="truncate text-sm text-ink-2">{a.name}</div>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
                  {sensors.map((s) => (
                    <span key={s.entity} className="text-xl font-semibold" title={CLIMATE_METRICS.find((m) => m.key === s.metric)?.label}>
                      {fmtNumber(s.value, 1)}
                      <span className="ml-0.5 text-sm font-normal text-ink-2">{s.unit}</span>
                    </span>
                  ))}
                </div>
                <div className="mt-1">{status ? <StatusChip {...status} /> : <StatusChip status="good" label="OK" />}</div>
              </Card>
            </a>
          );
        })}
      </div>
    </div>
  );
}
