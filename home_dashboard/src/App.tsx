import {
  ChartLine,
  House,
  LayoutDashboard,
  Menu,
  Monitor,
  Moon,
  Settings,
  Sun,
  SunMedium,
  Thermometer,
  X,
  Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { toggleHaMenu, useHaFullscreen } from './lib/haFrame';
import { useRoute } from './lib/hooks';
import { getThemePref, setThemePref, type ThemePref } from './lib/theme';
import { ClimatePage } from './pages/Climate';
import { EnergyPage } from './pages/Energy';
import { HistoryPage } from './pages/History';
import { OverviewPage } from './pages/Overview';
import { SettingsPage } from './pages/Settings';
import { SolarPage } from './pages/Solar';

/** `main` pages are in the mobile bottom bar; the others only in the sidebar. */
const PAGES = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard, el: OverviewPage, main: true },
  { key: 'energy', label: 'Energy', icon: Zap, el: EnergyPage, main: true },
  { key: 'solar', label: 'Solar', icon: SunMedium, el: SolarPage, main: true },
  { key: 'climate', label: 'Climate', icon: Thermometer, el: ClimatePage, main: true },
  { key: 'history', label: 'History', icon: ChartLine, el: HistoryPage, main: false },
  { key: 'settings', label: 'Settings', icon: Settings, el: SettingsPage, main: false },
] as const;

type PageDef = (typeof PAGES)[number];

function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>(getThemePref);
  const next: Record<ThemePref, ThemePref> = { auto: 'light', light: 'dark', dark: 'auto' };
  const Icon = pref === 'auto' ? Monitor : pref === 'light' ? Sun : Moon;
  return (
    <button
      className="btn px-2"
      title={`Theme: ${pref}`}
      aria-label={`Theme: ${pref}. Switch to ${next[pref]}`}
      onClick={() => {
        setThemePref(next[pref]);
        setPref(next[pref]);
      }}
    >
      <Icon size={16} />
    </button>
  );
}

const itemClass = (active: boolean) =>
  `flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${
    active ? 'bg-surface-2 font-medium text-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
  }`;

function NavItem({ p, current, onNavigate }: { p: PageDef; current: PageDef; onNavigate?: () => void }) {
  return (
    <a href={`#/${p.key}`} aria-current={p === current ? 'page' : undefined} className={itemClass(p === current)} onClick={onNavigate}>
      <p.icon size={18} /> {p.label}
    </a>
  );
}

function Sidebar({
  current,
  haMenu,
  onNavigate,
  onClose,
}: {
  current: PageDef;
  /** Show the item that opens Home Assistant's sidebar. */
  haMenu: boolean;
  onNavigate?: () => void;
  onClose?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 py-4">
        <img src="./icon.svg" alt="" className="h-7 w-7" />
        <span className="flex-1 font-semibold">Home Dashboard</span>
        {onClose && (
          <button className="btn px-2" aria-label="Close menu" onClick={onClose}>
            <X size={16} />
          </button>
        )}
      </div>
      <nav className="flex flex-1 flex-col px-2" aria-label="Pages">
        <div className="space-y-0.5">
          {PAGES.filter((p) => p.main).map((p) => (
            <NavItem key={p.key} p={p} current={current} onNavigate={onNavigate} />
          ))}
        </div>
        <div className="mt-auto space-y-0.5 border-t border-line pt-2">
          {PAGES.filter((p) => !p.main).map((p) => (
            <NavItem key={p.key} p={p} current={current} onNavigate={onNavigate} />
          ))}
          {haMenu && (
            <button
              className={itemClass(false)}
              title="Show the Home Assistant sidebar"
              onClick={() => {
                onNavigate?.();
                toggleHaMenu();
              }}
            >
              <House size={18} /> Home Assistant
            </button>
          )}
        </div>
      </nav>
      <div className="flex items-center justify-between px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] text-xs text-muted">
        <span>Read-only view</span>
        <ThemeToggle />
      </div>
    </div>
  );
}

export function App() {
  const haMenu = useHaFullscreen();
  const { page } = useRoute();
  const current = PAGES.find((p) => p.key === page) ?? PAGES[0];
  const Page = current.el;
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer]);

  return (
    <div className="min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-56 border-r border-line bg-surface md:block">
        <Sidebar current={current} haMenu={haMenu} />
      </aside>

      {/* Mobile sidebar (drawer) */}
      <div className={`fixed inset-0 z-40 md:hidden ${drawer ? '' : 'pointer-events-none'}`} aria-hidden={!drawer}>
        <div
          className={`absolute inset-0 bg-black/50 transition-opacity motion-reduce:transition-none ${drawer ? 'opacity-100' : 'opacity-0'}`}
          onClick={() => setDrawer(false)}
        />
        <aside
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          inert={!drawer}
          className={`absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-line bg-surface shadow-xl transition-transform duration-200 motion-reduce:transition-none ${
            drawer ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <Sidebar current={current} haMenu={haMenu} onNavigate={() => setDrawer(false)} onClose={() => setDrawer(false)} />
        </aside>
      </div>

      {/* Mobile header */}
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-line bg-surface px-4 py-2 md:hidden">
        <button className="btn px-2" aria-label="Open menu" aria-expanded={drawer} onClick={() => setDrawer(true)}>
          <Menu size={16} />
        </button>
        <span className="font-semibold">{current.label}</span>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-4 md:ml-56 md:px-6 md:pb-8 md:pt-6">
        <Page />
      </main>

      {/* Mobile bottom navigation: a floating bar above the page */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:hidden">
        <nav className="pointer-events-auto grid w-full max-w-sm grid-cols-4 gap-1 rounded-2xl border border-line bg-surface/85 p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.18)] backdrop-blur-md">
          {PAGES.filter((p) => p.main).map((p) => {
            const active = p.key === current.key;
            return (
              <a
                key={p.key}
                href={`#/${p.key}`}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[10px] transition-colors ${
                  active ? 'bg-surface-2 font-medium text-accent' : 'text-muted hover:text-ink'
                }`}
              >
                <p.icon size={20} />
                {p.label}
              </a>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
