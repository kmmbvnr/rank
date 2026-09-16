# Rank website and console

`npm run dev --workspace @arrrank/web` starts the website. `/console.html`
opens the full-screen console. The landing page embeds that same page in a
narrow iframe; `?example=fibonacci` starts an editable example, evaluated by
the real interpreter. Its local draft is separate from the main notebook.

The console uses `NotebookRepl`, keyboard routing and screen frames from
`@arrrank/common`, also used by the CLI. The browser adapter supplies DOM
rendering, native text input and a worker-backed session. Do not add a second
editor or evaluator for website demos.

`npm run build --workspace @arrrank/web` builds the website and console.
`npm run build --workspace @arrrank/mobile` uses Vite's `mobile` mode to make
the same console the native app's `index.html`, then syncs Capacitor. The
landing page and its SPCSS stylesheet are not loaded by the mobile app.
Website output is in `dist`; native output is in `dist-mobile`, so building
the app does not overwrite the website.

Website text comes from `docs/index.md` (Rank Wiki) and the root README.
SPCSS is bundled locally; no stylesheet CDN or remote font is needed.
