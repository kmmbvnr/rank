# Modules, programs and inputs

## Standard modules

Ranges (`to`, `until`, `by`), `len`, `sum`, `min`, `max`, and explicit
conversions `integer`, `real`, `text` are available
without imports. The catalogue groups them under `core`; no `use core` is
needed. These functions remain ordinary names and may be overridden by user
functions. `numbers` still provides `sqrt`, `abs`, number theory and
`multiple by`; `sequences` provides shapes, ordering and sources such as
`fibonacci`.

```rank
Values = 1 to 5
Values len
Values sum
Values min
Values max
```

`use cli` enables `option`, `argument`, `flag` and `args`. Without it, a
program cannot declare command-line inputs. `use testing` enables test blocks.

A bare module name opens standard-library vocabulary in the current workspace:

```rank
use numbers
use random
```

Parsing does not depend on which modules were opened. `use` enables the
corresponding meanings, validators and execution rules after parsing.

A missing `use` is reported in one of two shapes, because a module contributes
two kinds of vocabulary. A name that only the module defines is simply unknown,
and the error suggests the module that would define it:

```
unknown name: sqrt; did you forget `use numbers`?
```

A construct that the grammar always parses but only the module gives meaning to
names itself instead, since there is no unknown word to report:

```
option requires: use cli
```

Both shapes carry the same instruction. The second covers CLI declarations and `args`,
`multiple by`, `new` containers, `push` and `add`, `stdin`, `group by`, the
joins, `sort by` and `test` blocks. Every gated construct is listed with a
runnable example in `packages/language/src/operations.ts`, whose test runs each
one with and without its module.

## Source modules

A quoted name loads a Rank source module without executing its top-level lines:

```rank
use "my_module"
```

Without an alias, its public definitions are opened in the current workspace.
Conflicting names are an error.

A function keeps the module workspace in which it was declared. Its body can
use standard modules and source definitions imported by its own file without
requiring the caller to repeat those imports.

An alias keeps the module in a namespace:

```rank
use "my_module" as M

M.Limit = 10
M.run
Answer = M.Answer
```

An open import does not create an implicit namespace, so its file name need not
be a Rank identifier. To use prefixed access, provide a valid alias explicitly:

```rank
use "001_multiples" as E
E.run
```

Relative names are resolved from the importing file. The `.ra` suffix may be
omitted.

## Running programs

`use` makes code available. `run` executes its top-level lines.

```rank
use "worker"
run
```

A named run loads the file first when necessary:

```rank
run "worker"
```

This is equivalent to `use "worker"` followed by `run "worker"`. A bare `run`
uses the most recently opened source module. Execution starts at its first
top-level line, reaches the end of the file and then returns to the statement
after `run`.

Running a file from the host, as in `rank worker.ra`, performs an implicit run.
Rank does not require a `main` function.

## Reading a program without running it

Two commands answer questions about a file that has not run. `rank check`
parses every `*.ra` file under a path and reports the ones that do not, which
is the gate a repository runs in CI. `rank explain` reports one program's
binding facts:

```
rank explain demos/cses/tree/003_diameter.ra
```

For every scope — the program, each function, each test — it lists the names
bound there, how each one came to exist, where it was bound, how often it is
written and read, and whether it is reassigned, carried across a loop, hiding
an outer name of the same spelling, or never read at all. It then lists the
standard-library names the program calls, the ones whose module it forgot to
open, and any word that is neither. Reading a source module with `use "file"`
brings that module's names along, so a test file resolves the names it borrows.

Each name also carries the runtime types it may hold, taken from literals,
constructors, declared `option` and `argument` types, operators and the
catalogue. Rank states no types, so many names report `unknown`, and that is the
intended answer rather than a gap to fill with a guess: a parameter, a loop
value and anything a user function returns all report it. What the pass does
say is checked against the runtime over the whole demo corpus, so a reported
type is one the program will really produce.

A name reported under `needs a use` is a program that cannot run, and
`rank explain` exits nonzero when it reports one.

## Program inputs

Declare program inputs with `use cli`. The import is required even when all
inputs have defaults or receive values from the workspace.

`option` declares an input parameter of a program. It is broader than a
terminal-only CLI option: a caller may bind it through the current workspace, a
command-line adapter, a browser host or another runner.

```rank
use cli

rem Upper boundary, excluded.
option Limit integer = 1000
```

Input resolution has one fixed precedence order:

```text
workspace -> args -> default
```

Therefore these calls provide the same logical input through different
adapters:

```rank
Limit = 10
run
```

```rank
use cli
args "--limit" "10"
run
```

The workspace value wins when both are present. Every selected value is checked
against the declared type before program statements execute.

Positional and boolean inputs use the same model:

```rank
use cli
argument Input path
argument Numbers integer many
flag Verbose
```

`many` collects the remaining or repeated values into a sequence. A declaration
without a default is required. Contiguous `rem` lines immediately above an input
declaration provide its help text.

## Modular language implementation

Language modules register vocabulary, semantic handlers, validation and planner
rules independently. The parser uses a stable combined grammar, because source
must be parsed before its `use` statements can be evaluated. Rare syntax
extensions are assembled as grammar fragments before parser construction;
ordinary modules use existing expression and statement extension points.

Host-dependent services are injected through runtime adapters. For example,
`use io` exposes the same Rank values and operations in every host while the CLI,
browser or embedded application supplies the actual file-system implementation.
