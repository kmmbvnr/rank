# Modules, programs and inputs

## Standard modules

Ranges (`to`, `till`, `by`), `len`, `sum`, `min`, `max`, and explicit
conversions `integer`, `real`, `text` are available
without imports. The catalogue groups them under `core`; no `use core` is
needed. User code cannot redefine these available names.
`numbers` still provides `sqrt`, `abs` and number theory; `sequences` provides shapes, ordering and sources such as
`fibonacci`.

```rank
Values = 1 to 5
Values len
Values sum
Values min
Values max
```

`use cli` enables `arg` and `args`. Without it, a
program cannot declare command-line inputs. `use testing` enables test blocks.

A bare module name opens standard-library vocabulary in the current workspace:

```rank
use numbers
use random
```

Parsing does not depend on which modules were opened. `use` enables the
corresponding meanings, validators and execution rules after parsing.

### Available builtin names

Builtin function names are unique throughout the standard library. Modules
control visibility; two modules cannot export different builtins with the same name.

User code cannot redefine an available builtin name. Core names are always
available; other names become protected when their standard module is opened.
The rule applies to function declarations, parameters and local bindings, and
to unqualified imports of user functions. Names from unopened modules remain
available: a program may define `solve` without `use linalg`.

Conflicts are errors in either order. A source unit containing both
`fun solve ...` and `use linalg` is rejected before execution. In a persistent
session, opening `linalg` after defining `solve` fails without activating the
module. A qualified import such as `use "worker" as W` keeps `W.solve` separate
from the caller's builtin `solve`.

Function aliases are allowed. `op = matmul` retains builtin operation identity,
including forms such as `A B op axis 1 0`. Reassigning an alias to another
function requires the next call to resolve that identity again.

Receiver methods keep their contextual dispatch. `Dsu findroot X` calls the DSU
method when `Dsu` is a DSU. For another receiver it resolves `findroot` as an
ordinary function. A user function with that spelling is legal only while the
module supplying the builtin name remains unopened.

Removed builtin spellings produce a migration diagnostic when the receiver type
is known. The former `Dsu find X` and `Dsu find X` calls report
`DSU find is now findroot`, both during execution and in `rank check`.
These spellings are not aliases; collection search still uses `Values find Target`.

A missing `use` is reported in one of two shapes, because a module contributes
two kinds of vocabulary. A name that only the module defines is simply unknown,
and the error suggests the module that would define it:

```
unknown name: sqrt; did you forget `use numbers`?
```

A construct that the grammar always parses but only the module gives meaning to
names itself instead, since there is no unknown word to report:

```
arg requires: use cli
```

Both shapes carry the same instruction. The second covers CLI declarations and `args`,
`new` containers, `push` and `add`, `stdin`, `group by`, the
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

An alias keeps the module's functions in a namespace:

```rank
use "helpers" as h
4 h.twice
```

An open import does not create an implicit namespace, so its file name need not
be a Rank identifier. To use prefixed access, provide a valid alias explicitly.
A file that ends with `return` is also callable under a lowercase alias; see
[Files as functions](#files-as-functions).

Relative names are resolved from the importing file. The `.ra` suffix may be
omitted.

## Running programs

`use` makes code available. A host runs a program by executing its top-level
lines from the first to the last, or until a top-level `return`.

Running a file from the host, as in `rank worker.ra`, only runs it; the option
`--print` (`rank --print worker.ra`) also shows the value the file returns.
Rank does not require a `main` function. A program is also a function:
see [Files as functions](#files-as-functions).

## Files as functions

A program that ends with `return` is a function. Its `arg` lines are the
parameters and the returned value is the result:

```rank
use numbers
use cli

arg Limit integer = 1000

N = 1 till Limit
Mask' = N mod 3 equal 0
Mask' or= N mod 5 equal 0

return N Mask sum
```

When the whole program runs, its names are private, so the compiler reads a
`Mask = …`, `Mask or= …` chain as one expression and computes the sum in a
single pass. A notebook runs one cell at a time and cannot know that, so write
`Mask'` there; the examples in the library do.

`rank multiples.ra` runs the program and prints nothing itself. The
option `rank --print multiples.ra` also shows the returned value, `233168`,
as `print` would. An interpreter session shows the result directly, so a
program does not need a `print` line to be seen.

Importing the file under a lowercase name makes it callable. The name is the
file stem when that is a lowercase word, or the alias after `as`:

```rank
use "multiples.ra" as sum35
sum35          rem 233168
sum35 10       rem 23
```

An `arg` line without a default is a left operand, taken in declaration order
(`X affine`). An `arg` line with a default is a right operand, also in
declaration order, and may be left out from the end: `3.0 affine`,
`3.0 affine 4.0`, `3.0 affine 4.0 1.0`. Arguments are checked against the
declared types before the file runs. A left-out operand uses its default.

Each call runs the file in a fresh interpreter. Names assigned at the top
level are private to that call: the caller cannot read them, does not leak
its own workspace into the file, and a second call starts clean. A file with
no usable lowercase name, or no `return`, is imported as an ordinary module of
functions.

A top-level `return` also works in a notebook or a REPL session, where it ends
the cell with its value.

## Program inputs

Declare program inputs with `use cli`. The import is required even when all
inputs have defaults.

`arg` declares an input parameter of a program. It is broader than a
terminal-only CLI option: a caller may bind it as an operand of a call, through a
command-line adapter, a browser host or another runner.

```rank
use cli

rem Upper boundary, excluded.
arg Limit integer = 1000
```

A file receives its inputs as the operands of a call, or from the host adapter
when it is run directly. A call argument wins over a default; the declared type
is checked against the selected value before program statements execute:

```rank
use "multiples.ra" as sum35
sum35 10
```

```console
rank --print multiples.ra --limit 10
rank --print multiples.ra 10
```

Scalar, array and boolean inputs use the same model:

```rank
use cli
arg Input path
arg Numbers integer array
arg Verbose boolean = false
```

A bare `--verbose` on the command line sets a boolean input to `true`;
`--verbose false` sets it to `false`.

`array` collects remaining positional values or repeated named values into a rank-one array and must be the last `arg` declaration. Named inputs bind first; positional inputs fill the remaining declarations in order. A declaration
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
