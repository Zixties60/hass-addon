import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, Table2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { isCurrentPeriod, type Period, type PeriodKind, periodLabel, shiftPeriod } from '../lib/time';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-line bg-surface p-4 ${className}`}>{children}</section>;
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      {/* On mobile the sticky header already shows the page title. */}
      <h1 className="sr-only text-xl font-semibold md:not-sr-only">{title}</h1>
      <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">{children}</div>
    </div>
  );
}

export function StatTile({
  label,
  value,
  unit,
  sub,
  swatch,
  hero,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: ReactNode;
  swatch?: string;
  hero?: boolean;
}) {
  return (
    <Card className="min-w-0">
      <div className="flex items-center gap-2 text-sm text-ink-2">
        {swatch && <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: swatch }} />}
        <span className="truncate">{label}</span>
      </div>
      <div className={`mt-1 font-semibold leading-tight tnum ${hero ? 'text-4xl sm:text-5xl' : 'text-2xl'}`}>
        {value}
        {unit && <span className={`ml-1 font-normal text-ink-2 ${hero ? 'text-lg sm:text-xl' : 'text-sm'}`}>{unit}</span>}
      </div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </Card>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  fill,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label?: string;
  /** Stretch to the full width on mobile, with equal-width options. */
  fill?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`max-w-full overflow-x-auto rounded-lg border border-line bg-surface p-0.5 ${
        fill ? 'flex w-full md:inline-flex md:w-auto' : 'inline-flex'
      }`}
    >
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`shrink-0 whitespace-nowrap rounded-md py-1 text-sm pointer-coarse:min-h-10 pointer-coarse:py-2 ${
            fill ? 'flex-1 px-2 md:flex-none md:px-3' : 'px-3'
          } ${
            o.value === value ? 'bg-surface-2 font-medium text-ink' : 'text-ink-2 hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PeriodNav({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  return (
    <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
      <Segmented<PeriodKind>
        fill
        label="Period"
        value={period.kind}
        onChange={(kind) => onChange({ ...period, kind })}
        options={[
          { value: 'day', label: 'Day' },
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
          { value: 'cycle', label: 'Billing' },
          { value: 'year', label: 'Year' },
        ]}
      />
      <div className="flex w-full items-center gap-1 md:inline-flex md:w-auto">
        <button className="btn px-2" aria-label="Previous period" onClick={() => onChange(shiftPeriod(period, -1))}>
          <ChevronLeft size={18} />
        </button>
        <span className="min-w-36 flex-1 text-center text-sm font-medium md:flex-none">{periodLabel(period)}</span>
        <button
          className="btn px-2"
          aria-label="Next period"
          disabled={isCurrentPeriod(period)}
          onClick={() => onChange(shiftPeriod(period, 1))}
        >
          <ChevronRight size={18} />
        </button>
        {!isCurrentPeriod(period) && (
          <button className="btn" onClick={() => onChange({ ...period, anchor: Date.now() })}>
            Now
          </button>
        )}
      </div>
    </div>
  );
}

export interface TableData {
  columns: string[];
  rows: (string | number)[][];
}

/** Chart card with a title and an optional table view of the same data. */
export function ChartCard({
  title,
  subtitle,
  table,
  actions,
  children,
  className = '',
}: {
  title: string;
  subtitle?: ReactNode;
  table?: TableData;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <Card className={className}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0 pt-1">
          <h2 className="font-medium">{title}</h2>
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          {table && (
            <button
              className={`btn px-2 ${showTable ? 'bg-surface-2' : ''}`}
              aria-pressed={showTable}
              title="Table view"
              onClick={() => setShowTable((s) => !s)}
            >
              <Table2 size={16} />
            </button>
          )}
        </div>
      </div>
      {showTable && table ? <DataTable data={table} /> : children}
    </Card>
  );
}

export function DataTable({ data }: { data: TableData }) {
  return (
    <div className="max-h-96 overflow-auto overscroll-contain">
      <table className="tnum w-full text-sm">
        <thead className="sticky top-0 bg-surface text-left text-ink-2">
          <tr>
            {data.columns.map((c, i) => (
              <th key={c} className={`whitespace-nowrap border-b border-line px-2 py-1.5 font-medium ${i > 0 ? 'text-right' : 'sticky left-0 z-10 bg-surface'}`}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r, i) => (
            <tr key={i} className="border-b border-line last:border-0">
              {r.map((v, j) => (
                <td key={j} className={`whitespace-nowrap px-2 py-1 pointer-coarse:py-2 ${j > 0 ? 'text-right' : 'sticky left-0 bg-surface'}`}>
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Loading({ label = 'Loading…', height = 200 }: { label?: string; height?: number }) {
  return (
    <div className="flex items-center justify-center gap-2 text-sm text-muted" style={{ height }}>
      <Loader2 size={16} className="animate-spin" /> {label}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-line bg-surface-2 p-3 text-sm">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--critical)' }} />
      <span>{error instanceof Error ? error.message : String(error)}</span>
    </div>
  );
}

export function Empty({ children, height = 160 }: { children: ReactNode; height?: number }) {
  return (
    <div className="flex items-center justify-center px-4 text-center text-sm text-muted" style={{ minHeight: height }}>
      <div>{children}</div>
    </div>
  );
}

/** Link to the settings page using the hash router. */
export function SettingsLink({ children = 'Open settings' }: { children?: ReactNode }) {
  return (
    <a href="#/settings" className="font-medium text-accent underline-offset-2 hover:underline">
      {children}
    </a>
  );
}
