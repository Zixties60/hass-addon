import { BarChart, CustomChart, LineChart, SankeyChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';
import { compact } from '../lib/format';
import type { Tokens } from '../lib/theme';

echarts.use([
  LineChart,
  BarChart,
  CustomChart,
  SankeyChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
  CanvasRenderer,
]);

export type EOption = echarts.EChartsCoreOption;

export { echarts };

export function EChart({
  option,
  height = 280,
  onClick,
  group,
}: {
  option: EOption;
  height?: number;
  onClick?: (params: any) => void;
  /** Charts sharing a group get synchronized tooltips and zoom. */
  group?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const c = echarts.init(ref.current, null, { renderer: 'canvas' });
    chart.current = c;
    if (group) {
      c.group = group;
      echarts.connect(group);
    }
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);

  useEffect(() => {
    const c = chart.current;
    if (!c || !onClick) return;
    c.on('click', onClick);
    return () => {
      c.off('click', onClick);
    };
  }, [onClick]);

  return <div ref={ref} style={{ height, width: '100%' }} />;
}

// ---------- shared option builders (recessive chrome, data is the loud part) ----------

export function baseOption(t: Tokens): EOption {
  return {
    animationDuration: 300,
    textStyle: { fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', color: t.ink2 },
    grid: { left: 8, right: 16, top: 52, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis',
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      textStyle: { color: t.ink, fontSize: 12 },
      extraCssText: 'border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);',
      axisPointer: { type: 'line', lineStyle: { color: t.axis, width: 1 } },
    },
    legend: {
      top: 0,
      left: 0,
      icon: 'roundRect',
      itemWidth: 12,
      itemHeight: 4,
      textStyle: { color: t.ink2, fontSize: 12 },
      inactiveColor: t.axis,
    },
  };
}

export function timeAxis(t: Tokens, extra: Record<string, unknown> = {}) {
  return {
    type: 'time',
    axisLine: { lineStyle: { color: t.axis } },
    axisTick: { show: false },
    axisLabel: { color: t.muted, hideOverlap: true, fontSize: 11 },
    splitLine: { show: false },
    ...extra,
  };
}

export function categoryAxis(t: Tokens, data: string[], extra: Record<string, unknown> = {}) {
  return {
    type: 'category',
    data,
    axisLine: { lineStyle: { color: t.axis } },
    axisTick: { show: false },
    axisLabel: { color: t.muted, hideOverlap: true, fontSize: 11 },
    ...extra,
  };
}

export function valueAxis(t: Tokens, unit?: string | null, extra: Record<string, unknown> = {}) {
  return {
    type: 'value',
    name: unit ?? '',
    nameTextStyle: { color: t.muted, fontSize: 11, align: 'left' },
    scale: false,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: 11, formatter: (v: number) => compact(v) },
    splitLine: { lineStyle: { color: t.grid, width: 1 } },
    ...extra,
  };
}

/** 2px line with a ~10% wash, per the mark spec. */
export function lineSeries(name: string, color: string, data: unknown[], opts: Record<string, unknown> = {}) {
  return {
    type: 'line',
    name,
    data,
    showSymbol: false,
    symbolSize: 8,
    connectNulls: false,
    lineStyle: { width: 2, color, cap: 'round', join: 'round' },
    itemStyle: { color },
    emphasis: { focus: 'series', lineStyle: { width: 2 } },
    ...opts,
  };
}

export function areaStyle(color: string) {
  return { color, opacity: 0.1 };
}

/**
 * Column capped at 24px with a 4px rounded data-end (bottom end for negative columns).
 * `gap` draws a 1px surface-colored edge so touching segments get a 2px separation.
 */
export function barSeries(
  name: string,
  color: string,
  data: unknown[],
  opts: { stack?: string; negative?: boolean; rounded?: boolean; gap?: string; [k: string]: unknown } = {},
) {
  const { negative, rounded = true, gap, ...rest } = opts;
  const r = rounded ? 4 : 0;
  return {
    type: 'bar',
    name,
    data,
    barMaxWidth: 24,
    itemStyle: {
      color,
      borderRadius: negative ? [0, 0, r, r] : [r, r, 0, 0],
      ...(gap ? { borderColor: gap, borderWidth: 1 } : {}),
    },
    emphasis: { focus: 'series' },
    ...rest,
  };
}
