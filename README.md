# Zixties60 Home Assistant Apps

A repository of Home Assistant **Apps** (add-ons) for Home Assistant OS and Supervised installs.

[![Add repository to my Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2FZixties60%2Fhass-addon)

## Apps

| App | Description |
|---|---|
| [Home Dashboard](home_dashboard/) | Read-only dashboards for energy, solar, climate and entity history from InfluxDB 1.x / 2.x |

## Installation

1. Click the button above, or go to **Settings → Apps** (or **Add-ons**) → **App store** →
   **⋮** → **Repositories**, and add `https://github.com/Zixties60/hass-addon`.
2. Find the app in the store, click **Install**, then follow its documentation.

Each app's folder has its own README. Its **Documentation** tab in Home Assistant shows `DOCS.md`.

## Adding a new app

Each app lives in its own top-level folder, named after its `slug`:

```
repository.yaml          repository manifest (name, url, maintainer)
<slug>/
  config.yaml            app manifest: name, version, slug, arch, options/schema, ingress…
  Dockerfile             image, built by the Supervisor on the user's device
  README.md              shown on the app's store page
  DOCS.md                shown in the app's Documentation tab
  CHANGELOG.md           shown when an update is available
  icon.png               128×128 store icon
  logo.png               store logo (about 250×100)
  translations/en.yaml   labels and descriptions for the options
```

1. Copy an existing app folder, or create the files above, with a unique `slug`.
2. Add it to the **Apps** table in this README.
3. To ship an update, raise `version` in its `config.yaml` and add a `CHANGELOG.md` entry.
   Home Assistant offers the update once the change is pushed.

Pull requests run the [app linter](.github/workflows/lint.yaml) on every app folder.

## License

MIT
