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

On first use, an optional walkthrough inserts `A = 1 to 5` and `A * 10`
into an empty notebook without running it. It selects the last line and explains
Play, the Rank keyboard, command documentation and the system-keyboard button,
then opens the floating notebook panel through RANK and ends by highlighting
New notebook with “Start a new notebook and try your own ideas in Rank.” Tapping outside
the editor on the keyboard-dismissal step hides the system keyboard; the tour
advances after the native keyboard reports that it has closed.
Keyboard-dismissal instructions appear only while the system keyboard is confirmed open.
Each step uses one sentence without a heading or Skip button;
The ⋮ menu contains Run program, plus Release preview in debug APKs for testing first use. It saves the current
notebook, then opens a disposable sandbox with its own history and walkthrough.
Each entry clears only the sandbox. Hold RANK for two seconds to return to the
original notebook and history. Release APKs have no sandbox switch and keep the
normal persistent user history. New mobile users and the beginner sandbox also get three saved notebooks:
arrays and matrices, sequences and pipelines, and user-defined functions. Each
contains comments, expected results and a small change to try. They open from
RANK without running; the walkthrough still starts in an empty notebook.
Examples are added once, so edits and deletions survive restarts.
A small “Tap and hold Play” hint without an acknowledgement button follows successful execution of
at least two code lines. Module hints appear at later quiet interactions. Guidance remembers actions already discovered.

Tap RANK to open notebook history and create a new notebook. RANK stays at the
top on a translucent background that blurs the scrolling content beneath it.
The import icon to the right of Library opens the file picker. New notebook, Library and notebook rows
scroll together; the active notebook has a subtle highlight across its entire row.
The drawer groups
notebooks by their last modified date and loads 25 titles at a time. Titles use
the first nonempty `rem` comment, or the first source line after skipping `use`
lines, shortened to 40
characters. The row's ⋮ menu offers Rename, Export and Delete. Rename and Delete open
separate dialogs; Export saves the selected notebook without opening it. Import and export use Android's system file picker.

RANK → Library in release APKs and Release preview contains only Project Euler
problems 1–14, bundled in the app and available offline. Normal debug mode can
browse all of `demos/` in `kmmbvnr/rank` on GitHub's `main` branch. Examples
outside the release catalog receive `rem AI-generated; not yet reviewed.`
after their opening comments when imported. Each folder replaces the panel contents; Back returns to its parent,
or to notebook history at the library root. Folder labels use the text of folder links in the parent folder's
`README.md`, with the folder name as a fallback. Only `.ra`
files appear; `_test.ra` files are excluded. Browsing the full debug catalog requires an internet
connection. Opening an example saves a local notebook without executing it.
Later edits stay on the device, and opening the same example again resumes
that local copy. Delete the local notebook in history to import it afresh.

The phone console uses 13 px code and a 12 px gutter, with six narrower columns
for dots and up to three-digit line numbers. The `rank>` prompt uses the code
font size within the same gutter width. Continuation dots sit at the left edge
of that margin. Long comments
wrap at word boundaries for display without changing the saved source;
code and words wider than the screen still wrap by character.
URLs in comments omit `http://` or `https://` and use an ellipsis when too long.
Moving the editing cursor into a link reveals its complete original URL.

On Android, `NotebooksPlugin` writes plain UTF-8 `.ra` files to the app's private
`files/notebooks/<id>.ra` directory. A SQLite catalog stores titles, dates, cell
boundaries and unfinished drafts. It commits a recovery snapshot before writing
the `.ra` with `AtomicFile`, so an interrupted file write can be repaired on the
next open. If the catalog is recreated, it recovers source from existing `.ra`
files as drafts; manual titles and exact cell boundaries require the original
catalog. A browser uses separate IndexedDB stores for metadata and source.

The former `rank-notebook-v1` draft is migrated once and retained as a backup.
Edits save after a short delay and flush before switching or backgrounding.
Switching blocks on save failures. Reloading restores pending source and the
unfinished draft, not runtime values. Local assets are served with cross-origin
isolation headers, allowing the interpreter to use a shared array buffer signal
directly. A local native signal mailbox remains as a fallback when shared array
buffers are not available, so the interpreter can pause without losing its stack
or values. Interpreter file/stdin operations are not exposed by this mobile shell.

Check the drawer in a mobile Vite session with
`playwright-cli run-code --filename packages/web/test/notebook-history.playwright.js`.
Native storage tests use isolated catalogs and files. On a phone with existing
notebooks, build `:app:assembleDebugAndroidTest`, install the test APK with
`adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk`,
then run `adb shell am instrument -w -e class com.arrrank.app.NotebooksPluginTest
com.arrrank.app.test/androidx.test.runner.AndroidJUnitRunner`. Build from
`packages/mobile/android` with Android Studio's bundled JDK. Avoid
`connectedDebugAndroidTest` on a phone with user notebooks: its runner can
uninstall the main app after testing.
