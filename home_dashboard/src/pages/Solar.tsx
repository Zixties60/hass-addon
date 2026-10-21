import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { dayBounds } from '../lib/time';
import type { EnergyResult, PowerResult } from '../../shared/types';
import {
  areaStyle,
  baseOption,
  barSeries,
  categoryAxis,
  EChart,
  type EOption,
  lineSeries,
  timeAxis,
  valueAxis,
} from '../components/Chart';
import { ChartCard, Empty, ErrorBox, Loading, PageHeader, PeriodNav, SettingsLink, StatTile } from '../components/ui';
import { api } from '../lib/api';
import { nz, round, totals } from '../lib/energy';
import { fmtEnergy, fmtMoney, fmtNumber, fmtPercent, fmtPower } from '../lib/format';
import { useEntityMap, useSettings } from '../lib/hooks';
import { type Tokens, useTokens } from '../lib/theme';
import { bucketLabel, isCurrentPeriod, type Period, type PeriodKind, periodQuery } from '../lib/time';
import { useEnergy, usePeriod } from './Energy';

export function usePower(period: Period, every = '5m') {
  const q = { ...periodQuery(period), every };
  return useQuery({
    queryKey: ['power', period.kind, q.start.getTime(), every],
    queryFn: () => api.power(q),
    refetchInterval: isCurrentPeriod(period) ? 60_000 : false,
  });
}

export function SolarPage() {
  const [period, setPeriod] = usePeriod();
  const { data: settings } = useSettings();
  const energy = useEnergy(period);
  // Power curves only make sense at day resolution; longer periods use 1h means for the peak.
  const power = usePower(period, period.kind === 'day' ? '5m' : period.kind === 'week' ? '30m' : '1h');
  const t = useTokens();
  const s = settings?.energy;

  if (s && !s.solar.length && !s.solarPower.length) {
    return (
      <div>
        <PageHeader title="Solar" />
        <Empty>
          No solar entities configured. <SettingsLink>Choose solar production sensors in settings</SettingsLink>.
        </Empty>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Solar">
        <PeriodNav period={period} onChange={setPeriod} />
      </PageHeader>
      {energy.error ? (
        <ErrorBox error={energy.error} />
      ) : !energy.data ? (
        <Loading />
      ) : (
        <SolarBody energy={energy.data} power={power.data} kind={period.kind} t={t} prices={s} />
      )}
    </div>
  );
}

function SolarBody({
  energy,
  power,
  kind,
  t,
  prices,
}: {
  energy: EnergyResult;
  power?: PowerResult;
  kind: PeriodKind;
  t: Tokens;
  prices?: { importPrice: number; exportPrice: number; currency: string };
}) {
  const tot = useMemo(() => totals(energy), [energy]);
  const peak = useMemo(() => {
    if (!power?.solar) return null;
    let best: { v: number; t: number } | null = null;
    power.solar.forEach((v, i) => {
      if (v !== null && (!best || v > best.v)) best = { v, t: power.times[i] };
    });
    return best as { v: number; t: number } | null;
  }, [power]);
  const savings =
    prices && (prices.importPrice || prices.exportPrice)
      ? (tot.flows.solarToHome + tot.flows.solarToBattery) * prices.importPrice + tot.gridExport * prices.exportPrice
      : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatTile label="Produced" {...fmtEnergy(tot.solar)} swatch={t.role.solar} />
        <StatTile
          label="Self-consumed"
          value={fmtPercent(tot.selfConsumption)}
          sub={`${fmtNumber(tot.flows.solarToHome + tot.flows.solarToBattery, 1)} kWh used on site`}
        />
        {energy.configured.gridExport && <StatTile label="Exported" {...fmtEnergy(tot.gridExport)} swatch={t.role.gridExport} />}
        {peak && (
          <StatTile
            label="Peak power"
            {...fmtPower(peak.v)}
            sub={new Date(peak.t).toLocaleString(undefined, kind === 'day' ? { timeStyle: 'short' } : { dateStyle: 'medium', timeStyle: 'short' })}
          />
        )}
        {savings !== null && (
          <StatTile label="Estimated value" value={fmtMoney(savings, prices!.currency)} sub="avoided import + export credit" />
        )}
      </div>

      {kind === 'day' && power && (power.solar || power.consumption) && <PowerCurve power={power} t={t} />}
      <ProductionChart energy={energy} kind={kind} t={t} />
    </div>
  );
}

function PowerCurve({ power, t }: { power: PowerResult; t: Tokens }) {
  const option = useMemo<EOption>(() => {
    const pts = (arr: (number | null)[] | null) => power.times.map((x, i) => [x, arr?.[i] ?? null]);
    const series = [
      power.solar && lineSeries('Solar', t.role.solar, pts(power.solar), { areaStyle: areaStyle(t.role.solar) }),
      power.consumption && lineSeries('Home', t.role.home, pts(power.consumption)),
    ].filter(Boolean);
    const base = baseOption(t);
    return {
      ...base,
      tooltip: { ...(base.tooltip as object), valueFormatter: (v: number) => (v === null ? '–' : `${fmtPower(v).value} ${fmtPower(v).unit}`) },
      xAxis: timeAxis(t, dayBounds(power.times)),
      yAxis: valueAxis(t, 'W'),
      series,
    };
  }, [power, t]);
  return (
    <ChartCard title="Power today" subtitle="5-minute average · solar production vs home consumption">
      <EChart option={option} height={300} />
    </ChartCard>
  );
}

function ProductionChart({ energy, kind, t }: { energy: EnergyResult; kind: PeriodKind; t: Tokens }) {
  const names = useEntityMap();
  const { option, table } = useMemo(() => {
    const labels = energy.times.map((x) => bucketLabel(kind, x));
    const ents = energy.categories.solar.entities;
    // One inverter: the solar role color. Several: categorical slots in fixed order.
    const parts =
      ents.length > 1
        ? ents.slice(0, 8).map((e, i) => ({ name: names.get(e.entity)?.name ?? e.entity, color: t.series[i], v: e.values }))
        : [{ name: 'Solar', color: t.role.solar, v: energy.categories.solar.total }];
    const base = baseOption(t);
    const option: EOption = {
      ...base,
      legend: { ...(base.legend as object), show: parts.length > 1 || energy.categories.consumption.total.length > 0 },
      tooltip: { ...(base.tooltip as object), valueFormatter: (v: number) => `${fmtNumber(v, 2)} kWh` },
      xAxis: categoryAxis(t, labels),
      yAxis: valueAxis(t, 'kWh'),
      series: [
        ...parts.map((p, i) =>
          barSeries(p.name, p.color, p.v.map((x) => nz(round(x))), { stack: 'solar', rounded: i === parts.length - 1, gap: t.surface }),
        ),
        lineSeries('Consumption', t.role.home, energy.categories.consumption.total.map((x) => round(x)), {
          showSymbol: kind !== 'day',
          symbolSize: 8,
          itemStyle: { color: t.role.home, borderColor: t.surface, borderWidth: 2 },
        }),
      ],
    };
    const table = {
      columns: ['Time', ...parts.map((p) => p.name), 'Consumption'],
      rows: labels.map((l, i) => [l, ...parts.map((p) => fmtNumber(p.v[i], 2)), fmtNumber(energy.categories.consumption.total[i], 2)]),
    };
    return { option, table };
  }, [energy, kind, t, names]);

  if (!energy.configured.solar) {
    return (
      <ChartCard title="Production">
        <Empty>Add solar energy counters (kWh) in <SettingsLink>settings</SettingsLink> to see production totals.</Empty>
      </ChartCard>
    );
  }
  return (
    <ChartCard title="Production" subtitle="kWh per period, with consumption for comparison" table={table}>
      <EChart option={option} height={320} />
    </ChartCard>
  );
}
