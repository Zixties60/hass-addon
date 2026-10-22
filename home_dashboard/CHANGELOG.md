# Changelog

## 0.2.3

- Inside the Home Assistant app the dashboard no longer adds its own notch and home-indicator
  padding on top of Home Assistant's, which left empty bands above the header and below the
  bottom navigation.
- Mobile header shows the logo and "Home Dashboard" with the current page underneath, and is
  more compact.

## 0.2.2

- Mobile: larger text, more spacing, and touch targets of at least 44 px for buttons, inputs,
  menus, period controls and the bottom navigation.
- Text inputs use a 16 px font on touch screens, so iOS no longer zooms in when one gets focus.
- The time range picker opens as a bottom sheet on phones.
- Swipe the mobile menu to the left to close it.
- Charts: one-finger drags scroll the page instead of panning the chart (pinch still zooms),
  tooltips stay inside the chart, and legend items are spaced out for tapping.
- The mobile menu and the time range sheet lock the page behind them, close with Escape, move
  focus inside when they open and return it when they close. Swipe the sheet down to close it.
- The bottom navigation highlights the active page with a pill behind its icon.
- Settings inputs show the right keyboard and don't autocorrect codes or entity names.
- Secondary text is darker in the light theme so it meets WCAG AA contrast.
- Every control shows a focus ring for keyboard use, and charts don't animate when the system
  asks for reduced motion.
- Content respects the notch in landscape, opening a page scrolls to the top, and table views
  keep the first column visible when scrolled sideways.
- The browser toolbar colour follows the light/dark theme, including the in-app toggle.
- Phones: the hero "now" figures on Overview fit their tile, and the device and timeline charts
  leave more room for bars by narrowing their side labels.

## 0.2.1

- Mobile: the bottom navigation is now a floating bar with Overview, Energy, Solar and Climate.
- New sidebar group with History, Settings and a Home Assistant item that opens Home
  Assistant's sidebar. On mobile the sidebar opens from the menu button in the header.
- The dashboard always opens full screen inside Home Assistant; the full-screen button is removed.

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
