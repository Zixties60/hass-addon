import {
  ChartLine,
  LayoutDashboard,
  Maximize2,
  Menu,
  Minimize2,
  Monitor,
  Moon,
  Settings,
  Sun,
  SunMedium,
  Thermometer,
  Zap,
} from 'lucide-react';
import { useState } from 'react';
import { toggleHaMenu, useHaFullscreen } from './lib/haFrame';
import { useRoute } from './lib/hooks';
import { getThemePref, setThemePref, type ThemePref } from './lib/theme';
import { ClimatePage } from './pages/Climate';
import { EnergyPage } from './pages/Energy';
import { HistoryPage } from './pages/History';
import { OverviewPage } from './pages/Overview';
import { SettingsPage } from './pages/Settings';
import { SolarPage } from './pages/Solar';

const PAGES = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard, el: OverviewPage },
  { key: 'energy', label: 'Energy', icon: Zap, el: EnergyPage },
  { key: 'solar', label: 'Solar', icon: SunMedium, el: SolarPage },
  { key: 'climate', label: 'Climate', icon: Thermometer, el: ClimatePage },
  { key: 'history', label: 'History', icon: ChartLine, el: HistoryPage },
  { key: 'settings', label: 'Settings', icon: Settings, el: SettingsPage },
] as const;

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

/** Opens Home Assistant's sidebar while the dashboard is shown full screen. */
function HaMenuButton() {
  return (
    <button className="btn px-2" title="Home Assistant menu" aria-label="Show Home Assistant sidebar" onClick={toggleHaMenu}>
      <Menu size={16} />
    </button>
  );
}

function FullscreenToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const label = value ? 'Exit full screen' : 'Full screen';
  return (
    <button className="btn px-2" title={label} aria-label={label} aria-pressed={value} onClick={() => onChange(!value)}>
      {value ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
    </button>
  );
}

export function App() {
  const ha = useHaFullscreen();
  const haMenu = ha.supported && ha.fullscreen;
  const { page } = useRoute();
  const current = PAGES.find((p) => p.key === page) ?? PAGES[0];
  const Page = current.el;

  return (
    <div className="min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-56 flex-col border-r border-line bg-surface md:flex">
        <div className="flex items-center gap-2 px-4 py-4">
          {haMenu ? <HaMenuButton /> : <img src="./icon.svg" alt="" className="h-7 w-7" />}
          <span className="font-semibold">Home Dashboard</span>
        </div>
        <nav className="flex-1 space-y-0.5 px-2">
          {PAGES.map((p) => (
            <a
              key={p.key}
              href={`#/${p.key}`}
              aria-current={p.key === current.key ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                p.key === current.key ? 'bg-surface-2 font-medium text-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
              }`}
            >
              <p.icon size={18} /> {p.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center justify-between px-4 py-3 text-xs text-muted">
          <span>Read-only view</span>
          <div className="flex gap-1">
            {ha.supported && <FullscreenToggle value={ha.fullscreen} onChange={ha.setFullscreen} />}
            <ThemeToggle />
          </div>
        </div>
      </aside>

      {/* Mobile header */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-surface px-4 py-2 md:hidden">
        <div className="flex items-center gap-2">
          {haMenu ? <HaMenuButton /> : <img src="./icon.svg" alt="" className="h-6 w-6" />}
          <span className="font-semibold">{current.label}</span>
        </div>
        <div className="flex gap-1">
          {ha.supported && <FullscreenToggle value={ha.fullscreen} onChange={ha.setFullscreen} />}
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 pb-24 pt-4 md:ml-56 md:px-6 md:pb-8 md:pt-6">
        <Page />
      </main>

      {/* Mobile bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-6 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        {PAGES.map((p) => (
          <a
            key={p.key}
            href={`#/${p.key}`}
            aria-current={p.key === current.key ? 'page' : undefined}
            className={`flex flex-col items-center gap-0.5 py-2 text-[10px] ${p.key === current.key ? 'text-accent' : 'text-muted'}`}
          >
            <p.icon size={20} />
            {p.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
