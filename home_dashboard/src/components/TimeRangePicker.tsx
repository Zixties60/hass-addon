import { format } from 'date-fns';
import { CalendarClock, Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PRESETS, rangeLabel, type RangeValue, resolveRange } from '../lib/time';

const toLocalInput = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm");

export function TimeRangePicker({ value, onChange }: { value: RangeValue; onChange: (v: RangeValue) => void }) {
  const [open, setOpen] = useState(false);
  const resolved = resolveRange(value);
  const [start, setStart] = useState(toLocalInput(resolved.start));
  const [stop, setStop] = useState(toLocalInput(resolved.stop));
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    if (!open) return;
    const r = resolveRange(value);
    setStart(toLocalInput(r.start));
    setStop(toLocalInput(r.stop));
  }, [open]);

  const valid = start && stop && new Date(stop) > new Date(start);

  return (
    <div ref={root} className="relative">
      <button className="btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <CalendarClock size={16} /> {rangeLabel(value)}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-72 rounded-lg border border-line bg-surface shadow-lg">
          <ul className="py-1">
            {PRESETS.map((p) => {
              const selected = 'preset' in value && value.preset === p.key;
              return (
                <li key={p.key}>
                  <button
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-2"
                    onClick={() => {
                      onChange({ preset: p.key });
                      setOpen(false);
                    }}
                  >
                    <span className="flex w-4 justify-center">{selected && <Check size={16} strokeWidth={3} />}</span>
                    <span className={selected ? 'font-semibold' : ''}>{p.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="space-y-2 border-t border-line p-3">
            <div className="text-xs font-medium text-ink-2">Custom range</div>
            <label className="block text-xs text-muted">
              From
              <input type="datetime-local" className="field mt-0.5 w-full" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label className="block text-xs text-muted">
              To
              <input type="datetime-local" className="field mt-0.5 w-full" value={stop} onChange={(e) => setStop(e.target.value)} />
            </label>
            <button
              className="btn btn-primary w-full justify-center"
              disabled={!valid}
              onClick={() => {
                onChange({ start: new Date(start).toISOString(), stop: new Date(stop).toISOString() });
                setOpen(false);
              }}
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
