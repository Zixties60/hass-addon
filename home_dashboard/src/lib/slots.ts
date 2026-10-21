import { useMemo, useRef } from 'react';

/**
 * Assigns each id a categorical slot (0..size-1) that stays fixed while the id is selected,
 * so removing one series never repaints the others. Ids beyond `size` get no slot.
 */
export function useSlots(ids: string[], size = 8): Map<string, number> {
  const ref = useRef(new Map<string, number>());
  const key = ids.join('|');
  return useMemo(() => {
    const m = ref.current;
    for (const k of [...m.keys()]) if (!ids.includes(k)) m.delete(k);
    for (const id of ids) {
      if (m.has(id)) continue;
      const used = new Set(m.values());
      for (let i = 0; i < size; i++) {
        if (!used.has(i)) {
          m.set(id, i);
          break;
        }
      }
    }
    return new Map(m);
  }, [key, size]);
}
