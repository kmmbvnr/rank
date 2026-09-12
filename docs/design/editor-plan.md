# Console, editor and the analysis core

Rank needs two browser surfaces. A **console** — a rich HTML shell where a line
of Rank is typed, run, and its result drawn rather than printed. And an
**editor** that helps enter a whole program on a phone and explains every line
back: the type a name settles on, whether it changes, the shape of an array, and
whether a value is computed now or on demand. The console is not a terminal
emulator and it is not thrown away later: it becomes the run pane of the editor.

Behind both sits one **analysis core** — the facts about a program, with no UI of
its own.

This is a plan, not current behavior. No browser package exists yet, and the
analysis described here is not implemented.

## What is being built

1. **The console** (HTML). Cells in, rendered values out. A 2x3 array is a grid,
   a table keeps its column headers, a lazy sequence shows its size and forces
   on demand, an image tensor shows pixels, an error highlights its own span.
2. **The editor** (HTML). The console plus an input surface: quote pairs,
   automatic `end`, completion, a 40-column ruler, no symbol layer needed. This
   is principle 6 of the [wiki index](../index.md), and it depends on none of
   the analysis.
3. **The analysis core** (library). Which names exist, what they hold, what
   changes them, which values are lazy, which calls have effects.
4. **The terminal CLI** stays what it is — a CI gate and the golden-file harness
   for 3. It is a tool for developing Rank, not the product.

Item 3 is the whole risk. Items 1, 2 and 4 are laborious but certain.

## Foundations already verified

Checked against the current tree, so the plan does not rest on assumptions.

- **The session engine already exists.** `repl()` in `packages/cli/src/main.ts`
  builds one `Interpreter` with `persistentResources: true` and calls
  `execute(source)` per line; state carries across calls and the call returns
  the value of the last expression. Piping `A = 3`, `B = A * 2`, `B` prints
  `3 6 6`. The console is a new renderer over a session model that works, not
  new semantics.
- **The terminal REPL cannot accept a block.** `fun double X` on its own line
  fails with a syntax error, because the grammar wants the body and `end` in the
  same parse. So the terminal cannot define a function or write a loop at all. A
  cell-based console fixes this for free: a cell submits a whole block.
- **Text output discards what HTML can show.** `formatValue` joins items with
  spaces, so a 2x3 array prints `0 0 0 0 0 0` with its shape gone. Tables carry
  `columnNames` on the array itself and the formatter drops them. Sets,
  counters, graphs and indexes print as `<set>`, `<counter>`, `<graph ...>`. An
  infinite sequence prints `<sequence name>`. `images resize` returns a pixel
  tensor that prints as integers. The rich console is not a skin on the
  terminal; it shows information the terminal physically throws away.
- **The interpreter runs in a browser as it stands.** `packages/interpreter/src`
  contains no `node:` import. Every side effect goes through the injected
  `RankIo` and `RankInput` interfaces in `io.ts`, and `packages/cli/src/node-io.ts`
  is the only Node implementation. The editor can be a static page with no
  server.
- **But `RankIo` and `RankInput` are synchronous.** `read` returns a
  `Uint8Array`, not a promise, and `readToken` returns a string. A browser host
  must therefore have the bytes in hand before the run: an in-memory file system
  holding dropped or uploaded files, and a stdin buffer filled up front. Asking
  the page for more input mid-run would need `SharedArrayBuffer` and
  `Atomics.wait`, which means COOP/COEP headers. Avoid that: a stdin pane beside
  the console is both simpler and better than a blocking prompt.
- **Every statement and expression carries a source range.** Langium CST nodes
  give `offset`, `end` and a `range` with start and end line/character, so a
  fact or an error can be attached to an exact span rather than a line number.
- **683 of 684 demo programs parse.** The corpus is large enough to be the
  regression suite for every analysis pass. The exception,
  `demos/tpch/001_q6_revchange.ra`, does not parse at all — it uses a line
  continuation after `Mask =` that the grammar does not accept. A committed
  program that cannot run is what a `rank check` command would have caught.
- **Operation names live in one registry.** `standardModules` in
  `packages/interpreter/src/modules/index.ts` maps 17 module names to 158
  exported names, and each is built by `native(name, arity, ...)`, so `name`,
  `arities`, `monadicRank` and `dyadicRanks` already exist as data on every
  operation.
- **A `use` gates syntax as well as vocabulary.** There are 42 `requireModule`
  call sites covering features with no name of their own: `stdin` needs
  `use io`, `to`/`until` need `use ranges`, `push` and `new` need `use algo`,
  table projection needs `use tables`. A catalogue of exported names alone would
  miss half the reason a program fails.
- **The runtime already owns the type model.** `typeName` returns `integer`,
  `real`, `text` or a value kind, and a variable's accepted set is fixed by its
  first assignment and stored per frame slot. A static hint is an approximation
  of a fact the runtime computes exactly.
- **AST analysis has a precedent.** `scalar-function-proof.ts` already walks the
  Langium AST to prove integer/boolean types and local flow for the region
  compiler. It is the smallest existing example of the pass this plan
  generalizes.
- **Langium's LSP scaffolding is already wired.** `createRankServices` accepts a
  connection, and `rank-validator.ts` is a generated stub with no checks.

## Where to start: the console

The console is a strict subset of the editor and it carries none of the editor's
hard part:

- it needs no caret, selection, IME or touch-keyboard work — a textarea per cell
  is enough, and all of that work is where a custom editor surface goes wrong;
- it delivers the **value renderer**, which the editor then needs for every
  output pane, hover card and inline result. Built once, used by both;
- it delivers the **browser host** — worker, in-memory file system, stdin pane —
  which the editor also needs and cannot avoid;
- it is shippable on its own. A page where someone can try Rank without
  installing Node is worth more than half an editor.

And it reverses the risk order in the plan. With a console, **facts observed
from a real run come before inferred facts.** Every cell already runs code, so
"what type did this actually hold, what shape, was it lazy, how long did it
take" is a recording job, not an inference job. Static inference stops being on
the critical path and becomes what fills in the gaps for code that has not run
yet. That is the single biggest change the rich-HTML reading of "CLI" buys.

The editor's input help shares nothing with any of this, so it can start in
parallel whenever it is more fun than the rest.

## Stage A — the console

### A1 — the browser host (medium)

A Vite application package, the first bundler in the repository. The interpreter
runs in a Web Worker so a long loop cannot freeze the page. Around it: a browser
`RankIo` over an in-memory file system, files added by drag and drop, a stdin
pane, and a worker protocol of run/result/output/error messages. One
`Interpreter` per session with `persistentResources: true`, exactly as `repl()`
already does.

### A2 — the value renderer (medium, the reusable asset)

`RankValue` to DOM, one module, no editor dependency:

| Value | Rendering |
| --- | --- |
| array | a grid that respects `shape`, with the shape shown |
| table | a real table using `columnNames` |
| sequence | size (`exact`, `unknown`, `infinite`), first N items, force more |
| record | named fields, using the `types` map it already carries |
| set, counter, multiset, queue, heap | contents and size, not `<set>` |
| graph, dsu | node and edge counts, directed flag, expandable |
| bytes | hex, with a decoded preview |
| image tensor | pixels, as an image |
| error | message, kind, and the source span highlighted in the cell |

Laziness becomes visible and interactive here, which is the part a terminal
cannot do at all: an infinite sequence is a value you can look into rather than
a word in angle brackets.

### A3 — facts from the run (small, and the differentiator)

Have the interpreter record, per CST range, what actually flowed through it:
type, shape, element count, sequence size, whether the value was lazy, how long
it took. The console then annotates the cell that produced it — real types, real
shapes, real laziness, no inference involved. Rank programs run in milliseconds,
so "run it and show me" is available here in a way it is not for a language with
minute-long builds.

It must cost nothing when off, so the recorder is gated and the gate is part of
its design, not an afterthought.

## Stage B — the analysis core

The console displays these facts; the terminal CLI is how they get tested.
`rank explain program.ra` and `rank explain --json` render the same facts as
text, and their golden output over the 683 demos is the regression suite. That
harness is why the terminal CLI stays: a browser UI is the slowest place
imaginable to debug type inference, and a diff of golden files is the fastest.

### B1 — the operation catalogue (landed)

`packages/language/src/operations.ts` lists all 171 exported names: the module
that provides each one, its arities, monadic and dyadic rank, how it is written,
a one-line description, the kind of value it returns, whether the result is lazy
and what it touches. A second table holds the gated syntax — the constructs a
`use` enables that have no name to look up, each with a runnable example.

The file imports nothing, so the editor and the console can read it without the
runtime. Drift was the one real danger, and the guard is
`packages/interpreter/test/operations.test.ts`: the catalogue's name set,
arities and ranks must equal the live `standardModules` values, every entry must
be written data-first, and each gated form must actually refuse to run without
its module. A new builtin cannot land undocumented.

`ops` in the REPL already reads it: `ops` lists what is in use, `ops <module>`
lists that module's forms and bare syntax, and `ops <name>` prints one entry
with its module, arity, result kind, laziness and effects. The same file is what
completion, operation coloring, hover documentation and a static version of the
runtime's "did you forget `use numbers`?" hint will read.

The gate test earns its keep: it must run each example, not merely watch the
gate disappear, because the weaker check let a wrong `new graph` example stand.
Writing it also exposed a misleading error: a receiver that is not a collection
used to be reported as a missing `use algo`, and now names the receiver.

Still open: the [standard library page](../stdlib/modules.md) has not yet been
turned into generated data.

### B2 — binding and mutation facts (small, fully certain)

No types: just where each name is defined, read and written. That yields the
scope of every name, single-assignment versus reassigned, loop-carried
accumulators, shadowing, unused names and writes before any read. This answers
"does it change or not" completely and exactly, which is a surprising share of
what makes a hint useful.

### B3 — type facts (medium)

A lattice over the runtime's own `typeName` strings plus an explicit `unknown`.
Propagate through literals, operators and the catalogue's result kinds; record
per name whether one type is settled or several are possible.

Two rules keep it honest. `unknown` is a first-class answer and the surface must
show it — Rank has no type annotations, so a static pass will often have nothing
to say, and a guessed type is worse than a blank. And the analyzer must never
contradict the runtime: every inferred fact is checked against A3's observed
facts over the corpus, and a disagreement is an inference bug.

### B4 — shape and rank inference (large, last)

Symbolic shapes — `[N]`, `[N-W+1, W]` — are the most valuable hint for a
language built on tensor rank, and the most expensive to compute. Everything
before this exists to make it testable when it starts. Do not begin before the
golden harness and the observed-fact cross-check are in place.

## Stage C — the editor

The editor is the console plus an input surface, and it arrives in two cuts.

**Cut 1, after Stage A.** The editing surface, a run button wired to the
existing worker, output in the existing renderer, errors inline. All of the
input help belongs here: quote pairs, automatic `end` on block keywords,
completion from the B1 catalogue, the 40-column ruler, a toolbar that makes the
word-based operators reachable without a symbol layer.

CodeMirror 6 is the recommended surface: it is the one mainstream editor
component with serious touch support, its bundle is small enough for a phone,
and its gutter, tooltip and decoration APIs are shaped exactly like the hints
this plan produces. Monaco is desktop-first and large. A custom
`contenteditable` surface means owning selection and IME behavior on mobile,
which is a project of its own.

Highlighting should use a small stream tokenizer inside CodeMirror rather than a
second grammar. A Lezer port of `rank.langium` would be a duplicate definition
of the language and will drift. The Langium parse runs in the worker for
diagnostics, not for color.

**Cut 2, after A3 and B2.** The hints themselves: a type color per line, a shape
column, markers on lazy values, hover cards with the full fact set. Because A3
lands in Stage A, the first hints the editor shows are observed rather than
inferred — run once and the whole file is annotated with facts that are simply
true. Inferred hints from B3 and B4 then fill in the lines that never ran.

## Stage D — language server (medium, optional)

Wrap the same core in the Langium LSP services that are already scaffolded, and
move B2 and B3 diagnostics into the empty `RankValidator`. The browser editor
calls the analysis API directly rather than speaking LSP to itself; the protocol
is only worth its cost at the VS Code boundary. One core, three surfaces.

## Package layout

```text
packages/language/src/operations.ts   the catalogue (B1)
packages/language/src/analysis/       the analysis core (B2, B3, B4)
packages/cli                          check, explain: CI gate and harness
packages/console                      the HTML console (Stage A)
packages/editor                       the editor, embedding the console (C)
packages/language-server              later (D)
```

The analysis core belongs in `packages/language`, not in a new package.
`rank-interpreter` already depends on `rank-language`, so the reverse dependency
is not available, and the Langium validator and hover provider that will consume
these facts live there too. Keeping it there also leaves room for
`scalar-function-proof.ts` to share one type lattice later instead of keeping
its own.

`packages/console` owns the browser host and the value renderer and exports
them, because `packages/editor` embeds the console rather than the other way
round — the console becomes the editor's run pane. If that dependency direction
ever reads backwards, split a `packages/view` out then, not before.

## What a line can say, and how certain it is

| Hint | Source | Certainty |
| --- | --- | --- |
| operation, module, arity, rank | B1 catalogue | exact |
| missing `use` | B1 catalogue | exact |
| scope, reassigned, loop-carried, unused | B2 | exact |
| anything, for a line that has run | A3 | exact for that input |
| variable type, not yet run | B3 | partial, `unknown` when unproved |
| lazy or strict | B1 + B3 | exact for known operations |
| shape and rank, not yet run | B4 | partial, often symbolic |

## Risks

**Inference will often have nothing to say.** The language has no type
annotations, and a name's type is whatever its first assignment made it. The
design answer is an explicit `unknown` everywhere, not a confident guess — and
A3, which reports what really happened, is why that is tolerable. If the
optional annotations in [array element types](array-element-types.md) ever land,
they become the first real input to the static pass.

**Synchronous IO shapes the browser host.** Files and stdin must be in memory
before a run. This is a constraint on the console's design, not a defect to fix
in the interpreter; making `RankIo` asynchronous would change every module.

**Coloring is `use`-sensitive.** The grammar knows no operation names at all:
`A sum` parses as an application of the name `sum`, and whether that name exists
depends on which modules the file opened. The same word is an operation in one
file and an unknown name in another. That is a UI decision to make deliberately,
not a defect to fix.

**The analyzer must not become a second implementation of Rank.** Two guards:
the catalogue is data rather than code, and every inferred fact is checked
against a real run.

**Effects are an open question already recorded.** The
[static effect analysis](open-questions.md) note anticipates exactly this work
and says the language server and the small-screen UI should share one result.
B1's effect column is the place that answer lands.

## The first commit

1. `packages/console`: Vite, a worker, a browser `RankIo` over an in-memory file
   system, one cell, plain-text output. The smallest thing that runs Rank in a
   browser.
2. The value renderer for arrays with shape, tables with headers, and errors
   with their span — the three cases where text loses the most.
3. Blocks in a cell, which the terminal REPL cannot do.
4. `rank check` in the existing CLI, run over `demos/` in CI, plus a fix for
   `demos/tpch/001_q6_revchange.ra`, which does not parse today.

Items 1 to 3 are the product; item 4 is half a day and closes a live bug.

## Open questions

- Does the console keep one cell history or a scratch file that the editor and
  the CLI both open? Sharing one `.ra` file is the honest answer, cells are the
  convenient one.
- Does the page ship the interpreter in its bundle, or load it on demand? A
  phone on mobile data cares.
- Is the A3 recorder always present behind a flag, or a separate build of the
  interpreter?
- How much of a large array does the renderer draw before it pages? A million
  cells must not be a million DOM nodes.
- Does `rank explain` print facts per line, or per expression span? A line is
  readable; a span is what the editor needs.
- Which surface gets hover cards first — the browser editor or VS Code?

Related: [Open questions](open-questions.md),
[Product decisions](product-decisions.md),
[Array element types](array-element-types.md),
[Lexical syntax](../language/lexical-syntax.md).
