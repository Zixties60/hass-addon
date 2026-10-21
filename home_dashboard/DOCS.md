# Home Dashboard

Read-only dashboards for energy, solar, climate and entity history, built from the data
Home Assistant writes to **InfluxDB 1.x or 2.x**.

## Configuration

The defaults connect to the official **InfluxDB** add-on (Home Assistant Community Apps),
so usually you only need a username and password.

| Option | Description |
|---|---|
| `influx_version` | `auto` (detect), `1` or `2` |
| `influx_url` | InfluxDB address. Official add-on: `http://a0d7b954-influxdb:8086` |
| `influx_database` | **1.x:** the database Home Assistant writes to (default `homeassistant`) |
| `influx_username` / `influx_password` | **1.x:** a user with read access to the database |
| `influx_token` | **2.x:** API token. A read-only token for the bucket is recommended. |
| `influx_org` / `influx_bucket` | **2.x:** organization and bucket |
| `allow_settings_edit` | Turn off to lock the dashboard's entity selection |
| `entity_lookback_days` | Entities that reported within this period appear in the pickers |

### Creating a read-only user in the InfluxDB add-on

Open the InfluxDB add-on's web UI → **InfluxDB Admin** → **Users** → *Create User*. Then
grant it **READ** on the `homeassistant` database, and enter its name and password here.

After starting, open the panel from the sidebar. **Settings → Connections** shows the detected
InfluxDB version. The first start imports your Energy dashboard setup; you can change it under
**Settings**.

## Full screen

Inside Home Assistant, the dashboard opens full screen: Home Assistant's sidebar and header are
hidden while the panel is open. Use the **menu** button (top left) to open the Home Assistant
sidebar, or the **full-screen** button next to the theme switch to return to the normal layout.
The choice is remembered per browser. Home Assistant restores its sidebar when you leave the
panel. This needs a recent Home Assistant version; on older versions the buttons don't appear
and the panel opens as usual.

## Electricity prices

Under **Settings → Prices**, pick one of two tariffs:

- **Flat rate:** one price per imported kWh.
- **Progressive:** tiers by the kWh imported from the grid within the billing cycle. For example,
  0–150 kWh at 3.2484, 150–400 kWh at 4.2218, and above 400 kWh at 4.4217. Each kWh is charged at
  the rate of the tier it falls into. Costs for a day or week include the kWh already used earlier
  in the same cycle.

Both tariffs support these extra settings:

- An **extra charge per kWh**, such as a fuel adjustment (Ft).
- A **fixed charge per billing cycle**, spread evenly over the days of the cycle.
- **VAT**, which applies to import charges.
- The **day of the month the billing cycle starts**.
- An **export credit per kWh**, a flat rate that is deducted from the cost.

The **Billing** period on the Energy and Solar pages shows exactly one billing cycle.

For any period, the **Cost comparison** card shows three figures:

- **Without solar:** what the grid bill would have been if all consumption had come from the grid.
  On a progressive tariff this also means reaching the higher tiers sooner.
- **With solar:** the actual bill, after the export credit.
- **Saved:** the difference between the two.

## Climate areas

With *Add areas automatically* on, every sensor with a temperature, humidity, PM2.5, PM10,
CO₂, VOC, pressure or illuminance device class that is assigned to an area (directly or through
its device) appears on the Climate page. Areas you add manually are merged with Home Assistant
areas of the same name. Use *Hide sensors* to drop sensors you don't want.

## Network

Ingress is used by default, so access requires your Home Assistant login. The optional
port 8099 gives direct access **without authentication**. Only enable it on a trusted network.
