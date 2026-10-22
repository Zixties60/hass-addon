import { useQuery } from '@tanstack/react-query';
import { addDays, format } from 'date-fns';
import { useMemo } from 'react';
import type { EnergyResult, EnergySettings } from '../../shared/types';
import { baseOption, barSeries, categoryAxis, EChart, type EOption, fs, isNarrow, valueAxis } from '../components/Chart';
import { ChartCard, Empty, ErrorBox, Loading, PageHeader, PeriodNav, SettingsLink, StatTile } from '../components/ui';
import { api } from '../lib/api';
import { type CostResult, useCost } from '../lib/cost';
import { bucketFlows, nz, round, totals } from '../lib/energy';
import { fmtEnergy, fmtMoney, fmtNumber, fmtPercent } from '../lib/format';
import { useHashParams, useSettings } from '../lib/hooks';
import { type Tokens, useTokens } from '../lib/theme';
import { bucketLabel, isCurrentPeriod, type Period, type PeriodKind, periodQuery } from '../lib/time';

const PERIOD_KINDS: PeriodKind[] = ['day', 'week', 'month', 'cycle', 'year'];

export function usePeriod(): [Period, (p: Period) => void] {
  const [params, setParams] = useHashParams();
  const { data: settings } = useSettings();
  const kind = (PERIOD_KINDS.includes(params.get('p') as PeriodKind) ? params.get('p') : 'day') as PeriodKind;
  const anchor = Number(params.get('a')) || Date.now();
  return [
    { kind, anchor, billingDay: settings?.energy.tariff.billingDay ?? 1 },
    (p) => setParams({ p: p.kind, a: isCurrentPeriod(p) ? null : String(p.anchor) }),
  ];
}

export function useEnergy(period: Period) {
  const q = periodQuery(period);
  return useQuery({
    queryKey: ['energy', period.kind, q.start.getTime()],
    queryFn: () => api.energy(q),
    refetchInterval: isCurrentPeriod(period) ? 60_000 : false,
  });
}

export function EnergyPage() {
  const [period, setPeriod] = usePeriod();
  const { data, error, isLoading } = useEnergy(period);
  const { data: settings } = useSettings();
  const t = useTokens();
  const s = settings?.energy;
  const nothingConfigured = s && !s.solar.length && !s.gridImport.length && !s.consumption.length;

  return (
    <div>
      <PageHeader title="Energy">
        <PeriodNav period={period} onChange={setPeriod} />
      </PageHeader>
      {nothingConfigured ? (
        <Empty>
          No energy entities configured yet. <SettingsLink>Choose entities in settings</SettingsLink> or import them from
          Home Assistant's Energy dashboard.
        </Empty>
      ) : error ? (
        <ErrorBox error={error} />
      ) : isLoading || !data ? (
        <Loading />
      ) : (
        <EnergyBody data={data} period={period} t={t} settings={s} />
      )}
    </div>
  );
}

function EnergyBody({
  data,
  period,
  t,
  settings,
}: {
  data: EnergyResult;
  period: Period;
  t: Tokens;
  settings?: EnergySettings;
}) {
  const kind = period.kind;
  const tot = useMemo(() => totals(data), [data]);
  const cfg = data.configured;
  const hasBattery = cfg.batteryCharge || cfg.batteryDischarge;
  const cost = useCost(period, settings, kind === 'day' ? undefined : data.times);
  const currency = settings?.currency ?? '';
  const progressive = !!settings?.tariff.progressive && settings.tariff.tiers.length > 0;
  const e = (v: number) => fmtEnergy(v);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="Consumption"
          {...e(tot.consumption)}
          swatch={t.role.home}
          sub={data.consumptionDerived ? 'derived from flows' : undefined}
        />
        {cfg.solar && <StatTile label="Solar production" {...e(tot.solar)} swatch={t.role.solar} />}
        {cfg.gridImport && <StatTile label="Grid import" {...e(tot.gridImport)} swatch={t.role.gridImport} />}
        {cfg.gridExport && <StatTile label="Grid export" {...e(tot.gridExport)} swatch={t.role.gridExport} />}
        {hasBattery && (
          <StatTile
            label="Battery in / out"
            value={`${fmtNumber(tot.batteryCharge, 1)} / ${fmtNumber(tot.batteryDischarge, 1)}`}
            unit="kWh"
            swatch={t.role.battery}
          />
        )}
        <StatTile label="Self-sufficiency" value={fmtPercent(tot.selfSufficiency)} sub="consumption not from grid" />
        {cost && (
          <StatTile
            label={cost.net >= 0 ? 'Net cost' : 'Net earnings'}
            value={fmtMoney(Math.abs(cost.net), currency)}
            sub={
              cost.exportCredit > 0
                ? `${fmtMoney(cost.importCost, currency)} import − ${fmtMoney(cost.exportCredit, currency)} export`
                : 'grid import incl. charges'
            }
          />
        )}
        {cost && progressive && (
          <StatTile
            label="Billing cycle"
            value={fmtNumber(cost.cycle.kwh, 0)}
            unit="kWh"
            sub={
              <>
                Tier {cost.cycle.tierIndex + 1} · {fmtMoney(cost.cycle.rate, currency)}/kWh
                {cost.cycle.nextAt !== null && ` until ${fmtNumber(cost.cycle.nextAt, 0)} kWh`}
                <br />
                {format(cost.cycle.start, 'd MMM')} – {format(addDays(cost.cycle.end, -1), 'd MMM')}
              </>
            }
          />
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <UsageChart data={data} kind={kind} t={t} className="xl:col-span-2" />
        <FlowChart tot={tot} t={t} hasBattery={hasBattery} hasSolar={cfg.solar} />
      </div>

      {cost && (cfg.solar || kind !== 'day') && <CostCard data={data} cost={cost} kind={kind} t={t} currency={currency} hasSolar={cfg.solar} />}

      <DevicesChart data={data} t={t} consumption={tot.consumption} />
    </div>
  );
}

function CostFigure({ label, value, sub, swatch }: { label: string; value: string; sub?: string; swatch?: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 text-sm text-ink-2">
        {swatch && <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: swatch }} />}
        {label}
      </div>
      <div className="mt-0.5 text-2xl font-semibold tnum">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

/** Bill with and without solar for the selected period, and per bucket for longer periods. */
function CostCard({
  data,
  cost,
  kind,
  t,
  currency,
  hasSolar,
}: {
  data: EnergyResult;
  cost: CostResult;
  kind: PeriodKind;
  t: Tokens;
  currency: string;
  hasSolar: boolean;
}) {
  const money = (v: number) => fmtMoney(v, currency);
  const labels = data.times.map((x) => bucketLabel(kind, x));
  const perBucket = kind !== 'day' && cost.buckets.length > 0;
  const colors = { without: t.muted, with: t.role.gridImport };

  const option = useMemo<EOption>(() => {
    const base = baseOption(t);
    const bars = (v: number[]) => v.map((x) => nz(round(x, 2)));
    return {
      ...base,
      legend: { ...(base.legend as object), show: hasSolar },
      tooltip: { ...(base.tooltip as object), valueFormatter: (v: number | null) => money(v ?? 0) },
      xAxis: categoryAxis(t, labels),
      yAxis: valueAxis(t, currency || null),
      series: [
        hasSolar && barSeries('Without solar', colors.without, bars(cost.bucketsWithoutSolar), { gap: t.surface, barGap: '10%' }),
        barSeries(hasSolar ? 'With solar' : 'Net cost', colors.with, bars(cost.buckets), { gap: t.surface }),
      ].filter(Boolean),
    };
  }, [cost, labels.join(), t, currency, hasSolar]);

  const table = hasSolar
    ? {
        columns: ['Time', 'Without solar', 'With solar', 'Saved'],
        rows: labels.map((l, i) => [
          l,
          money(cost.bucketsWithoutSolar[i]),
          money(cost.buckets[i]),
          money(cost.bucketsWithoutSolar[i] - cost.buckets[i]),
        ]),
      }
    : { columns: ['Time', 'Net cost'], rows: labels.map((l, i) => [l, money(cost.buckets[i])]) };

  return (
    <ChartCard
      title={hasSolar ? 'Cost comparison' : 'Cost'}
      subtitle={
        hasSolar
          ? 'Grid bill for this period with and without solar · charges and tax included'
          : 'Net grid cost · charges and tax included, export credit deducted'
      }
      table={perBucket ? table : undefined}
    >
      {hasSolar && (
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <CostFigure label="Without solar" value={money(cost.withoutSolar)} sub="all consumption from the grid" swatch={colors.without} />
          <CostFigure
            label="With solar"
            value={money(cost.net)}
            sub={cost.exportCredit > 0 ? `after ${money(cost.exportCredit)} export credit` : 'actual grid bill'}
            swatch={colors.with}
          />
          <CostFigure
            label="Saved"
            value={money(cost.saved)}
            sub={cost.withoutSolar > 0 ? `${fmtPercent(cost.saved / cost.withoutSolar)} of the bill` : undefined}
          />
        </div>
      )}
      {perBucket && <EChart option={option} height={260} />}
    </ChartCard>
  );
}

function UsageChart({ data, kind, t, className }: { data: EnergyResult; kind: PeriodKind; t: Tokens; className?: string }) {
  const { option, table } = useMemo(() => {
    const labels = data.times.map((x) => bucketLabel(kind, x));
    const flows = data.times.map((_, i) => bucketFlows(data, i));
    const cfg = data.configured;
    const battery = cfg.batteryCharge || cfg.batteryDischarge;
    // Positive stack: where the house got its energy; negative stack: where surplus went.
    const pos = [
      cfg.solar && { name: 'From solar', color: t.role.solar, v: flows.map((f) => f.solarToHome) },
      battery && { name: 'From battery', color: t.role.battery, v: flows.map((f) => f.batteryToHome) },
      { name: 'From grid', color: t.role.gridImport, v: flows.map((f) => f.gridToHome) },
    ].filter(Boolean) as { name: string; color: string; v: number[] }[];
    const neg = [
      cfg.gridExport && { name: 'To grid', color: t.role.gridExport, v: data.categories.gridExport.total },
      battery && { name: 'To battery', color: t.series[4], v: data.categories.batteryCharge.total },
    ].filter(Boolean) as { name: string; color: string; v: number[] }[];

    const series = [
      ...pos.map((s, i) =>
        barSeries(s.name, s.color, s.v.map((x) => nz(round(x))), { stack: 'flow', rounded: i === pos.length - 1, gap: t.surface }),
      ),
      ...neg.map((s, i) =>
        barSeries(
          s.name,
          s.color,
          s.v.map((x) => nz(round(-x))),
          { stack: 'flow', negative: true, rounded: i === neg.length - 1, gap: t.surface },
        ),
      ),
    ];
    const base = baseOption(t);
    const option: EOption = {
      ...base,
      tooltip: {
        ...(base.tooltip as object),
        valueFormatter: (v: number | null) => `${fmtNumber(v === null ? 0 : Math.abs(v), 2)} kWh`,
      },
      xAxis: categoryAxis(t, labels),
      yAxis: valueAxis(t, 'kWh'),
      series,
    };
    const table = {
      columns: ['Time', ...pos.map((s) => s.name), ...neg.map((s) => s.name), 'Consumption'],
      rows: labels.map((l, i) => [
        l,
        ...pos.map((s) => fmtNumber(s.v[i], 2)),
        ...neg.map((s) => fmtNumber(s.v[i], 2)),
        fmtNumber(data.categories.consumption.total[i], 2),
      ]),
    };
    return { option, table };
  }, [data, kind, t]);

  return (
    <ChartCard title="Energy usage" subtitle="kWh per period · above the line: sources, below: surplus" table={table} className={className}>
      <EChart option={option} height={320} />
    </ChartCard>
  );
}

function FlowChart({
  tot,
  t,
  hasBattery,
  hasSolar,
}: {
  tot: ReturnType<typeof totals>;
  t: Tokens;
  hasBattery: boolean;
  hasSolar: boolean;
}) {
  const f = tot.flows;
  const links = [
    { source: 'Solar', target: 'Home', value: f.solarToHome },
    { source: 'Solar', target: 'Grid export', value: f.solarToGrid },
    { source: 'Solar', target: 'Battery charge', value: f.solarToBattery },
    { source: 'Grid import', target: 'Home', value: f.gridToHome },
    { source: 'Grid import', target: 'Battery charge', value: f.gridToBattery },
    { source: 'Battery', target: 'Home', value: f.batteryToHome },
  ].filter((l) => l.value > 0.001);
  const colors: Record<string, string> = {
    Solar: t.role.solar,
    'Grid import': t.role.gridImport,
    'Grid export': t.role.gridExport,
    Battery: t.role.battery,
    'Battery charge': t.series[4],
    Home: t.role.home,
  };
  const nodes = [...new Set(links.flatMap((l) => [l.source, l.target]))].map((name) => ({
    name,
    itemStyle: { color: colors[name], borderWidth: 0 },
  }));
  const option: EOption = {
    tooltip: {
      confine: true,
      backgroundColor: t.surface,
      borderColor: t.border,
      textStyle: { color: t.ink, fontSize: fs(12) },
      valueFormatter: (v: number) => `${fmtNumber(v, 2)} kWh`,
    },
    series: [
      {
        type: 'sankey',
        data: nodes,
        links: links.map((l) => ({ ...l, value: round(l.value) })),
        left: 8,
        right: 90,
        top: 8,
        bottom: 8,
        nodeWidth: 10,
        nodeGap: 14,
        draggable: false,
        label: { color: t.ink2, fontSize: fs(12), formatter: (p: any) => `${p.name}\n${fmtNumber(p.value, 1)} kWh` },
        lineStyle: { color: 'gradient', opacity: 0.25, curveness: 0.5 },
        emphasis: { focus: 'adjacency' },
      },
    ],
  };
  return (
    <ChartCard
      title="Energy flow"
      subtitle={hasSolar || hasBattery ? 'Estimated from meter totals' : 'Configure solar or battery to see flows'}
      table={{ columns: ['From', 'To', 'kWh'], rows: links.map((l) => [l.source, l.target, fmtNumber(l.value, 2)]) }}
    >
      {links.length ? <EChart option={option} height={320} /> : <Empty height={320}>No energy recorded in this period</Empty>}
    </ChartCard>
  );
}

function DevicesChart({ data, t, consumption }: { data: EnergyResult; t: Tokens; consumption: number }) {
  const rows = useMemo(() => {
    const list = data.devices.map((d) => ({ name: d.name, total: d.total })).sort((a, b) => b.total - a.total);
    const tracked = list.reduce((a, d) => a + d.total, 0);
    if (list.length && consumption - tracked > 0.01) list.push({ name: 'Untracked', total: consumption - tracked });
    return list;
  }, [data, consumption]);

  if (!data.devices.length) {
    return (
      <ChartCard title="Usage by device">
        <Empty height={100}>
          Add individual device energy sensors in <SettingsLink>settings</SettingsLink> to see a breakdown.
        </Empty>
      </ChartCard>
    );
  }

  const base = baseOption(t);
  const option: EOption = {
    ...base,
    legend: { show: false },
    grid: { ...(base.grid as object), top: 8, right: 64 },
    tooltip: { ...(base.tooltip as object), trigger: 'item', valueFormatter: (v: number) => `${fmtNumber(v, 2)} kWh` },
    xAxis: valueAxis(t, null),
    yAxis: categoryAxis(t, rows.map((r) => r.name), { inverse: true, axisLabel: { color: t.ink2, fontSize: fs(12), width: isNarrow() ? 96 : 140, overflow: 'truncate' } }),
    series: [
      {
        type: 'bar',
        name: 'Energy',
        data: rows.map((r) => ({
          value: round(r.total),
          itemStyle: { color: r.name === 'Untracked' ? t.axis : t.role.home, borderRadius: [0, 4, 4, 0] },
        })),
        barMaxWidth: 20,
        label: { show: true, position: 'right', color: t.ink2, fontSize: fs(11), formatter: (p: any) => `${fmtNumber(p.value, 1)} kWh` },
      },
    ],
  };
  return (
    <ChartCard
      title="Usage by device"
      subtitle="kWh in this period"
      table={{
        columns: ['Device', 'kWh', 'Share'],
        rows: rows.map((r) => [r.name, fmtNumber(r.total, 2), consumption > 0 ? fmtPercent(r.total / consumption) : '–']),
      }}
    >
      <EChart option={option} height={Math.max(160, rows.length * 34 + 30)} />
    </ChartCard>
  );
}
