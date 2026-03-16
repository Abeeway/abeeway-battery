# Abeeway Battery Life-Time Calculator

This repository contains a small browser-based calculator for estimating the battery life of several Abeeway tracker products under different usage patterns.

The app is made of:

- `abeeway_battery.html`: the user interface
- `abeeway_battery.js`: the battery-life calculation logic
- `test.js`: a simple Node-based script for exercising the calculation module

## Run locally

For quick local use, open `abeeway_battery.html` directly in a browser.

If you prefer serving it over HTTP locally from a Node.js-based workflow, run a static server from the repository root, for example:

```powershell
npx serve .
```

Then open:

```text
http://localhost:3000/abeeway_battery.html
```

## Test the calculation logic

To run the included Node-based test script:

```powershell
node test.js
```

This prints a sample battery-life calculation to the terminal.

## GitHub Pages publishing

This repository is configured to deploy to GitHub Pages automatically when changes are pushed to the `main` branch.

The workflow:

- takes `abeeway_battery.html`
- publishes it as `index.html`
- includes `abeeway_battery.js`

GitHub Pages must be configured in the repository settings to use `GitHub Actions` as the source.

After deployment, the site is expected at:

```text
https://norbertherbert.github.io/abeeway-battery/
```

## Notes

- The calculator output is an estimation and may differ from field results.
- The inputs should represent typical average usage, not worst-case behavior.
