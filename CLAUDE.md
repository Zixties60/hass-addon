# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

This is a Home Assistant add-on repository (`repository.yaml` at the root, one folder per add-on slug). Currently there is one add-on: `home_dashboard/`, a read-only dashboard over Home Assistant data stored in InfluxDB (1.x or 2.x). A new add-on goes in its own folder with `config.yaml`, `Dockerfile`, `README.md`, `DOCS.md`, `CHANGELOG.md`, `icon.png` (128×128), `logo.png` (250×100) and `translations/en.yaml`, plus a row in the root `README.md` table.

CI (`.github/workflows/lint.yaml`) finds every `*/config.yaml` and runs `frenck/action-addon-linter` on that folder. Bump `version` in `config.yaml` and add a `CHANGELOG.md` entry for any user-facing change, because Home Assistant uses the version to offer updates.

## Commands (run inside `home_dashboard/`)

- `npm run dev`: API server (`tsx watch`, port 8099) and Vite dev server together. Vite proxies `/api` to `:8099`.
- `npm run typecheck`: `tsc --noEmit`. This is the only automated check; there is no test suite or JS linter.
- `npm run build`: type-check, then build the SPA into `dist/web` and bundle the server with esbuild into `dist/server.js`.
- `npm start`: run the built server.
- `docker compose up --build`: standalone (HA Container/Core) mode, configured through environment variables.

Outside the add-on, configuration comes from environment variables that override `/data/options.json`: `INFLUX_URL`, `INFLUX_VERSION` (`auto|1|2`), `INFLUX_DATABASE`, `INFLUX_USERNAME`, `INFLUX_PASSWORD`, `INFLUX_TOKEN`, `INFLUX_ORG`, `INFLUX_BUCKET`, `HA_URL`, `HA_TOKEN`, `ALLOW_SETTINGS_EDIT`, `DATA_DIR`, `PORT`, `TZ`.

## Architecture

**One Node process** (Hono) serves both the JSON API under `/api/*` and the built SPA. `shared/types.ts` holds the API contract, imported by both `server/` and `src/`.

**Runtime modes** (`server/config.ts`): when `SUPERVISOR_TOKEN` is set it runs in add-on mode. It reads `/data/options.json` and talks to HA through `http://supervisor/core/api` and `ws://supervisor/core/websocket`. Otherwise it runs standalone with `HA_URL`/`HA_TOKEN`. HA access is optional; without it, area auto-discovery, energy-prefs import and the HA time zone are unavailable. The UI runs under HA ingress at a path prefix, so Vite uses `base: './'` and the client uses relative `api/...` URLs plus a hash router (`#/page?params`). Never use absolute paths.

**Time-series backends.** The `TsBackend` interface is in `server/influx.ts`, with two implementations:
- `Influx2` (same file): Flux queries.
- `Influx1` (`server/influx1.ts`): InfluxQL over `POST /query`, with resampling, forward-fill and energy roll-ups done in JavaScript.

`AutoBackend` (`server/backend.ts`) picks one using the `X-Influxdb-Version` header from `/ping`. Any query feature must be implemented in both backends and behave the same. The default connection is the official InfluxDB add-on (`http://a0d7b954-influxdb:8086`, which is 1.x).

**HA InfluxDB schema assumptions:**
- The measurement is the unit, or `domain.object_id` when the entity has no unit.
- Tags are `domain`, `entity_id` (the object id only) and `friendly_name`.
- Fields are `value` (numeric), `state` (text) and attributes.

Entities are referenced as `domain.object_id`, or `domain.object_id:attribute` for an attribute (`parseRef`/`refKey`).

User input reaches queries only after it passes the validators in `influx.ts` (`parseRef`, `checkDuration`, `checkTz`, `checkTime`). Keep it that way, since queries are built as strings.

**Time zones.** Day and month buckets must align to the HA time zone. If InfluxDB lacks tzdata (for example Windows `influxd`), both backends fall back to a fixed UTC offset (`tzOffsetMinutes`).

**Energy from cumulative counters:**
- Flux uses `difference(nonNegative: true)` and then sums per window.
- InfluxQL takes the last value per sub-window (1h for day buckets, 3h for month buckets) and differences those values. A drop below half the previous value counts as a meter reset. The results are then rolled up into day or month keys with `Intl`.
- Wh values are scaled to kWh (`scaleValue`).
- `server/services.ts` derives home consumption, and `src/lib/energy.ts` (`allocate`) splits the energy flows the same way HA's Energy dashboard does.

**Pricing** (`src/lib/cost.ts`) is calculated in the browser:
- `useCost` fetches daily energy totals starting from the beginning of the billing cycle that contains the period start, because tier usage before the period affects its cost.
- `computeCost` then applies the tiers to cumulative import per cycle and spreads the fixed charge evenly over the cycle's days.
- `withoutSolar` prices the same days as if the self-consumed solar had also been imported, so the higher tiers are reached sooner. `saved` = `withoutSolar` − net bill, and the Solar page's "estimated value" uses it.
- The `cycle` period kind (`src/lib/time.ts`) depends on `Period.billingDay`, which `usePeriod` fills in from the tariff settings.

**Inside Home Assistant** (`src/lib/haFrame.ts`), the app uses the postMessage protocol of HA's app panel (`ha-panel-app`):
- `home-assistant/subscribe-properties` with `kioskMode` hides HA's sidebar and header (full screen).
- `home-assistant/toggle-menu` opens HA's sidebar.
- The full-screen buttons appear only after HA replies with `home-assistant/properties`.

**Settings.** Energy categories (several entities summed per category) and climate areas are stored in `DATA_DIR/dashboard-settings.json` (`server/settings.ts`, `normalizeSettings`). On first start they are seeded from HA's `energy/get_prefs`. Writes are rejected when `allow_settings_edit` is false. Climate areas can also be resolved automatically from the HA area, device and entity registries by device class (`ha.areaSensors`).

**Frontend.** The stack is React 19, TanStack Query, ECharts (tree-shaken registration in `src/components/Chart.tsx`) and Tailwind 4. Colours are CSS tokens in `src/styles.css`:
- Categorical slots `--s1`…`--s8`, with separate light and dark values.
- Status colours, which are reserved for status and never used for series.

`useSlots` (`src/lib/slots.ts`) gives each entity a stable colour slot, so its colour doesn't change when other entities are added or removed. Charts are built from the `baseOption` / `timeAxis` / `valueAxis` / `lineSeries` / `barSeries` helpers. They use a single y-axis (one chart per unit, never two y-axes) and offer a table view through `ChartCard`.
