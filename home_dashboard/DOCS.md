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

## Climate areas

With *Add areas automatically* on, every sensor with a temperature, humidity, PM2.5, PM10,
CO₂, VOC, pressure or illuminance device class that is assigned to an area (directly or through
its device) appears on the Climate page. Areas you add manually are merged with Home Assistant
areas of the same name. Use *Hide sensors* to drop sensors you don't want.

## Network

Ingress is used by default, so access requires your Home Assistant login. The optional
port 8099 gives direct access **without authentication**. Only enable it on a trusted network.
