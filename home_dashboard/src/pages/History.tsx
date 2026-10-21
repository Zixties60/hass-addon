import { useQuery } from '@tanstack/react-query';
import { Download, RefreshCw } from 'lucide-react';
import { useMemo } from 'react';
import type { Series } from '../../shared/types';
import { baseOption, categoryAxis, EChart, echarts, type EOption, lineSeries, timeAxis, valueAxis } from '../components/Chart';
import { EntityPicker } from '../components/EntityPicker';
import { TimeRangePicker } from '../components/TimeRangePicker';
import { Card, ChartCard, Empty, ErrorBox, Loading, PageHeader } from '../components/ui';
import { api } from '../lib/api';
import { fmtNumber } from '../lib/format';
import { useHashParams, useStoredState } from '../lib/hooks';
import { useSlots } from '../lib/slots';
import { type Tokens, useTokens } from '../lib/theme';
import { decodeRange, encodeRange, resolveRange } from '../lib/time';

const MAX = 8;

export function HistoryPage() {
  const t = useTokens();
  const [params, setParams] = useHashParams();
  const [lastSelection, setLastSelection] = useStoredState<string[]>('history-entities', []);
  const entities = useMemo(() => {
    const e = params.get('e');
    return (e !== null ? e.split(',').filter(Boolean) : lastSelection).slice(0, MAX);
  }, [params, lastSelection]);
  const range = decodeRange(params.get('r'));
  const setEntities = (ids: string[]) => {
    setLastSelection(ids);
    setParams({ e: ids.join(',') || null });
  };

  const slots = useSlots(entities, MAX);
  const colorOf = (id: string) => t.series[slots.get(id) ?? 0];
  const q = resolveRange(range);

  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ['history', entities.join(','), encodeRange(range)],
    queryFn: () => api.series(entities, q),
    enabled: entities.length > 0,
    staleTime: 30_000,
  });

  return (
    <div className="space-y-4">
      <PageHeader title="History">
        <TimeRangePicker value={range} onChange={(r) => setParams({ r: encodeRange(r) })} />
        <button className="btn px-2" title="Refresh" onClick={() => refetch()} disabled={!entities.length}>
          <RefreshCw size={16} className={isFetching ? 'animate-spin' : ''} />
        </button>
        <button className="btn px-2" title="Download CSV" disabled={!data?.length} onClick={() => data && downloadCsv(data)}>
          <Download size={16} />
        </button>
      </PageHeader>

      <Card>
        <EntityPicker value={entities} onChange={setEntities} max={MAX} colors={(id) => colorOf(id)} placeholder="Add entities to compare…" />
        <p className="mt-2 text-xs text-muted">
          Up to {MAX} entities. Numeric sensors are grouped into one chart per unit; on/off and text states are shown
          as a timeline. Averaged into {q.every} windows.
        </p>
      </Card>

      {!entities.length ? (
        <Empty>Pick one or more entities to see their history.</Empty>
      ) : error ? (
        <ErrorBox error={error} />
      ) : !data ? (
        <Loading />
      ) : (
        <HistoryCharts series={data} colorOf={colorOf} t={t} start={q.start.getTime()} stop={q.stop.getTime()} />
      )}
    </div>
  );
}

function HistoryCharts({
  series,
  colorOf,
  t,
  start,
  stop,
}: {
  series: Series[];
  colorOf: (id: string) => string;
  t: Tokens;
  start: number;
  stop: number;
}) {
  const numeric = series.filter((s) => s.kind === 'numeric');
  const states = series.filter((s) => s.kind !== 'numeric');
  const byUnit = useMemo(() => {
    const m = new Map<string, Series[]>();
    for (const s of numeric) {
      const k = s.unit ?? '';
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return [...m.entries()];
  }, [numeric]);

  const empty = series.every((s) => s.points.length === 0);
  if (empty) return <Empty>No data recorded for these entities in the selected period.</Empty>;

  return (
    <div className="space-y-4">
      {byUnit.map(([unit, list]) => (
        <UnitChart key={unit} unit={unit} list={list} colorOf={colorOf} t={t} start={start} stop={stop} />
      ))}
      {states.length > 0 && <Timeline list={states} colorOf={colorOf} t={t} start={start} stop={stop} />}
    </div>
  );
}

function UnitChart({
  unit,
  list,
  colorOf,
  t,
  start,
  stop,
}: {
  unit: string;
  list: Series[];
  colorOf: (id: string) => string;
  t: Tokens;
  start: number;
  stop: number;
}) {
  const option = useMemo<EOption>(() => {
    const base = baseOption(t);
    return {
      ...base,
      legend: { ...(base.legend as object), show: list.length > 1 },
      tooltip: { ...(base.tooltip as object), valueFormatter: (v: number) => `${fmtNumber(v, 2)}${unit ? ` ${unit}` : ''}` },
      xAxis: timeAxis(t, { min: start, max: stop }),
      yAxis: valueAxis(t, unit, { scale: true }),
      dataZoom: [{ type: 'inside', filterMode: 'none' }],
      series: list.map((s) => lineSeries(s.name, colorOf(s.entity), s.points)),
    };
  }, [list, unit, colorOf, t, start, stop]);
  const title = list.length === 1 ? list[0].name : unit ? `Sensors in ${unit}` : 'Unitless sensors';
  const stats = list.map((s) => {
    const vals = s.points.map((p) => p[1]).filter((v): v is number => typeof v === 'number');
    return {
      s,
      min: vals.length ? Math.min(...vals) : null,
      max: vals.length ? Math.max(...vals) : null,
      avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
    };
  });
  return (
    <ChartCard
      title={title}
      subtitle={list.length === 1 ? list[0].entity : undefined}
      table={{
        columns: ['Entity', 'Min', 'Average', 'Max'],
        rows: stats.map((x) => [x.s.name, fmtNumber(x.min, 2), fmtNumber(x.avg, 2), fmtNumber(x.max, 2)]),
      }}
    >
      <EChart option={option} height={300} group="history" />
    </ChartCard>
  );
}

interface Segment {
  row: number;
  from: number;
  to: number;
  label: string;
  color: string;
  opacity: number;
  text: boolean;
}

function Timeline({
  list,
  colorOf,
  t,
  start,
  stop,
}: {
  list: Series[];
  colorOf: (id: string) => string;
  t: Tokens;
  start: number;
  stop: number;
}) {
  const option = useMemo<EOption>(() => {
    const segs: Segment[] = [];
    list.forEach((s, row) => {
      // Rows keep their entity color; text states are told apart by shade and an inline label.
      const shades = [1, 0.55, 0.3, 0.8, 0.42];
      const stateShade = new Map<string, number>();
      const colorFor = (v: string | number | null): { label: string; color: string; opacity: number } => {
        if (s.kind === 'binary') {
          const on = typeof v === 'number' && v > 0;
          return { label: on ? 'On' : 'Off', color: on ? colorOf(s.entity) : t.surface2, opacity: 1 };
        }
        const label = String(v ?? 'unknown');
        if (!stateShade.has(label)) stateShade.set(label, shades[stateShade.size % shades.length]);
        return { label, color: colorOf(s.entity), opacity: stateShade.get(label)! };
      };
      const pts = s.points.filter((p) => p[1] !== null);
      for (let i = 0; i < pts.length; i++) {
        const { label, color, opacity } = colorFor(pts[i][1]);
        let j = i;
        while (j + 1 < pts.length && colorFor(pts[j + 1][1]).label === label) j++;
        const to = j + 1 < pts.length ? pts[j + 1][0] : Math.min(stop, Date.now());
        segs.push({ row, from: pts[i][0], to, label, color, opacity, text: s.kind === 'text' });
        i = j;
      }
    });

    const base = baseOption(t);
    return {
      ...base,
      legend: { show: false },
      grid: { ...(base.grid as object), top: 8 },
      tooltip: {
        ...(base.tooltip as object),
        trigger: 'item',
        formatter: (p: any) => {
          const sg = segs[p.dataIndex];
          const fmt = (x: number) => new Date(x).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
          return `<b>${list[sg.row].name}</b><br/>${sg.label}<br/><span style="color:${t.muted}">${fmt(sg.from)} → ${fmt(sg.to)}</span>`;
        },
      },
      xAxis: timeAxis(t, { min: start, max: stop }),
      yAxis: categoryAxis(t, list.map((s) => s.name), {
        inverse: true,
        axisLine: { show: false },
        axisLabel: { color: t.ink2, fontSize: 12, width: 160, overflow: 'truncate' },
      }),
      dataZoom: [{ type: 'inside', filterMode: 'weakFilter' }],
      series: [
        {
          type: 'custom',
          encode: { x: [1, 2], y: 0 },
          data: segs.map((s) => ({ value: [s.row, s.from, s.to], itemStyle: { color: s.color, opacity: s.opacity } })),
          renderItem: (params: any, api: any) => {
            const seg = segs[params.dataIndex];
            const row = api.value(0);
            const a = api.coord([api.value(1), row]);
            const b = api.coord([api.value(2), row]);
            const h = Math.min(22, api.size([0, 1])[1] * 0.6);
            const rect = echarts.graphic.clipRectByRect(
              { x: a[0], y: a[1] - h / 2, width: Math.max(1, b[0] - a[0] - 1), height: h },
              { x: params.coordSys.x, y: params.coordSys.y, width: params.coordSys.width, height: params.coordSys.height },
            );
            if (!rect) return null;
            const children: any[] = [{ type: 'rect', shape: { ...rect, r: 3 }, style: api.style() }];
            // Inline state name only when it fits; otherwise the tooltip carries it.
            if (seg.text && rect.width > seg.label.length * 7 + 12) {
              children.push({
                type: 'text',
                style: {
                  x: rect.x + 6,
                  y: rect.y + rect.height / 2,
                  text: seg.label,
                  fill: seg.opacity >= 0.55 ? '#fff' : t.ink,
                  fontSize: 11,
                  verticalAlign: 'middle',
                },
              });
            }
            return { type: 'group', children };
          },
        },
      ],
    };
  }, [list, colorOf, t, start, stop]);

  return (
    <ChartCard title="States" subtitle="On/off and text states over time">
      <EChart option={option} height={list.length * 40 + 50} group="history" />
    </ChartCard>
  );
}

function downloadCsv(series: Series[]) {
  const lines = ['time,entity,name,value,unit'];
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  for (const s of series) {
    for (const [time, v] of s.points) {
      lines.push([new Date(time).toISOString(), s.entity, esc(s.name), esc(v), esc(s.unit)].join(','));
    }
  }
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `history-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
