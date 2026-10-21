import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EntityInfo } from '../../shared/types';
import { api } from './api';

export function useEntities() {
  return useQuery({ queryKey: ['entities'], queryFn: () => api.entities(), staleTime: 300_000 });
}

export function useEntityMap(): Map<string, EntityInfo> {
  const { data } = useEntities();
  return useMemo(() => new Map((data ?? []).map((e) => [e.id, e])), [data]);
}

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: api.settings, staleTime: 60_000 });
}

export function useInfo() {
  return useQuery({ queryKey: ['info'], queryFn: api.info, staleTime: 60_000 });
}

// ---------- tiny hash router: #/page?param=value ----------

function parseHash() {
  const h = window.location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = h.split('?');
  return { page: path || 'overview', params: new URLSearchParams(query) };
}

export function useRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

/** Updates query params of the current page without adding history entries. */
export function useHashParams(): [URLSearchParams, (update: Record<string, string | null>) => void] {
  const { page, params } = useRoute();
  const set = useCallback(
    (update: Record<string, string | null>) => {
      const p = new URLSearchParams(parseHash().params);
      for (const [k, v] of Object.entries(update)) {
        if (v === null || v === '') p.delete(k);
        else p.set(k, v);
      }
      const qs = p.toString();
      history.replaceState(null, '', `#/${page}${qs ? `?${qs}` : ''}`);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    },
    [page],
  );
  return [params, set];
}

/** State persisted in localStorage (per-viewer convenience only). */
export function useStoredState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`hd-${key}`);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(`hd-${key}`, JSON.stringify(v));
      } catch {
        /* storage unavailable */
      }
    },
    [key],
  );
  return [value, set];
}
