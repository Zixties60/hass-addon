import { Check, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { EntityInfo } from '../../shared/types';
import { useEntities, useEntityMap } from '../lib/hooks';

const RAW_ID = /^[a-z0-9_]+\.[a-z0-9_]+(:[A-Za-z0-9_]+)?$/;

/**
 * Searchable multi-select over the entities found in InfluxDB.
 * `suggest` narrows the list to likely matches (e.g. energy units); users can switch to all.
 * Attribute fields can be typed as "climate.living_room:current_temperature".
 */
export function EntityPicker({
  value,
  onChange,
  suggest,
  placeholder = 'Search entities…',
  max,
  colors,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  suggest?: (e: EntityInfo) => boolean;
  placeholder?: string;
  max?: number;
  colors?: (id: string, index: number) => string | undefined;
}) {
  const { data: all = [], isLoading } = useEntities();
  const byId = useEntityMap();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(!suggest);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  }, []);

  const results = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return all
      .filter((e) => showAll || !suggest || suggest(e))
      .filter((e) => {
        const hay = `${e.name} ${e.id}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 80);
  }, [all, q, showAll, suggest]);

  const full = max !== undefined && value.length >= max;
  const toggle = (id: string) => {
    if (value.includes(id)) onChange(value.filter((v) => v !== id));
    else if (!full) onChange([...value, id]);
  };
  const rawCandidate = RAW_ID.test(q.trim()) && !byId.has(q.trim()) ? q.trim() : null;

  return (
    <div ref={root} className="relative">
      <div
        className="field flex min-h-10 flex-wrap items-center gap-1.5 py-1 pointer-coarse:min-h-12"
        onClick={() => {
          setOpen(true);
          root.current?.querySelector('input')?.focus();
        }}
      >
        {value.map((id, i) => (
          <span key={id} className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-surface-2 py-0.5 pl-2 pr-1 text-sm pointer-coarse:py-1">
            {colors?.(id, i) && (
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colors(id, i) }} />
            )}
            <span className="truncate" title={id}>
              {byId.get(id)?.name ?? id}
            </span>
            <button
              className="-my-1 rounded p-0.5 text-muted hover:text-ink pointer-coarse:p-1.5"
              aria-label={`Remove ${id}`}
              onClick={(e) => {
                e.stopPropagation();
                toggle(id);
              }}
            >
              <X size={16} />
            </button>
          </span>
        ))}
        <div className="flex min-w-32 flex-1 items-center gap-1">
          {value.length === 0 && <Search size={14} className="text-muted" />}
          <input
            type="text"
            role="combobox"
            aria-expanded={open && !full}
            aria-autocomplete="list"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            className="w-full bg-transparent py-1 text-sm outline-none pointer-coarse:py-1.5"
            placeholder={full ? `Maximum ${max} selected` : placeholder}
            value={q}
            disabled={full}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, results.length - 1));
              else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
              else if (e.key === 'Escape') setOpen(false);
              else if (e.key === 'Enter') {
                e.preventDefault();
                if (rawCandidate) {
                  toggle(rawCandidate);
                  setQ('');
                } else if (results[active]) toggle(results[active].id);
              } else if (e.key === 'Backspace' && !q && value.length) onChange(value.slice(0, -1));
            }}
          />
        </div>
      </div>

      {open && !full && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
          {suggest && (
            <label className="flex items-center gap-2 border-b border-line px-3 py-2 text-xs text-ink-2 pointer-coarse:py-3">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              Show all entities (not only suggested)
            </label>
          )}
          <ul className="max-h-72 overflow-auto overscroll-contain py-1 pointer-coarse:max-h-[50dvh]" role="listbox" aria-multiselectable>
            {isLoading && <li className="px-3 py-2 text-sm text-muted">Loading entities…</li>}
            {rawCandidate && (
              <li>
                <button
                  className="w-full px-3 py-2 text-left text-sm hover:bg-surface-2 pointer-coarse:py-3"
                  onClick={() => {
                    toggle(rawCandidate);
                    setQ('');
                  }}
                >
                  Add <code>{rawCandidate}</code>
                </button>
              </li>
            )}
            {!isLoading && !results.length && !rawCandidate && (
              <li className="px-3 py-2 text-sm text-muted">No matching entities</li>
            )}
            {results.map((e, i) => {
              const selected = value.includes(e.id);
              return (
                <li key={e.id} role="option" aria-selected={selected}>
                  <button
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm pointer-coarse:py-2.5 ${
                      i === active ? 'bg-surface-2' : 'hover:bg-surface-2'
                    }`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => toggle(e.id)}
                  >
                    <span className="flex w-4 shrink-0 justify-center">{selected && <Check size={16} strokeWidth={3} />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{e.name}</span>
                      <span className="block truncate text-xs text-muted">{e.id}</span>
                    </span>
                    <span className="tnum shrink-0 text-xs text-ink-2">
                      {e.last !== null && e.last !== undefined ? `${e.last}${e.unit ? ` ${e.unit}` : ''}` : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
