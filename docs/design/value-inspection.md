# Value inspection

Rich hints and a viewer for what a notebook computes, in the CLI and on the web (tracking
issue #48; pieces #42 to #47 and #34). This page records the decisions, how the parts fit
together, what is known not to work yet, and the web viewer's library choice. Navigation and
key rules for the terminal live in `repl-input.md`.

## Decisions

1. **Type at the cursor.** When the cursor sits on a name the footer shows its facts, for example
   `M · integer [3 4]`, `Row · text`, `X · unknown` or `F · function`. A tap places the cursor on
   a phone, so a tap shows the type. Nothing is drawn on the source. CLI and web behave the same.
   Errors, running status, completion candidates and an iteration row keep the footer.
2. **The viewer opens from a result row.** The result of an executed cell that can be opened (an
   array of rank one or more, a table, a sequence, a record, object, index, set, counter, queue,
   tuple or graph) is a stop for Up and Down between its cell and the next. The row starts with
   a preview kept to one row and, under it, the value's type and shape (`integer [3 4]`), never
   more than two rows; the footer says `Enter view`.
   Enter, a tap on the web or a click in the CLI opens the viewer. Scalars and text stay plain.
3. **Two renderers, one model.** The CLI has a full-screen text viewer, like `help`; the web has an
   HTML overlay. Both draw the same view model from `common` (`buildValueView`): title, type
   line, labels, a window of cells, the slice over the other axes. The logic is not duplicated.
4. **Code that has not run shows only static facts.** The analyzer's type and shape, or
   `unknown`. The viewer opens only for values that were computed: committed cells. Live
   previews have no references.
5. **Facts never contradict the run.** Where runtime facts exist they win, and static ones fill
   the gaps only when they agree. A corpus test runs the demo programs and checks that the
   static facts for every name agree with what the run produced.

## How the parts fit

- **Facts at a position** (`factsAt` in `common/src/name-facts.ts`). Finds the name at a source
  offset (an assignment target, a read, a loop name, a parameter, a function name) and answers
  from the run for names of cells that were executed and have not changed since, and from the
  analyzer otherwise. A draft that rebinds a name never borrows the old run's facts. Imported
  modules (`use "path" as M`) are resolved for analysis, in the REPL and in the language
  validator, so a call into a module has the result type its summary proves.
- **Value references** (`common/src/repl-session.ts`). A committed cell's result is held in the
  session under a reference that tags its output lines (`OutputLine.ref`). A reference is never
  reused and is released when the cell reruns, when the notebook rewinds past it, and on reset
  (Ctrl-L, load). A released reference answers `stale`. Only committed cells hold values.
- **`inspect(ref, {axes, fixed, offset, count})`** (`common/src/value-inspection.ts`). Reads one
  window without computing the rest: an array window covers two axes (the last two unless `axes`
  says otherwise) and `fixed` picks an index on every other axis by axis number; a list takes
  one page. The default is 20 per axis, the limit 1000, and cells are cut at 40 characters. A
  cell that fails to compute is a cell of type `error`, not a failed window. Results are of kind
  `scalar`, `array`, `table`, `entries` (record, object, index, set, queue, tuple, counter,
  graph), `sequence` or `opaque`. A sequence is never advanced: only items already forced by
  a reader are shown, and a range reports its exact size but no items.
- **Output line label.** The first line of an openable result carries `OutputLine.view`, the
  `type [shape]` text, computed from the value's kind and at most one cell.
- **Terminal viewer** (`ValueViewer`, `viewerFrame`). See `repl-input.md`.
- **Web viewer** (`packages/web/src/value-overlay.ts`). See below.

## Questions that were open, as decided

- **Choosing a slice of a rank above two array.** The web has an axis picker: a toggle row for the
  axis down the rows and one for the axis across the columns (choosing the other's axis trades
  them) and a stepper for the index held on every other axis. The terminal viewer keeps `[` and
  `]` on the first held axis. Choosing axes in the terminal is a follow-up.
- **Page size.** The web reads blocks of 64 rows by 16 columns and keeps 96. The terminal asks for
  a window the size of the screen. `inspect` defaults to 20 and never returns more than 1000.
- **Infinite sequences.** The viewer shows the part already read, with the note of what is known
  of the size, and lets the user read further: `m` in the terminal, a "Read more" button on the web.
  Each press reads at most 100 more values (`extend` accepts up to 1000) from the stored
  generator into its tape, in the same look-only mode a result preview uses, so nothing is
  consumed and the values wait for whatever reads the sequence next. It is bounded three ways: by
  count, by a budget of source values passed over without yielding the next one (a filter that may
  never find another), and by time (3 s in all, and 3 s for one value, after which a generator that
  never yields again is interrupted and closed, as Ctrl-C would). The tape's existing memory budget
  (64 MB) still applies. The footer or bar says what happened: how many were read, that the sequence
  ended, or why it stopped. A range and a native source such as `primes` keep no tape, so they
  offer no reading ahead.

## Known limits

- Ranges (`1 to 100`) show their size but no items, and native resumable sources show none and
  cannot be read ahead.
- A generator that stalls without yielding is closed by the read-ahead's time limit; its read
  values stay, but a later consumer meets the interruption error and must rerun the producing cell.
- There are no references for live previews, only for committed cells.
- A module file edited after its cell ran is analyzed in its new form until the cell reruns, and
  the language server does not revalidate an importing document when only the module changes.
- The web has no filesystem, so imports stay opaque there.
- Past about 465,000 rows the web table moves faster than a finger (the package caps the virtual
  height at 10,000,000 px) so the whole extent stays reachable.
- No cell selection or copy yet, and no image tensors.
- Choosing the two axes of the table works on the web only; the terminal viewer switches the first
  held axis with `[` and `]`.

## The data a viewer receives

`inspect` answers with one window of a held value as display strings: a type per cell, labels,
the slice over the other axes, cells capped at 40 characters.
The data stays in the worker. A viewer never sees a full array, so it needs windowed, async
virtual scrolling, nothing else a grid product offers (sorting, filtering, editing).

## Web viewer: library evaluation

Facts are from npm metadata and project pages (October 2026); nothing was benchmarked
except the chosen one. Sizes are npm unpacked sizes, an upper bound.

| Candidate | License | Framework | Async windows | Verdict |
|---|---|---|---|---|
| regular-table 0.9.1 | Apache-2.0 | none, no dependencies, 29 KB min / 10 KB gzip | yes, its core idea | **chosen** |
| Perspective 3.8 | Apache-2.0 | web components, WASM | needs the data inside its engine | no: 7-8 MB, own UI, would copy Arrow out of the worker |
| Glide Data Grid 6.0 | MIT | React | per-cell callback | no: React in a no-framework package |
| Deephaven grid 1.30 | Apache-2.0 | React | canvas | no: React |
| canvas-datagrid 0.26 | BSD-3 | none | all-data model | no: canvas look hard to match |
| RevoGrid 4.28, AG Grid 36, Tabulator 6, SlickGrid 5 | MIT | various | partial | no: heavy, own themes, mostly sync models |
| Apache Arrow JS | Apache-2.0 | | | has no viewer; it is our storage format |

regular-table renders a plain `<table>` with sticky headers inside a native scroll container,
so touch scrolling is the platform's own, the extent is scaled past the browsers' ~33.5M px
element limit, and every style is ours. The look (font, colours, row height, dark theme) comes
from the terminal's CSS, so the grid, the key/value list and later renderers share one style.

## Web viewer: design

- **Shell.** A full-screen `<dialog>` over the notebook: close button, title (name), type line,
  and the axis picker for an array of rank above two. Esc and the close button close it; Android's
  Back reaches the page through a native `OnBackPressedCallback` that calls `window.rankBack()`
  (a history entry did not work in the WebView: Back left the app). A viewer opened from the
  focused row returns to it; one opened by a tap leaves the result row unselected. No element in
  the viewer draws a focus ring, which would show as a white frame at the screen edges.
- **No typing.** Opening hides the symbol keyboard and the system keyboard, however it was opened
  (a tap must not raise one), and keeps them hidden while the viewer is open; closing brings back
  the same one. When the system keyboard returns, the symbol keyboard stays hidden until Android
  reports the system one visible and 400 ms more have passed, because it lies behind the system
  keyboard and would otherwise slide up above it. Measured on a phone: the system keyboard
  arrives at about 240 ms and the symbol keyboard shows at about 655 ms.
- **Axes.** `inspect` takes `axes: [rows, columns]` and `fixed` by axis number, so any two axes
  of an array can form the table, in either order (a transposed view is `[2, 1]`); the default
  stays the last two. Above rank two the overlay shows a toggle row for the row axis and one for
  the column axis (choosing the other's axis trades the two places), and a stepper for the index
  held on each remaining axis. Changing axes starts from the top-left. Column names of a table-like
  array only head columns laid along the last axis. The terminal viewer keeps `[` and `]` on the
  first held axis for now.
- **Smooth scrolling.** The table scrolls by pixels (`sub-cell-scrolling.css`), not whole rows.
  Up to about 465,000 rows (the package caps the virtual height at 10,000,000 px) a finger and
  the table move 1:1; beyond that the table moves faster than the finger so the whole extent stays
  reachable.
- **Kinds.** Arrays and tables are a grid; records, sets, counters, queues, tuples, graphs and
  sequences are the same grid with a `key` and a `value` column.
- **Adapter.** The grid asks for a rectangle; the adapter reads it as blocks of 64 rows by 16
  columns through `ValueViewer.window`, keeps at most 96 blocks (least recently used first),
  shares requests in flight, and drops answers that belong to an earlier slice. A released value
  closes the viewer with "That value is gone".
- **Style.** Numbers are right-aligned, missing cells dim, a cell that failed to compute red,
  from the per-cell type `inspect` returns.
- **Test.** `packages/web/test/value-viewer.playwright.js` (run with `playwright-cli`, like the
  other browser tests) opens a 1,000,000 x 3 array, checks the first screen is full, scrolls to
  the end and checks the last row and that the rendered cell count stays bounded, checks smooth
  scrolling, the focus ring, Esc, Back and a tap, and exercises the axis picker on a 2 x 3 x 4
  array. Keyboard order and Back were also measured on a phone over the WebView's debug socket.
