import { useEffect, useState } from 'react';

export type ThemePref = 'auto' | 'light' | 'dark';

export function getThemePref(): ThemePref {
  try {
    const t = localStorage.getItem('hd-theme');
    return t === 'light' || t === 'dark' ? t : 'auto';
  } catch {
    return 'auto';
  }
}

export function setThemePref(p: ThemePref) {
  try {
    localStorage.setItem('hd-theme', p);
  } catch {
    /* storage unavailable */
  }
  if (p === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = p;
  window.dispatchEvent(new Event('hd-theme'));
}

export interface Tokens {
  dark: boolean;
  surface: string;
  surface2: string;
  ink: string;
  ink2: string;
  muted: string;
  grid: string;
  axis: string;
  border: string;
  series: string[];
  status: { good: string; warning: string; serious: string; critical: string };
  role: { solar: string; gridImport: string; gridExport: string; battery: string; home: string };
}

function readTokens(): Tokens {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  const series = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`--s${i}`));
  return {
    dark: cs.colorScheme === 'dark',
    surface: v('--surface'),
    surface2: v('--surface-2'),
    ink: v('--ink'),
    ink2: v('--ink-2'),
    muted: v('--muted'),
    grid: v('--grid'),
    axis: v('--axis'),
    border: v('--border'),
    series,
    status: { good: v('--good'), warning: v('--warning'), serious: v('--serious'), critical: v('--critical') },
    // Fixed role colors: an energy flow keeps its color on every page.
    role: { solar: series[3], gridImport: series[0], gridExport: series[2], battery: series[6], home: series[1] },
  };
}

/** Current theme tokens; re-reads when the OS scheme or the in-app toggle changes. */
export function useTokens(): Tokens {
  const [tokens, setTokens] = useState(readTokens);
  useEffect(() => {
    const update = () => setTokens(readTokens());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', update);
    window.addEventListener('hd-theme', update);
    return () => {
      mq.removeEventListener('change', update);
      window.removeEventListener('hd-theme', update);
    };
  }, []);
  return tokens;
}
