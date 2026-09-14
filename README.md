# Rank

[![CI](https://github.com/kmmbvnr/rank/actions/workflows/ci.yml/badge.svg)](https://github.com/kmmbvnr/rank/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@rank/cli)](https://www.npmjs.com/package/@rank/cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![status: pre-alpha](https://img.shields.io/badge/status-pre--alpha-orange)

Rank is a modern BASIC for small screens and big algorithms. This repository
contains its evolving grammar, interpreter, command-line REPL, language tests,
and design documents.

## Run

Requires Node.js 20.19 or newer, Python, and a C++20 build toolchain
(for the CLI SQLite cancellation addon).

```console
npm install
npm run build
npm run rank
```

In the interactive CLI, `load FILE` registers top-level `fun` and `memo`
definitions immediately, so calls can appear above their definitions. Loading
does not run function bodies or other statements. Invalid definitions show an
error in their cells; errors that depend on execution appear when called.
Pending function definitions are refreshed before replaying edited cells.

In the interactive CLI, press Ctrl-C to cancel a running computation or SQLite
query and return to editing. SQLite aborts the active statement; interrupting a
write inside an explicit transaction rolls back that transaction. Previously
committed writes remain committed. Cancellation may wait for native I/O, a lock
wait, or an SQL function to return. File and pipe execution do not enable the
cancellation addon.

While a computation is running, Ctrl-P requests a pause. The inspection screen
shows the current Rank source line, active calls and variable values; factor
search also reports `divisor` and `remaining`. Enter or Ctrl-P continues the same
execution; Ctrl-C cancels it. Use arrow keys or Page Up/Down to scroll the snapshot.
A yellow `●` marks the current line with two surrounding lines on each side.
The label distinguishes a stop before execution from a pause inside an operation.
Stepping keeps the debugger visible until the next stop or completion.
Arrays and lazy sequences are shown as summaries without evaluating them.
Each scope appears once. Within a scope, variables on the current line come
first, followed by the most recently read variables. Separate function calls
retain their own locals, including names shared with other scopes.
Pause takes effect at the next cooperative checkpoint, so a native SQLite query
must return before it can pause (Ctrl-C can still cancel that query).
Interactive inspection uses ordinary Rank statement execution for observable
locals, which can make compiled-loop workloads slower. File and pipe execution
keep their existing optimizations and do not enable pause.

In the interactive editor, **Ctrl-T** runs the selected cell (and pending suffix)
with a stop before its first statement. **Ctrl-B** toggles a breakpoint on the source
line under the cursor, marked with ◆. Breakpoints belong to the cell and line
number for this session; after inserting or deleting lines, check their positions.
Identical cell source shares breakpoint matches, including functions defined by
that source and called later. Blank lines and `end` have no executable statement.

While paused, **t** (or Ctrl-T) steps into the next Rank statement, including calls.
**n** (or Ctrl-N) advances to the next iteration of the innermost loop, skipping its body,
nested loops and calls, or stops at the next statement after that loop exits.
Other breakpoints still take precedence. Loop headers appear at iteration
boundaries so you can inspect the bound iteration variable. Values shown belong
to the state before the displayed statement. Enter continues; Ctrl-C cancels.
**g** (or Ctrl-G) finishes the current top-level statement, skipping breakpoints in its
remaining calls and iterations, then stops before the next main-program statement
(including the next cell). Breakpoints remain set. Ctrl-P can still pause the work.
To remove a point, return to the editor and press Ctrl-B on its line.
The single-letter shortcuts apply only while paused; in the editor they insert text.
Built-in operations such as factors execute until the next Rank statement when
stepping; their internals and native SQLite queries are not source-level steps.

Example session:

```text
rank> 2 + 3 * 4
14
rank> Answer = 6 * 7
42
rank> Answer
42
rank> 1 to 5
1 2 3 4 5
rank> 1 to 5 sum
15
```

Turn a cube, take its diagonal, and get 42:

```rank
use numbers
use sequences
use linalg

Cube = (1 to 27) (array 3 3 3) reshape
Cube transpose (array 2 1 0) diag rank 2 diag sum
rem 42
```

Run a file with `npm run rank -- program.ra`. Program inputs follow the file
name:

```console
npm run rank -- demos/euler/001_multiples.ra
npm run rank -- demos/euler/001_multiples.ra --limit 10
```

Run Rank test files directly or discover every `_test.ra` file below a
directory:

```console
npm run rank -- test demos/euler/001_multiples_test.ra
npm run rank -- test demos/euler
```

Run all grammar and interpreter tests with `npm test`.

## Architecture

- `packages/language` contains the static Langium grammar and generated AST.
- `packages/interpreter` resolves imported vocabulary and evaluates the AST.
- `packages/cli` provides file execution and the REPL.
- `docs` is the current language specification.
- `demos` contains target programs that guide future language coverage.

Parsing never depends on which modules were imported. Imports affect name
resolution and evaluation, so incomplete programs still have a stable syntax
tree and useful diagnostics.
