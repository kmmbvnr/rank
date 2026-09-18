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
commands for the phone keyboard. The rounded square button at the bottom right runs
pending instructions through the selected line on a tap; holding it for 700 ms
runs the full document from the start. Drag
vertically to scroll. During execution the button shows a pause icon. Tap it to
inspect the current line and variables, or hold it to stop execution. Use the
menu to step into a line, advance
an iteration or return to the main program. While paused, the button shows a
triangle with a bar: tap it to step into one line, or hold it to continue with
the same state. A short ripple shows each press. Step uses a soft tick; other
accepted button actions use system haptic feedback, and a completed
hold gives a confirmation pulse. On Android 12 and newer the button uses the system accent palette.
Paused code occupies six screen rows, including wrapped lines, so variables
stay at the same height. Variables keep their declaration order; new variables
appear at the end. The paused line and existing assignment targets use muted
amber, and variables read by the next expression use muted blue.
Function arguments and intermediate results appear in the CLI layout.
Android hides system bars; an edge swipe temporarily reveals them.

Source and unfinished drafts are kept locally. Reloading restores pending
source, not runtime values. Android pause and stop requests use a local native signal mailbox, so the
interpreter can pause without losing its stack or values. The web version uses
a shared signal when served with cross-origin isolation headers. Native
file/stdin operations are not exposed by this mobile shell.
