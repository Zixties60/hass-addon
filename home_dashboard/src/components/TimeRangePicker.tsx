import { format } from 'date-fns';
import { CalendarClock, Check, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useMedia, useOverlay, useSwipeDismiss } from '../lib/overlay';
import { PRESETS, rangeLabel, type RangeValue, resolveRange } from '../lib/time';

const toLocalInput = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm");

export function TimeRangePicker({ value, onChange }: { value: RangeValue; onChange: (v: RangeValue) => void }) {
  const [open, setOpen] = useState(false);
  const resolved = resolveRange(value);
  const [start, setStart] = useState(toLocalInput(resolved.start));
  const [stop, setStop] = useState(toLocalInput(resolved.stop));
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // Below md the picker is a modal bottom sheet; above it a dropdown.
  const sheet = !useMedia('(min-width: 48rem)');
  const close = () => setOpen(false);
  useOverlay(open, { onClose: close, container: panel, lockScroll: sheet });
  const swipe = useSwipeDismiss('down', close);

  useEffect(() => {
    const onDoc = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
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
        <>
          {/* On mobile the picker is a bottom sheet over a dimmed page. */}
          <div className="fixed inset-0 z-40 bg-black/40 md:hidden" aria-hidden onClick={close} />
          <div
            ref={panel}
            role="dialog"
            aria-modal={sheet || undefined}
            aria-label="Time range"
            {...(sheet ? swipe.handlers : {})}
            style={sheet ? swipe.style : undefined}
            className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-2xl border border-line bg-surface pb-[var(--safe-bottom)] shadow-lg md:absolute md:inset-x-auto md:bottom-auto md:right-0 md:z-30 md:mt-1 md:max-h-none md:w-72 md:overflow-visible md:rounded-lg md:pb-0"
          >
            {sheet && (
              <div className="sticky top-0 z-10 bg-surface px-4 pb-1 pt-2">
                <div className="mx-auto h-1 w-10 rounded-full bg-ink/20" aria-hidden />
                <div className="mt-2 flex items-center justify-between">
                  <h2 className="font-semibold">Time range</h2>
                  <button className="btn border-transparent px-2" aria-label="Close" onClick={close}>
                    <X size={20} />
                  </button>
                </div>
              </div>
            )}
            <ul className="py-1">
              {PRESETS.map((p) => {
                const selected = 'preset' in value && value.preset === p.key;
                return (
                  <li key={p.key}>
                    <button
                      className="flex w-full items-center gap-2 px-4 py-3 text-left text-base hover:bg-surface-2 active:bg-surface-2 md:px-3 md:py-1.5 md:text-sm"
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
            <div className="space-y-3 border-t border-line p-4 md:space-y-2 md:p-3">
              <div className="text-xs font-medium text-ink-2">Custom range</div>
              <label className="block text-xs text-muted">
                From
                <input type="datetime-local" className="field mt-1 w-full" value={start} onChange={(e) => setStart(e.target.value)} />
              </label>
              <label className="block text-xs text-muted">
                To
                <input type="datetime-local" className="field mt-1 w-full" value={stop} onChange={(e) => setStop(e.target.value)} />
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
        </>
      )}
    </div>
  );
}
