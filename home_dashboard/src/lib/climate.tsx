import { CircleCheck, OctagonAlert, OctagonX, TriangleAlert } from 'lucide-react';
import type { ClimateMetric } from '../../shared/types';

export type Status = 'good' | 'warning' | 'serious' | 'critical';

/** Comfort / air-quality bands. Returns null when there is no meaningful band for the metric. */
export function climateStatus(metric: ClimateMetric, value: number | null, unit: string | null): { status: Status; label: string } | null {
  if (value === null) return null;
  switch (metric) {
    case 'temperature': {
      const c = unit === '°F' ? ((value - 32) * 5) / 9 : value;
      if (c > 32) return { status: 'critical', label: 'Very hot' };
      if (c > 28) return { status: 'serious', label: 'Hot' };
      if (c > 26) return { status: 'warning', label: 'Warm' };
      if (c >= 20) return { status: 'good', label: 'Comfortable' };
      if (c >= 18) return { status: 'warning', label: 'Cool' };
      return { status: 'serious', label: 'Cold' };
    }
    case 'humidity':
      if (value > 70) return { status: 'serious', label: 'Very humid' };
      if (value > 60) return { status: 'warning', label: 'Humid' };
      if (value >= 30) return { status: 'good', label: 'Comfortable' };
      if (value >= 25) return { status: 'warning', label: 'Dry' };
      return { status: 'serious', label: 'Very dry' };
    case 'pm25':
      if (value <= 12) return { status: 'good', label: 'Good' };
      if (value <= 35.4) return { status: 'warning', label: 'Moderate' };
      if (value <= 55.4) return { status: 'serious', label: 'Unhealthy (sensitive)' };
      return { status: 'critical', label: 'Unhealthy' };
    case 'pm10':
      if (value <= 54) return { status: 'good', label: 'Good' };
      if (value <= 154) return { status: 'warning', label: 'Moderate' };
      if (value <= 254) return { status: 'serious', label: 'Unhealthy (sensitive)' };
      return { status: 'critical', label: 'Unhealthy' };
    case 'co2':
      if (value < 800) return { status: 'good', label: 'Fresh' };
      if (value < 1200) return { status: 'warning', label: 'Stuffy' };
      if (value < 2000) return { status: 'serious', label: 'Poor' };
      return { status: 'critical', label: 'Very poor' };
    default:
      return null;
  }
}

const ICONS = { good: CircleCheck, warning: TriangleAlert, serious: OctagonAlert, critical: OctagonX };

/** Status always pairs color with an icon and a text label. */
export function StatusChip({ status, label }: { status: Status; label: string }) {
  const Icon = ICONS[status];
  return (
    <span className="inline-flex items-center gap-1 text-xs text-ink-2">
      <Icon size={14} style={{ color: `var(--${status})` }} aria-hidden />
      {label}
    </span>
  );
}

export const METRIC_ORDER: ClimateMetric[] = ['temperature', 'humidity', 'pm25', 'pm10', 'co2', 'voc', 'pressure', 'illuminance', 'other'];
