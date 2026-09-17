# Rank mobile

The Android and iOS projects embed the shared console from `@arrrank/web`.
The mobile build uses Vite's `mobile` mode, which opens the console directly
without the website landing page. It writes `packages/web/dist-mobile` before
synchronizing the native projects:

```sh
npm run build --workspace @arrrank/mobile
```

To regenerate the Android launcher icons at all densities after changing their
artwork, run `npm run icon:android --workspace @arrrank/mobile`.

Native Rank capabilities belong in Capacitor plugins under this package.
The notebook, key routing, execution controller and live previews live in
`@arrrank/common`; both CLI and web use these implementations. The web shell
renders the `notebookFrame` used by the terminal, including its ANSI
status colors, gutters and cursor. The phone view hides keyboard shortcut hints
in the footer. There is no separate input bar.
A native textarea at the terminal cursor handles the phone keyboard and IME.
The visual cursor keeps blinking when Android temporarily moves input focus.
Evaluation runs in a Web Worker using the same REPL session as the CLI.

Tap source to place the cursor. Enter goes through the CLI key router.
One ⋮ button at the top exposes stepping, running, selection and editing
commands for the phone keyboard. The round button at the bottom right steps on
a tap; holding it for 700 ms runs the full document from the start. Drag
vertically to scroll.
Function arguments and intermediate results appear in the CLI layout.
Android hides system bars; an edge swipe temporarily reveals them.

Source and unfinished drafts are kept locally. Reloading restores pending
source, not runtime values. Stopping terminates the browser worker, so Ctrl-L is
required before executing again. The CLI debugger's pause/breakpoint transport
and native file/stdin operations are not exposed by this mobile shell.
