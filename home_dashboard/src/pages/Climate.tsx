import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { CLIMATE_METRICS, type ClimateMetric, type ResolvedClimateArea, type Series } from '../../shared/types';
import { baseOption, EChart, type EOption, lineSeries, timeAxis, valueAxis } from '../components/Chart';
import { ChartCard, Empty, ErrorBox, Loading, PageHeader, Segmented, SettingsLink } from '../components/ui';
import { TimeRangePicker } from '../components/TimeRangePicker';
import { api } from '../lib/api';
import { climateStatus, METRIC_ORDER, StatusChip } from '../lib/climate';
import { fmtNumber, timeAgo } from '../lib/format';
import { useHashParams } from '../lib/hooks';
import { useSlots } from '../lib/slots';
import { type Tokens, useTokens } from '../lib/theme';
import { decodeRange, encodeRange, resolveRange } from '../lib/time';

const metricLabel = (m: ClimateMetric) => CLIMATE_METRICS.find((x) => x.key === m)?.label ?? m;

export function ClimatePage() {
  const t = useTokens();
  const [params, setParams] = useHashParams();
  const { data: areas, error, isLoading } = useQuery({ queryKey: ['climate'], queryFn: api.climate, refetchInterval: 60_000 });

  const allIds = useMemo(() => (areas ?? []).map((a) => a.id), [areas]);
  const selected = useMemo(() => {
    const p = params.get('area');
    if (p) return p.split(',').filter((id) => allIds.includes(id)).slice(0, 8);
    return allIds.slice(0, 8);
  }, [params, allIds]);
  const slots = useSlots(selected);
  const colorOf = (id: string) => {
    const s = slots.get(id);
    return s === undefined ? undefined : t.series[s];
  };
  const toggleArea = (id: string) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id].slice(0, 8);
    setParams({ area: next.join(',') || null });
  };

  if (error) return <ErrorBox error={error} />;
  if (isLoading || !areas) return <Loading />;
  if (!areas.length) {
    return (
      <div>
        <PageHeader title="Climate" />
        <Empty>
          No climate sensors found. Assign temperature / humidity / air-quality sensors to areas in Home Assistant, or add
          areas manually in <SettingsLink>settings</SettingsLink>.
        </Empty>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Climate">
        <span className="text-xs text-muted">Tap an area to include it in the comparison (max 8)</span>
      </PageHeader>
      <AreaCards areas={areas} selected={selected} colorOf={colorOf} onToggle={toggleArea} t={t} />
      <CompareChart areas={areas.filter((a) => selected.includes(a.id))} colorOf={colorOf} t={t} />
    </div>
  );
}

function AreaCards({
  areas,
  selected,
  colorOf,
  onToggle,
  t,
}: {
  areas: ResolvedClimateArea[];
  selected: string[];
  colorOf: (id: string) => string | undefined;
  onToggle: (id: string) => void;
  t: Tokens;
}) {
  // 24h sparkline per area: temperature if present, otherwise the first sensor.
  const sparkEntities = useMemo(
    () =>
      areas
        .map((a) => (a.sensors.find((s) => s.metric === 'temperature') ?? a.sensors[0])?.entity)
        .filter((x): x is string => !!x)
        .slice(0, 40),
    [areas],
  );
  const range = useMemo(() => resolveRange({ preset: '24h' }, 48), []);
  const { data: spark } = useQuery({
    queryKey: ['climate-spark', sparkEntities.join(',')],
    queryFn: () => api.series(sparkEntities, range),
    staleTime: 300_000,
  });
  const sparkBy = useMemo(() => new Map((spark ?? []).map((s) => [s.entity, s])), [spark]);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {areas.map((a) => {
        const isSel = selected.includes(a.id);
        const color = colorOf(a.id);
        const sorted = METRIC_ORDER.flatMap((m) => a.sensors.filter((s) => s.metric === m));
        const sparkSensor = a.sensors.find((s) => s.metric === 'temperature') ?? a.sensors[0];
        const sp = sparkSensor ? sparkBy.get(sparkSensor.entity) : undefined;
        const latest = a.sensors.reduce<string | null>((m, s) => (s.time && (!m || s.time > m) ? s.time : m), null);
        return (
          <button
            key={a.id}
            onClick={() => onToggle(a.id)}
            aria-pressed={isSel}
            className={`rounded-xl border bg-surface p-4 text-left transition-colors hover:bg-surface-2 ${
              isSel ? 'border-accent' : 'border-line'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                {isSel && color && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />}
                <span className="truncate font-medium">{a.name}</span>
              </div>
              <span className="shrink-0 text-xs text-muted">{timeAgo(latest)}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
              {sorted.map((s) => {
                const st = climateStatus(s.metric, s.value, s.unit);
                return (
                  <div key={s.entity} className="min-w-0" title={`${s.name} (${s.entity})`}>
                    <div className="truncate text-xs text-muted">{metricLabel(s.metric)}</div>
                    <div className="text-lg font-semibold leading-tight">
                      {fmtNumber(s.value, 1)}
                      <span className="ml-0.5 text-xs font-normal text-ink-2">{s.unit}</span>
                    </div>
                    {st && <StatusChip {...st} />}
                  </div>
                );
              })}
            </div>
            {sp && sp.points.length > 1 && (
              <div className="mt-3">
                <Sparkline series={sp} t={t} />
                <div className="text-[11px] text-muted">{metricLabel(sparkSensor!.metric)} · last 24 h</div>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

function Sparkline({ series, t }: { series: Series; t: Tokens }) {
  const option = useMemo<EOption>(
    () => ({
      animation: false,
      grid: { left: 0, right: 0, top: 4, bottom: 4 },
      xAxis: { type: 'time', show: false },
      yAxis: { type: 'value', show: false, scale: true },
      series: [lineSeries(series.name, t.muted, series.points, { silent: true, lineStyle: { width: 1.5, color: t.muted } })],
    }),
    [series, t],
  );
  return <EChart option={option} height={44} />;
}

function CompareChart({
  areas,
  colorOf,
  t,
}: {
  areas: ResolvedClimateArea[];
  colorOf: (id: string) => string | undefined;
  t: Tokens;
}) {
  const [params, setParams] = useHashParams();
  const range = decodeRange(params.get('r'));
  const available = METRIC_ORDER.filter((m) => areas.some((a) => a.sensors.some((s) => s.metric === m)));
  const metric = (available.includes(params.get('m') as ClimateMetric) ? params.get('m') : available[0]) as ClimateMetric | undefined;

  const sensors = useMemo(
    () => areas.flatMap((a) => a.sensors.filter((s) => s.metric === metric).map((s) => ({ area: a, sensor: s }))),
    [areas, metric],
  );
  const q = resolveRange(range);
  const { data, error, isFetching } = useQuery({
    queryKey: ['climate-compare', sensors.map((s) => s.sensor.entity).join(','), encodeRange(range), q.every],
    queryFn: () => api.series(sensors.map((s) => s.sensor.entity), q),
    enabled: sensors.length > 0,
    staleTime: 60_000,
  });

  const { option, table } = useMemo(() => {
    // Average multiple sensors of the same metric within an area into one line.
    const byArea = new Map<string, Map<number, number[]>>();
    for (const s of data ?? []) {
      const area = sensors.find((x) => x.sensor.entity === s.entity)?.area;
      if (!area) continue;
      let m = byArea.get(area.id);
      if (!m) byArea.set(area.id, (m = new Map()));
      for (const [time, v] of s.points) {
        if (typeof v !== 'number') continue;
        const arr = m.get(time) ?? [];
        arr.push(v);
        m.set(time, arr);
      }
    }
    const unit = sensors[0]?.sensor.unit ?? '';
    const lines = areas
      .filter((a) => byArea.has(a.id))
      .map((a) => ({
        area: a,
        pts: [...byArea.get(a.id)!.entries()]
          .sort((x, y) => x[0] - y[0])
          .map(([time, vs]) => [time, Math.round((vs.reduce((p, c) => p + c, 0) / vs.length) * 100) / 100] as [number, number]),
      }));
    const base = baseOption(t);
    const option: EOption = {
      ...base,
      legend: { ...(base.legend as object), show: lines.length > 1 },
      tooltip: { ...(base.tooltip as object), valueFormatter: (v: number) => `${fmtNumber(v, 1)} ${unit}` },
      xAxis: timeAxis(t),
      yAxis: valueAxis(t, unit, { scale: true }),
      dataZoom: [{ type: 'inside', filterMode: 'none' }],
      series: lines.map((l) => lineSeries(l.area.name, colorOf(l.area.id) ?? t.muted, l.pts)),
    };
    const times = [...new Set(lines.flatMap((l) => l.pts.map((p) => p[0])))].sort((a, b) => a - b);
    const maps = lines.map((l) => new Map(l.pts));
    const table = {
      columns: ['Time', ...lines.map((l) => `${l.area.name} (${unit})`)],
      rows: times.map((tm) => [new Date(tm).toLocaleString(), ...maps.map((m) => fmtNumber(m.get(tm), 1))]),
    };
    return { option, table };
  }, [data, sensors, areas, colorOf, t]);

  if (!metric) return null;
  return (
    <ChartCard
      title={`${metricLabel(metric)} by area`}
      subtitle={isFetching ? 'Loading…' : 'Average of the area’s sensors · scroll or pinch to zoom'}
      table={table}
      actions={<TimeRangePicker value={range} onChange={(r) => setParams({ r: encodeRange(r) })} />}
    >
      <div className="mb-2">
        <Segmented<ClimateMetric>
          label="Metric"
          value={metric}
          onChange={(m) => setParams({ m })}
          options={available.map((m) => ({ value: m, label: metricLabel(m) }))}
        />
      </div>
      {error ? (
        <ErrorBox error={error} />
      ) : !areas.length ? (
        <Empty height={300}>Select one or more areas above</Empty>
      ) : !data ? (
        <Loading height={300} />
      ) : (
        <EChart option={option} height={320} />
      )}
    </ChartCard>
  );
}
