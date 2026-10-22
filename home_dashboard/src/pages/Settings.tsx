import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Download, Plus, Save, Trash2, TriangleAlert, Undo2 } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  CLIMATE_METRICS,
  type ClimateArea,
  type ClimateMetric,
  type DashboardSettings,
  type EnergySettings,
  type EntityInfo,
  type TariffSettings,
  type TariffTier,
} from '../../shared/types';
import { EntityPicker } from '../components/EntityPicker';
import { Card, ErrorBox, Loading, PageHeader } from '../components/ui';
import { api } from '../lib/api';
import { effectiveTiers, energyCharge } from '../lib/cost';
import { fmtMoney, fmtNumber } from '../lib/format';
import { useEntityMap, useInfo, useSettings } from '../lib/hooks';

const ENERGY_UNITS = new Set(['kWh', 'Wh', 'MWh']);
const POWER_UNITS = new Set(['W', 'kW', 'MW']);
const isEnergy = (e: EntityInfo) => e.kind === 'numeric' && ENERGY_UNITS.has(e.unit ?? '');
const isPower = (e: EntityInfo) => e.kind === 'numeric' && POWER_UNITS.has(e.unit ?? '');
const isSoc = (e: EntityInfo) => e.kind === 'numeric' && e.unit === '%' && (e.deviceClass === 'battery' || /batt|soc/i.test(e.id));
const isClimate = (e: EntityInfo) => e.kind === 'numeric' && e.id.startsWith('sensor.');

type ListKey = {
  [K in keyof EnergySettings]: EnergySettings[K] extends string[] ? K : never;
}[keyof EnergySettings];

const ENERGY_FIELDS: { key: ListKey; label: string; help: string; suggest: (e: EntityInfo) => boolean }[] = [
  { key: 'solar', label: 'Solar production', help: 'Energy counters (kWh). Several inverters are summed.', suggest: isEnergy },
  { key: 'gridImport', label: 'Grid import', help: 'Energy bought from the grid (kWh).', suggest: isEnergy },
  { key: 'gridExport', label: 'Grid export', help: 'Energy returned to the grid (kWh).', suggest: isEnergy },
  { key: 'batteryCharge', label: 'Battery charge', help: 'Energy into the battery (kWh).', suggest: isEnergy },
  { key: 'batteryDischarge', label: 'Battery discharge', help: 'Energy out of the battery (kWh).', suggest: isEnergy },
  {
    key: 'consumption',
    label: 'Home consumption (optional)',
    help: 'Leave empty to derive it: solar + import − export + discharge − charge.',
    suggest: isEnergy,
  },
];

const POWER_FIELDS: { key: ListKey; label: string; help: string; suggest: (e: EntityInfo) => boolean }[] = [
  { key: 'solarPower', label: 'Solar power', help: 'Current production (W).', suggest: isPower },
  { key: 'gridPower', label: 'Grid power', help: 'Positive while importing (W). Use “invert” if your meter is the other way round.', suggest: isPower },
  { key: 'gridExportPower', label: 'Grid export power (optional)', help: 'Only if export is a separate positive sensor.', suggest: isPower },
  { key: 'batteryPower', label: 'Battery power', help: 'Positive while discharging (W).', suggest: isPower },
  { key: 'batterySoc', label: 'Battery state of charge', help: 'Percent. Several batteries are averaged.', suggest: isSoc },
  { key: 'consumptionPower', label: 'Home power (optional)', help: 'Leave empty to derive it from the flows.', suggest: isPower },
];

function guessMetric(e?: EntityInfo): ClimateMetric {
  const dc = e?.deviceClass ?? '';
  const u = e?.unit ?? '';
  if (dc === 'temperature' || u === '°C' || u === '°F') return 'temperature';
  if (dc === 'humidity') return 'humidity';
  if (dc === 'pm25' || /pm2[._]?5/i.test(e?.id ?? '')) return 'pm25';
  if (dc === 'pm10' || /pm10/i.test(e?.id ?? '')) return 'pm10';
  if (dc === 'carbon_dioxide' || /co2/i.test(e?.id ?? '')) return 'co2';
  if (dc.startsWith('volatile_organic')) return 'voc';
  if (dc.includes('pressure')) return 'pressure';
  if (dc === 'illuminance' || u === 'lx') return 'illuminance';
  if (u === '%') return 'humidity';
  return 'other';
}

export function SettingsPage() {
  const { data: saved, error, isLoading } = useSettings();
  const { data: info } = useInfo();
  const [draft, setDraft] = useState<DashboardSettings | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    if (saved && !draft) setDraft(structuredClone(saved));
  }, [saved, draft]);

  const dirty = useMemo(() => !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);
  const readOnly = info ? !info.allowSettingsEdit : false;

  const save = useMutation({
    mutationFn: (s: DashboardSettings) => api.saveSettings(s),
    onSuccess: (s) => {
      qc.setQueryData(['settings'], s);
      setDraft(structuredClone(s));
      // Everything derived from settings must reload.
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'settings' && q.queryKey[0] !== 'entities' });
    },
  });
  const importHa = useMutation({
    mutationFn: api.haEnergyPrefs,
    onSuccess: (prefs) => setDraft((d) => (d ? { ...d, energy: { ...d.energy, ...prefs } } : d)),
  });

  if (error) return <ErrorBox error={error} />;
  if (isLoading || !draft) return <Loading />;

  const setEnergy = (patch: Partial<EnergySettings>) => setDraft({ ...draft, energy: { ...draft.energy, ...patch } });
  const setClimate = (patch: Partial<DashboardSettings['climate']>) =>
    setDraft({ ...draft, climate: { ...draft.climate, ...patch } });

  return (
    <div className="space-y-4 pb-20">
      <PageHeader title="Settings" />

      <ConnectionStatus />

      {readOnly && (
        <div className="rounded-lg border border-line bg-surface-2 p-3 text-sm">
          Settings are read-only (<code>allow_settings_edit</code> is off in the add-on configuration).
        </div>
      )}

      <fieldset disabled={readOnly} className="space-y-4">
        <Card>
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-medium">Energy meters</h2>
              <p className="text-sm text-muted">Cumulative energy sensors used for daily/monthly totals.</p>
            </div>
            {info?.haConnected && (
              <button className="btn" onClick={() => importHa.mutate()} disabled={importHa.isPending}>
                <Download size={16} /> Import from HA Energy dashboard
              </button>
            )}
          </div>
          {importHa.error && <ErrorBox error={importHa.error} />}
          {importHa.isSuccess && <p className="mb-2 text-sm text-good-text">Imported. Review and save.</p>}
          <div className="grid gap-4 lg:grid-cols-2">
            {ENERGY_FIELDS.map((f) => (
              <Field key={f.key} label={f.label} help={f.help}>
                <EntityPicker value={draft.energy[f.key]} onChange={(v) => setEnergy({ [f.key]: v })} suggest={f.suggest} />
              </Field>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="font-medium">Live power</h2>
          <p className="mb-3 text-sm text-muted">Instantaneous sensors for the live tiles and power curves.</p>
          <div className="grid gap-4 lg:grid-cols-2">
            {POWER_FIELDS.map((f) => (
              <Field key={f.key} label={f.label} help={f.help}>
                <EntityPicker value={draft.energy[f.key]} onChange={(v) => setEnergy({ [f.key]: v })} suggest={f.suggest} />
              </Field>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <label className="flex items-center gap-2 pointer-coarse:min-h-11 pointer-coarse:gap-3">
              <input type="checkbox" checked={draft.energy.invertGridPower} onChange={(e) => setEnergy({ invertGridPower: e.target.checked })} />
              Invert grid power sign
            </label>
            <label className="flex items-center gap-2 pointer-coarse:min-h-11 pointer-coarse:gap-3">
              <input
                type="checkbox"
                checked={draft.energy.invertBatteryPower}
                onChange={(e) => setEnergy({ invertBatteryPower: e.target.checked })}
              />
              Invert battery power sign
            </label>
          </div>
        </Card>

        <Card>
          <h2 className="font-medium">Individual devices</h2>
          <p className="mb-3 text-sm text-muted">Energy counters of single devices for the “usage by device” breakdown.</p>
          <DevicesEditor value={draft.energy.devices} onChange={(devices) => setEnergy({ devices })} />
        </Card>

        <Card>
          <h2 className="font-medium">Prices</h2>
          <p className="mb-3 text-sm text-muted">Optional. Used for cost and savings estimates.</p>
          <PricesEditor value={draft.energy} onChange={setEnergy} />
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Export credit per kWh">
              <input
                type="number"
                inputMode="decimal"
      enterKeyHint="done"
                enterKeyHint="done"
                aria-label="Export credit per kWh"
                step="0.0001"
                min="0"
                className="field w-full"
                value={draft.energy.exportPrice || ''}
                onChange={(e) => setEnergy({ exportPrice: Number(e.target.value) || 0 })}
              />
            </Field>
            <Field label="Currency" help="ISO code (EUR, THB, USD…) or a symbol">
              <input
                className="field w-full"
                aria-label="Currency"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="done"
                maxLength={8}
                value={draft.energy.currency}
                onChange={(e) => setEnergy({ currency: e.target.value.trim() })}
              />
            </Field>
          </div>
        </Card>

        <Card>
          <h2 className="font-medium">Climate</h2>
          <p className="mb-3 text-sm text-muted">
            Temperature, humidity and air-quality sensors are grouped by area. Areas can come from Home Assistant, be added
            manually, or both (manual sensors are merged into an HA area with the same name).
          </p>
          <label className="mb-4 flex items-center gap-2 text-sm pointer-coarse:min-h-11 pointer-coarse:gap-3">
            <input
              type="checkbox"
              checked={draft.climate.autoFromHA}
              disabled={!info?.haConnected}
              onChange={(e) => setClimate({ autoFromHA: e.target.checked })}
            />
            Add areas and sensors automatically from Home Assistant
            {!info?.haConnected && <span className="text-muted">(needs a Home Assistant connection)</span>}
          </label>

          <AreasEditor areas={draft.climate.areas} onChange={(areas) => setClimate({ areas })} />

          {draft.climate.autoFromHA && (
            <div className="mt-4">
              <Field label="Hide sensors" help="Exclude automatically added sensors you don't want to see.">
                <EntityPicker value={draft.climate.exclude} onChange={(exclude) => setClimate({ exclude })} suggest={isClimate} />
              </Field>
            </div>
          )}
        </Card>
      </fieldset>

      {!readOnly && (
        <div className="fixed inset-x-0 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-20 flex justify-center px-4 md:bottom-4 md:left-56">
          <div className="flex w-full max-w-md items-center gap-2 rounded-xl border border-line bg-surface p-2 shadow-lg md:w-auto md:max-w-none">
            <span className="min-w-0 flex-1 truncate px-2 text-sm text-ink-2">
              {save.isPending ? 'Saving…' : dirty ? 'Unsaved changes' : save.isSuccess ? 'Saved' : 'No changes'}
            </span>
            <button className="btn" disabled={!dirty} onClick={() => setDraft(structuredClone(saved!))}>
              <Undo2 size={16} /> Discard
            </button>
            <button className="btn btn-primary" disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)}>
              <Save size={16} /> Save
            </button>
          </div>
        </div>
      )}
      {save.error && <ErrorBox error={save.error} />}
    </div>
  );
}

function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-sm font-medium">{label}</div>
      {children}
      {help && <div className="mt-1 text-xs text-muted">{help}</div>}
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  placeholder,
  step = '0.0001',
  ...rest
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  step?: string;
  min?: string;
  max?: string;
  'aria-label'?: string;
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      step={step}
      min="0"
      className="field w-full"
      placeholder={placeholder}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      {...rest}
    />
  );
}

function PricesEditor({ value, onChange }: { value: EnergySettings; onChange: (patch: Partial<EnergySettings>) => void }) {
  const t = value.tariff;
  const setTariff = (patch: Partial<TariffSettings>) => onChange({ tariff: { ...t, ...patch } });
  const tiers = t.tiers.length ? t.tiers : [{ upTo: null, rate: value.importPrice }];
  const setTiers = (next: TariffTier[]) => setTariff({ tiers: next });
  const addTier = () => {
    const last = tiers[tiers.length - 1];
    const from = tiers.length > 1 ? (tiers[tiers.length - 2].upTo ?? 0) : 0;
    setTiers([...tiers.slice(0, -1), { ...last, upTo: from + 100 }, { upTo: null, rate: last.rate }]);
  };
  const removeTier = (i: number) => {
    const next = tiers.filter((_, j) => j !== i);
    if (next.length) next[next.length - 1] = { ...next[next.length - 1], upTo: null };
    setTiers(next);
  };
  const example = 300;
  const cur = value.currency;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <label className="flex items-center gap-2 pointer-coarse:min-h-11 pointer-coarse:gap-3">
          <input type="radio" name="tariff" checked={!t.progressive} onChange={() => setTariff({ progressive: false })} />
          Flat rate
        </label>
        <label className="flex items-center gap-2 pointer-coarse:min-h-11 pointer-coarse:gap-3">
          <input
            type="radio"
            name="tariff"
            checked={t.progressive}
            onChange={() => setTariff({ progressive: true, tiers })}
          />
          Progressive (tiered by monthly usage)
        </label>
      </div>

      {!t.progressive ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Import price per kWh">
            <NumberInput value={value.importPrice || null} onChange={(v) => onChange({ importPrice: v ?? 0 })} />
          </Field>
        </div>
      ) : (
        <div>
          <div className="mb-1 text-sm font-medium">Tiers</div>
          <p className="mb-2 text-xs text-muted">
            Each kWh imported in a billing cycle is charged at the rate of the tier it falls into.
          </p>
          <div className="space-y-2">
            <div className="hidden grid-cols-[10rem_10rem_10rem_auto] gap-2 text-xs text-muted sm:grid">
              <span />
              <span>Up to (kWh per cycle)</span>
              <span>Rate per kWh</span>
            </div>
            {tiers.map((tier, i) => {
              const from = i === 0 ? 0 : (tiers[i - 1].upTo ?? 0);
              const last = i === tiers.length - 1;
              return (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_1fr_auto] items-center justify-items-start gap-2 sm:grid-cols-[10rem_10rem_10rem_auto]"
                >
                  <span className="col-span-3 text-sm text-ink-2 tnum sm:col-span-1">
                    Tier {i + 1}: from {fmtNumber(from, 0)} kWh
                  </span>
                  {last ? (
                    <span className="text-sm text-muted">and above</span>
                  ) : (
                    <NumberInput
                      aria-label={`Tier ${i + 1} up to kWh`}
                      step="1"
                      placeholder="up to kWh"
                      value={tier.upTo}
                      onChange={(v) => setTiers(tiers.map((x, j) => (j === i ? { ...x, upTo: v } : x)))}
                    />
                  )}
                  <NumberInput
                    aria-label={`Tier ${i + 1} rate per kWh`}
                    placeholder="rate per kWh"
                    value={tier.rate}
                    onChange={(v) => setTiers(tiers.map((x, j) => (j === i ? { ...x, rate: v ?? 0 } : x)))}
                  />
                  <button
                    className="btn px-2"
                    aria-label={`Remove tier ${i + 1}`}
                    disabled={tiers.length === 1}
                    onClick={() => removeTier(i)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              );
            })}
          </div>
          <button className="btn mt-2" onClick={addTier}>
            <Plus size={16} /> Add tier
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field label="Extra per kWh" help="Added to every kWh, e.g. fuel adjustment (Ft)">
          <NumberInput value={t.adder || null} onChange={(v) => setTariff({ adder: v ?? 0 })} />
        </Field>
        <Field label="Fixed charge per cycle" help="Service fee per billing cycle">
          <NumberInput value={t.fixedCharge || null} onChange={(v) => setTariff({ fixedCharge: v ?? 0 })} />
        </Field>
        <Field label="Tax / VAT %" help="Applied to import charges">
          <NumberInput step="0.1" max="100" value={t.vat || null} onChange={(v) => setTariff({ vat: v ?? 0 })} />
        </Field>
        <Field label="Billing cycle starts on day" help="Day of the month, 1–28">
          <NumberInput
            step="1"
            min="1"
            max="28"
            value={t.billingDay}
            onChange={(v) => setTariff({ billingDay: Math.min(28, Math.max(1, Math.round(v ?? 1))) })}
          />
        </Field>
      </div>

      <p className="text-sm text-ink-2">
        Example: {example} kWh imported in one cycle costs{' '}
        <b className="tnum">
          {fmtMoney((energyCharge(example, effectiveTiers(value), t.adder) + t.fixedCharge) * (1 + t.vat / 100), cur)}
        </b>
        .
      </p>
    </div>
  );
}

function DevicesEditor({
  value,
  onChange,
}: {
  value: EnergySettings['devices'];
  onChange: (v: EnergySettings['devices']) => void;
}) {
  const names = useEntityMap();
  return (
    <div className="space-y-2">
      {value.map((d, i) => (
        <div key={d.entity} className="flex flex-wrap items-center gap-2">
          <input
            className="field min-w-0 flex-1"
            aria-label="Display name"
            autoCapitalize="words"
            enterKeyHint="done"
            placeholder={names.get(d.entity)?.name ?? d.entity}
            value={d.name ?? ''}
            onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, name: e.target.value || undefined } : x)))}
          />
          <code className="min-w-0 flex-1 truncate text-xs text-muted">{d.entity}</code>
          <button className="btn px-2" aria-label="Remove device" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      <EntityPicker
        value={[]}
        onChange={(ids) => {
          const add = ids.filter((id) => !value.some((d) => d.entity === id));
          if (add.length) onChange([...value, ...add.map((entity) => ({ entity }))]);
        }}
        suggest={isEnergy}
        placeholder="Add a device energy sensor…"
      />
    </div>
  );
}

function AreasEditor({ areas, onChange }: { areas: ClimateArea[]; onChange: (a: ClimateArea[]) => void }) {
  const byId = useEntityMap();
  const update = (i: number, patch: Partial<ClimateArea>) => onChange(areas.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  return (
    <div className="space-y-3">
      {areas.map((a, i) => (
        <div key={a.id} className="rounded-lg border border-line p-3">
          <div className="mb-2 flex items-center gap-2">
            <input
              className="field min-w-0 flex-1 font-medium"
              value={a.name}
              aria-label="Area name"
              autoCapitalize="words"
              enterKeyHint="done"
              onChange={(e) => update(i, { name: e.target.value })}
            />
            <button className="btn px-2" aria-label="Remove area" onClick={() => onChange(areas.filter((_, j) => j !== i))}>
              <Trash2 size={16} />
            </button>
          </div>
          <div className="space-y-2">
            {a.sensors.map((s, k) => (
              <div key={s.entity} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate" title={s.entity}>
                  {byId.get(s.entity)?.name ?? s.entity}
                </span>
                <select
                  className="field"
                  value={s.metric}
                  aria-label="Metric"
                  onChange={(e) =>
                    update(i, {
                      sensors: a.sensors.map((x, j) => (j === k ? { ...x, metric: e.target.value as ClimateMetric } : x)),
                    })
                  }
                >
                  {CLIMATE_METRICS.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <button
                  className="btn px-2"
                  aria-label="Remove sensor"
                  onClick={() => update(i, { sensors: a.sensors.filter((_, j) => j !== k) })}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <EntityPicker
              value={[]}
              suggest={isClimate}
              placeholder="Add a sensor to this area…"
              onChange={(ids) => {
                const add = ids.filter((id) => !a.sensors.some((s) => s.entity === id));
                if (add.length)
                  update(i, { sensors: [...a.sensors, ...add.map((entity) => ({ entity, metric: guessMetric(byId.get(entity)) }))] });
              }}
            />
          </div>
        </div>
      ))}
      <button
        className="btn"
        onClick={() => onChange([...areas, { id: `area_${Date.now().toString(36)}`, name: `Area ${areas.length + 1}`, sensors: [] }])}
      >
        <Plus size={16} /> Add area
      </button>
    </div>
  );
}

function ConnectionStatus() {
  const { data: info } = useQuery({ queryKey: ['info'], queryFn: api.info });
  if (!info) return null;
  const Item = ({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) => (
    <div className="flex items-start gap-2 text-sm">
      {ok ? (
        <CircleCheck size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--good)' }} />
      ) : (
        <TriangleAlert size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--warning)' }} />
      )}
      <div>
        <div>{label}</div>
        {detail && <div className="text-xs text-muted">{detail}</div>}
      </div>
    </div>
  );
  return (
    <Card>
      <h2 className="mb-2 font-medium">Connections</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <Item
          ok={info.influxOk}
          label={info.influxOk ? 'InfluxDB connected' : 'InfluxDB not reachable'}
          detail={info.influxOk ? info.influxBackend : info.influxError}
        />
        <Item
          ok={info.haConnected}
          label={info.haConnected ? 'Home Assistant connected' : 'Home Assistant not connected'}
          detail={info.haConnected ? undefined : 'Needed for areas and importing energy settings'}
        />
        <Item ok label={`Version ${info.version}`} detail={info.mode === 'addon' ? 'Running as add-on' : 'Running standalone'} />
      </div>
    </Card>
  );
}
