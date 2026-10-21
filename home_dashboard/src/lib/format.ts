export function fmtNumber(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  return v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** Watts with automatic kW / MW scaling. */
export function fmtPower(w: number | null | undefined): { value: string; unit: string } {
  if (w === null || w === undefined || !Number.isFinite(w)) return { value: '–', unit: 'W' };
  const a = Math.abs(w);
  if (a >= 1_000_000) return { value: fmtNumber(w / 1_000_000, 2), unit: 'MW' };
  if (a >= 1000) return { value: fmtNumber(w / 1000, 2), unit: 'kW' };
  return { value: fmtNumber(w, 0), unit: 'W' };
}

/** kWh with automatic MWh scaling. */
export function fmtEnergy(kwh: number | null | undefined): { value: string; unit: string } {
  if (kwh === null || kwh === undefined || !Number.isFinite(kwh)) return { value: '–', unit: 'kWh' };
  if (Math.abs(kwh) >= 10_000) return { value: fmtNumber(kwh / 1000, 2), unit: 'MWh' };
  return { value: fmtNumber(kwh, Math.abs(kwh) < 10 ? 2 : 1), unit: 'kWh' };
}

export function fmtMoney(v: number, currency: string): string {
  if (/^[A-Z]{3}$/.test(currency)) {
    try {
      return v.toLocaleString(undefined, { style: 'currency', currency, maximumFractionDigits: 2 });
    } catch {
      /* unknown currency code: fall through */
    }
  }
  return `${fmtNumber(v, 2)} ${currency}`.trim();
}

export function fmtPercent(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  return `${Math.round(v * 100)}%`;
}

/** Compact axis labels: 0 / 1K / 2.5K. */
export function compact(v: number): string {
  return Intl.NumberFormat(undefined, { notation: 'compact', maximumSignificantDigits: 3 }).format(v);
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
