# Rank mobile

The Android and iOS projects embed the shared console from `@arrrank/web`.
The mobile build uses Vite's `mobile` mode, which opens the console directly
without the website landing page. It writes `packages/web/dist-mobile` before
synchronizing the native projects:

```sh
npm run build --workspace @arrrank/mobile
```

Native Rank capabilities belong in Capacitor plugins under this package.
The notebook, key routing, execution controller and live previews live in
`@arrrank/common`; both CLI and web use these implementations. The web shell
renders the exact `notebookFrame` used by the terminal, including its ANSI
status colors, gutters, cursor and footer. There is no separate input bar.
A native textarea at the terminal cursor handles the phone keyboard and IME.
Evaluation runs in a Web Worker using the same REPL session as the CLI.

Tap source to place the cursor. Enter, arrows, Tab, Ctrl-R, Ctrl-L and Ctrl-G
go through the CLI key router. One ⋮ button at the top exposes these commands
for phone keyboards without Ctrl or arrow keys. Drag vertically to scroll.
Function arguments and intermediate results appear in the CLI layout.
Android hides system bars; an edge swipe temporarily reveals them.

Source and unfinished drafts are kept locally. Reloading restores pending
source, not runtime values. Stopping terminates the browser worker, so Ctrl-L is
required before executing again. The CLI debugger's pause/breakpoint transport
and native file/stdin operations are not exposed by this mobile shell.
