# Changelog

## 0.2.0

- Progressive (tiered) electricity pricing: rates by grid import within the billing cycle, a
  configurable billing-cycle start day, an extra charge per kWh, a fixed charge per cycle and VAT.
- The Energy page shows the current billing cycle (kWh so far and the current tier).
- Solar "estimated value" takes the tiers into account.
- "Billing" period on the Energy and Solar pages: one billing cycle, starting on the configured day.
- Cost comparison for the selected period: the bill without solar, with solar, and the amount
  saved, with per-day or per-month bars.
- Full screen inside Home Assistant: the dashboard hides Home Assistant's sidebar and header.
  The menu button opens the sidebar, and the full-screen toggle restores the normal layout.

## 0.1.0

- First release.
- Overview, Energy, Solar, Climate, History and Settings pages.
- InfluxDB 1.x (InfluxQL; the official InfluxDB app is the default connection) and 2.x (Flux),
  with automatic version detection.
- Imports the energy setup from Home Assistant's Energy dashboard on first start.
- Climate areas from Home Assistant's area registry, plus manual areas.
