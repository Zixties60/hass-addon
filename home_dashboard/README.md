# Home Dashboard

A **read-only** web dashboard for Home Assistant data stored in **InfluxDB**. It supports
1.x (including the official [InfluxDB add-on](https://github.com/hassio-addons/app-influxdb),
the default connection) and 2.x, and detects the version automatically. It shows
energy usage, solar production, climate per area, and the history of any entity.
It runs as a Home Assistant add-on (sidebar panel, Home Assistant login) or as a standalone
container for Home Assistant Container / Core installs.

| Page | What it shows |
|---|---|
| **Overview** | Live solar / home / grid / battery power, today's totals, today's power curve, climate snapshot |
| **Energy** | Day / week / month / year: consumption split by source (solar, battery, grid) and surplus, energy-flow diagram, usage by device, self-sufficiency, net cost |
| **Solar** | Production per period (per inverter when several), power curve, self-consumption, peak power, estimated value |
| **Climate** | Cards per area (temperature, humidity, PM2.5, PM10, CO₂, VOC…) with comfort status, 24 h sparkline, and an area comparison chart over any time range |
| **History** | Pick up to 8 entities and any time range; numeric sensors are charted per unit, on/off and text states as a timeline; CSV export |
| **Settings** | Choose the entities for each energy category (several are summed), live power sensors, devices, prices, climate areas |

Nothing in the dashboard controls Home Assistant. It only reads InfluxDB and, optionally, the
Home Assistant API (entity names, areas and Energy-dashboard preferences).

## Tech stack

- **Server:** Node.js 22 + [Hono](https://hono.dev). It queries InfluxDB with InfluxQL (1.x) or
  Flux (2.x). Data is aggregated in the database, in your time zone, so the browser only receives
  a few hundred points per chart.
- **Web:** React 19, Vite, TypeScript, Tailwind CSS 4, Apache ECharts, TanStack Query.
- **Packaging:** one Docker image, installable as a Home Assistant App (add-on) with Ingress
  or run standalone.

## Install as a Home Assistant App (add-on)

For **Home Assistant OS** and **Supervised** installations. Recent Home Assistant versions call
add-ons **Apps**; older versions use **Add-ons**. The steps are the same.

**Before you start:** Home Assistant must already write to InfluxDB through the
[InfluxDB integration](https://www.home-assistant.io/integrations/influxdb/), for example
into the official [InfluxDB app](https://github.com/hassio-addons/app-influxdb).

### 1. Add this repository

Click the button to add the repository to your Home Assistant instance:

[![Add repository to my Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2FZixties60%2Fhome-dashboard)

Or add it manually:

1. Go to **Settings → Apps** (or **Settings → Add-ons**) → **App store** (or **Add-on store**).
2. Open the **⋮** menu (top right) → **Repositories**.
3. Paste `https://github.com/Zixties60/home-dashboard`, click **Add**, then **Close**.
4. Reload the page if **Home Dashboard** doesn't show up in the store.

### 2. Install

Open **Home Dashboard** in the store and click **Install**. Home Assistant builds the image on
your device, which can take several minutes on a Raspberry Pi.

### 3. Configure

Open the **Configuration** tab.

**Using the official InfluxDB app (default).** The URL and database are already filled in.
You only need a user with read access:

1. Open the InfluxDB app's web UI → **InfluxDB Admin** → **Users** → **Create User**.
2. Give it **READ** permission on the `homeassistant` database.
   (Reusing the user Home Assistant writes with also works.)
3. Enter that user in Home Dashboard's configuration:

```yaml
influx_version: auto
influx_url: http://a0d7b954-influxdb:8086
influx_database: homeassistant
influx_username: dashboard
influx_password: your-password
```

**Using InfluxDB 2.x.** Create a read-only API token for the bucket in the InfluxDB UI
(**Load Data → API Tokens**), then set:

```yaml
influx_version: auto
influx_url: http://192.168.1.10:8086
influx_token: your-read-only-token
influx_org: homeassistant
influx_bucket: homeassistant
```

Click **Save**.

### 4. Start and add it to the sidebar

1. On the **Info** tab, turn on **Show in sidebar** (and **Start on boot**), then click **Start**.
2. Check the **Log** tab. You should see `Detected InfluxDB …` with no errors.
3. Click **Home Dashboard** in the sidebar, or **Open web UI**. It opens inside Home Assistant,
   including the mobile app, and uses your Home Assistant login.

On first start, the dashboard imports your **Energy dashboard** configuration from Home Assistant
(solar, grid, battery and device sensors). You can review or change it on the dashboard's
**Settings** page. **Settings → Connections** shows the detected InfluxDB version and whether
Home Assistant is connected.

### Updating

When a new version is published, the app shows an **Update** button on its page. Your dashboard
settings are kept in the app's data folder, so they survive updates.

### Troubleshooting

| Symptom | Fix |
|---|---|
| *InfluxDB: authorization failed* | Wrong `influx_username` / `influx_password` (1.x) or token (2.x). |
| *requires READ on homeassistant* / *database not found* | Grant the user READ on the database, or fix `influx_database`. |
| *InfluxDB not reachable* | Check `influx_url`. For the official app, it must be running. Use `http://` unless you set up TLS on the API. |
| Entity pickers are empty | No data in the last `entity_lookback_days` days. Check that the InfluxDB integration is writing. |
| Climate page has no areas | Assign your sensors (or their devices) to areas in Home Assistant, or add areas manually in **Settings**. |

## Install with Docker (Home Assistant Container / Core)

Apps (add-ons) need the Supervisor, which Container and Core installations don't have. Run the
same image standalone instead:

1. In this folder, edit `docker-compose.yml`: the InfluxDB URL and credentials (1.x user/password or 2.x token),
   and optionally `HA_URL` + `HA_TOKEN`
   (a long-lived access token from your HA profile). The token enables the climate areas and
   the Energy-dashboard import.
2. `docker compose up -d --build`, then open `http://<host>:8099`.
3. To show it in the Home Assistant sidebar: **Settings → Dashboards → Add dashboard → Webpage**
   and enter the URL. If Home Assistant is served over HTTPS, the dashboard must be too (put
   it behind the same reverse proxy), otherwise the browser blocks the embedded page.

The standalone container has **no login of its own**. Keep it on your LAN or behind a
reverse proxy with authentication. Set `ALLOW_SETTINGS_EDIT=false` once it's configured.

### Environment variables

| Variable | Default | |
|---|---|---|
| `INFLUX_URL` | `http://a0d7b954-influxdb:8086` | InfluxDB address (default: the official add-on) |
| `INFLUX_VERSION` | `auto` | `auto`, `1` or `2`. `auto` reads the version from `/ping` |
| `INFLUX_DATABASE` | `homeassistant` | 1.x database |
| `INFLUX_USERNAME`, `INFLUX_PASSWORD` | – | 1.x credentials (read access is enough) |
| `INFLUX_TOKEN` | – | 2.x API token (read access is enough) |
| `INFLUX_ORG` | `homeassistant` | 2.x organization |
| `INFLUX_BUCKET` | `homeassistant` | 2.x bucket |
| `HA_URL`, `HA_TOKEN` | – | Optional Home Assistant API access |
| `ALLOW_SETTINGS_EDIT` | `true` | Lock the settings page when `false` |
| `ENTITY_LOOKBACK_DAYS` | `30` | Entities seen in this window appear in pickers |
| `DATA_DIR` | `/data` | Where `dashboard-settings.json` is stored |
| `PORT` | `8099` | |

## How the data is read

Home Assistant's InfluxDB integration writes one point per state change, with the tags
`domain` and `entity_id` (object id), and the fields `value` (numeric state), `state` (text
state) and the attributes. The dashboard filters on those tags and fields, so it works however
your measurements are named.

- **Energy totals** come from cumulative counters (kWh / Wh). The dashboard takes the difference
  between consecutive readings, so counters that reset (e.g. an inverter's "daily yield") also work.
  On 1.x it uses hourly readings (3-hourly for the year view) and adds them up into days and months.
  Wh and MWh are converted when the measurement is named after the unit (the integration's default).
- **Consumption** is measured if you pick a sensor, otherwise derived as
  `solar + import − export + battery discharge − battery charge`.
- **Power curves** are window averages. Gaps repeat the last value, because HA writes only on change.
- **Attributes** can be charted by typing `domain.object_id:attribute` in an entity picker,
  e.g. `climate.living_room:current_temperature`.
- If InfluxDB has no time-zone database (some Alpine images), day and month buckets fall back to
  your current UTC offset.

## Development

```bash
cd home_dashboard
npm install
# terminal 1: API on :8099 (point it at your InfluxDB)
INFLUX_URL=http://localhost:8086 INFLUX_USERNAME=... INFLUX_PASSWORD=... DATA_DIR=./.data npm run dev:server
# (2.x: INFLUX_TOKEN=... instead of username/password)
# terminal 2: UI with hot reload on :5173 (proxies /api to :8099)
npm run dev:web
```

`npm run build` type-checks and builds the UI (`dist/web`) and the server (`dist/server.js`).

## Project layout

```
home_dashboard/            the add-on (Docker build context)
  config.yaml, Dockerfile  add-on manifest and image
  DOCS.md                  documentation shown in Home Assistant
  CHANGELOG.md             release notes shown when an update is available
  icon.png, logo.png       images for the app store
  docker-compose.yml       standalone deployment
  server/                  API: config, InfluxDB 1.x/2.x backends, HA client, settings store
  shared/types.ts          types shared by server and UI
  src/                     React UI (pages/, components/, lib/)
```
