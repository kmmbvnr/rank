# Value inspection

Tracking issue: #48. This file records the web viewer choice (#47). The rest of the design
(type hints, references, the CLI viewer) is described in `repl-input.md` and in the issues,
and gets its own sections here with #41.

## The data a viewer receives

`inspect(ref, {fixed, offset, count})` answers with one window of a held value as display
strings: a type per cell, labels, the slice over leading axes, cells capped at 40 characters.
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
  and one `‹ n of N ›` stepper per leading axis of an array of rank above two. Esc and
  Android's Back close it, through the dialog's own `cancel`/`close`, back onto the result row.
- **No typing.** Opening hides the symbol keyboard and the system keyboard; closing brings back
  the same one.
- **Kinds.** Arrays and tables are a grid; records, sets, counters, queues, tuples, graphs and
  sequences are the same grid with a `key` and a `value` column.
- **Adapter.** The grid asks for a rectangle; the adapter reads it as blocks of 64 rows by 16
  columns through `ValueViewer.window`, keeps at most 96 blocks (least recently used first),
  shares requests in flight, and drops answers that belong to an earlier slice. A released value
  closes the viewer with "That value is gone".
- **Style.** Numbers are right-aligned, missing cells dim, a cell that failed to compute red,
  from the per-cell type `inspect` returns.
- **Test.** `packages/web/test/value-viewer.playwright.js` opens a 1,000,000 x 3 array, scrolls
  to the end, checks the last row and that the rendered cell count stays bounded.
