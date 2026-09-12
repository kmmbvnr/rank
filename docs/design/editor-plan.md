# Editor, CLI and the analysis core

Rank needs an editor that helps enter code on a phone and explains every line
back: the type a name settles on, whether it changes, the shape of an array, and
whether a value is computed now or on demand. That is one product but three
layers of work, and only the middle one is hard.

This is a plan, not current behavior. No editor package exists yet, and the
analysis described here is not implemented.

## Three layers

1. **The analysis core** — the facts about a program: which names exist, what
   they hold, what changes them, which values are lazy, which calls have
   effects. Language-level, no UI, no IO.
2. **The surfaces** — a CLI that prints those facts as text, an HTML editor that
   draws them, later a language server for desktop editors. Each surface is a
   renderer over the same facts.
3. **The input help** — quote pairs, automatic `end`, word completion, a
   40-column ruler, a keyboard that does not need a symbol layer. This is
   principle 6 of the [wiki index](../index.md) and it depends on none of the
   analysis.

Layer 1 is the whole risk. Layers 2 and 3 are laborious but certain.

## Foundations already verified

These were checked against the current tree, so the plan does not rest on
assumptions:

- **The interpreter runs in a browser as it stands.** `packages/interpreter/src`
  contains no `node:` import. Every side effect goes through the injected
  `RankIo` and `RankInput` interfaces in `io.ts`, and `packages/cli/src/node-io.ts`
  is the only Node implementation. A browser `RankIo` plus a bundler is the whole
  port. The editor can therefore be a static page with no server.
- **Every statement and expression carries a source range.** Langium CST nodes
  give `offset`, `end` and a `range` with start and end line/character, so a fact
  can be attached to an exact span rather than a line number.
- **683 of 684 demo programs parse.** The corpus is large enough to serve as the
  regression suite for every analysis pass. The exception,
  `demos/tpch/001_q6_revchange.ra`, does not parse at all — it uses a line
  continuation after `Mask =` that the grammar does not accept. A committed
  program that cannot run is exactly what the first CLI command would have
  caught.
- **Operation names live in one registry.** `standardModules` in
  `packages/interpreter/src/modules/index.ts` maps 17 module names to 158
  exported names, and each is built by `native(name, arity, ...)`, so `name`,
  `arities`, `monadicRank` and `dyadicRanks` already exist as data on every
  operation.
- **A `use` gates syntax as well as vocabulary.** There are 42 `requireModule`
  call sites covering features with no name of their own: `stdin` needs
  `use io`, `to`/`until` need `use ranges`, `push` and `new` need `use algo`,
  table projection needs `use tables`. A catalogue that lists only exported
  names would miss half the reason a program fails.
- **The runtime already owns the type model.** `typeName` returns `integer`,
  `real`, `text` or a value kind, and a variable's accepted set is fixed by its
  first assignment and stored per frame slot. The editor hint is the static
  approximation of a fact the runtime computes exactly.
- **AST analysis has a precedent.** `scalar-function-proof.ts` already walks the
  Langium AST to prove integer/boolean types and local flow for the region
  compiler. It is the smallest existing example of the pass this plan
  generalizes.
- **Langium's LSP scaffolding is already wired.** `createRankServices` accepts a
  connection, and `rank-validator.ts` is a generated stub with no checks. The
  desktop story is a later surface over the same core, not a second
  implementation.

## Where to start: the CLI

Start with the analysis core and give it a CLI surface first. Not because the
CLI matters more than the editor, but because the CLI is a **test harness** and
the editor is a **viewer**:

- a CLI command renders the facts as text, which can be compared against golden
  files over all 683 demo programs, reviewed in a diff and bisected;
- the editor can only show the facts, and debugging inference through a browser
  UI is the slowest loop available.

The ordering is not strictly serial. Layer 3 — the input help — shares nothing
with the analysis and can begin as soon as the editor shell exists. So the first
editor cut lands early, and the hints arrive on it in a second wave.

## Phases

### Phase 1 — the operation catalogue (medium)

One data file, `packages/language/src/operations.ts`, listing for every name:
the module that provides it, arities, monadic and dyadic rank, a one-line
description, the kind of value it returns, whether the result is lazy, and
whether it has effects. Alongside it, the gated features: which `use` each
syntax form requires.

Seed it from the registry, which already holds names, arities and ranks, then
annotate result kinds and laziness by hand.

Drift is the one real danger. The guard is a test in `packages/interpreter`
asserting that the catalogue's name set, arities and ranks equal the live
`standardModules` values, so a new builtin cannot land undocumented.

This phase alone buys completion, operation coloring, hover documentation and a
static version of the runtime's own "did you forget `use numbers`?" hint, with
no inference and no risk. The [standard library page](../stdlib/modules.md)
becomes generated data rather than a hand-maintained list.

### Phase 2 — the CLI surfaces (small)

```console
rank check program.ra          exit 1 on any diagnostic, print nothing else
rank explain program.ra        the source, annotated line by line
rank explain program.ra --json the same facts as data
```

`check` is the CI gate — pointed at `demos/` it fails today. `explain` is the
text rendering of what the editor will later draw in a gutter, and its golden
output over the corpus is the regression suite for Phases 3 to 6.

### Phase 3 — binding and mutation facts (small, fully certain)

No type inference: just where each name is defined, read and written. It yields
the scope of every name, single-assignment versus reassigned, loop-carried
accumulators, shadowing, unused names and writes before any read. This answers
"does it change or not" completely and exactly, which is a surprising share of
what makes a hint useful.

### Phase 4 — type facts (medium)

A lattice over the runtime's own `typeName` strings plus an explicit `unknown`.
Propagate through literals, operators and the catalogue's result kinds; record
per name whether one type is settled or several are possible.

Two rules keep this honest:

- `unknown` is a first-class answer and the surface must show it. Rank has no
  type annotations, so a static pass will often have nothing to say, and a
  guessed type is worse than a blank.
- the analyzer must never contradict the runtime. Phase 5 makes that testable.

### Phase 5 — observed facts from a real run (small, and the differentiator)

Have the interpreter record, per CST range, what actually flowed through it:
type, shape, element count, sequence size, whether the value was lazy, how long
it took. Then `rank explain --run` prints exact facts instead of approximate
ones, and the editor can overlay them.

This is cheap and it beats inference on its own ground. Rank programs are short
— a demo runs in milliseconds — so "run it and show me the real shapes" is
available in a way it is not for a language with minute-long builds. It also
turns the demo corpus into the test suite for Phase 4 and Phase 6: any
disagreement between an inferred fact and an observed one is a bug in the
inference.

### Phase 6 — shape and rank inference (large, last)

Symbolic shapes — `[N]`, `[N-W+1, W]` — are the most valuable hint for a
language built on tensor rank, and the most expensive to compute. Everything
before this phase exists to make it testable when it starts. Do not begin it
before the golden harness and the observed-fact cross-check are in place.

### Phase 7 — the editor, in two cuts (large)

**Cut 1, after Phase 2.** A static page: editor surface, run button, output
pane, errors inline. The program runs in a Web Worker so a long loop cannot
freeze the page, over a browser `RankIo`. All of layer 3 belongs here — quote
pairs, automatic `end` on block keywords, completion from the Phase 1
catalogue, the 40-column ruler, a toolbar that makes the word-based operators
reachable without a symbol layer.

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

**Cut 2, after Phase 4 and Phase 5.** The hints themselves: a type color per
line, a shape column, markers on lazy values, hover cards with the full fact
set, and a "run and annotate" mode that replaces inferred facts with observed
ones.

### Phase 8 — language server and desktop editors (medium, optional)

Wrap the same core in the Langium LSP services that are already scaffolded, and
move Phase 3 and 4 diagnostics into the empty `RankValidator`. The browser
editor should call the analysis API directly rather than speak LSP to itself;
the protocol is only worth its cost at the VS Code boundary. One core, three
surfaces.

## Package layout

```text
packages/language/src/operations.ts   the catalogue (Phase 1)
packages/language/src/analysis/       the analysis core (Phases 3, 4, 6)
packages/cli                          check, explain (Phase 2)
packages/editor                       the HTML editor (Phase 7)
packages/language-server              later (Phase 8)
```

The analysis core belongs in `packages/language`, not in a new package.
`rank-interpreter` already depends on `rank-language`, so the reverse
dependency is not available, and the Langium validator and hover provider that
will consume these facts live there too. Keeping it there also leaves room for
`scalar-function-proof.ts` to share one type lattice later instead of keeping
its own.

`packages/editor` introduces the first bundler in the repository. Vite suits an
application package; the output stays a static page with no server.

## What a line can say, and how certain it is

| Hint | Source | Certainty |
| --- | --- | --- |
| operation, module, arity, rank | Phase 1 catalogue | exact |
| missing `use` | Phase 1 catalogue | exact |
| scope, reassigned, loop-carried, unused | Phase 3 | exact |
| variable type | Phase 4 | partial, `unknown` when unproved |
| lazy or strict | Phase 1 + Phase 4 | exact for known operations |
| shape and rank | Phase 6 | partial, often symbolic |
| any of the above, after a run | Phase 5 | exact for that input |

## Risks

**Inference will often have nothing to say.** The language has no type
annotations, and a name's type is whatever its first assignment made it. The
design answer is an explicit `unknown` everywhere, not a confident guess. If the
optional annotations in [array element types](array-element-types.md) ever land,
they also become the first real input to this analysis.

**Coloring is `use`-sensitive.** The grammar knows no operation names at all:
`A sum` parses as an application of the name `sum`, and whether that name exists
depends on which modules the file opened. The same word is an operation in one
file and an unknown name in another. That is a UI decision to make deliberately,
not a defect to fix.

**The analyzer must not become a second implementation of Rank.** Two guards:
the catalogue is data rather than code, and Phase 5 checks every inferred fact
against a real run.

**Effects are an open question already recorded.** The
[static effect analysis](open-questions.md) note anticipates exactly this work
and says the language server and the small-screen UI should share one result.
Phase 1's effect column is the place that answer lands.

## The first commit

1. `rank check`, plus the `packages/language/src/analysis/` skeleton reporting
   parse errors through the existing `RankError` formatting.
2. The command run over `demos/` in CI — and a fix for
   `demos/tpch/001_q6_revchange.ra`, which does not parse today.
3. The operation catalogue with its anti-drift test.
4. `rank explain` as plain text, with golden output over the corpus.

None of that touches the runtime, and all of it is what the editor will read.

## Open questions

- Does `rank explain` print facts per line, or per expression span? A line is
  readable; a span is what the editor needs.
- Does the editor ship the interpreter in its bundle, or load it on demand? A
  phone on mobile data cares.
- Is the observed-fact recorder always present behind a flag, or a separate
  build of the interpreter? It must cost nothing when off.
- Does the editor keep programs in browser storage, and is that the same
  `.ra` file the CLI runs?
- Which is the first surface to get hover cards — the browser editor or VS Code?

Related: [Open questions](open-questions.md),
[Product decisions](product-decisions.md),
[Array element types](array-element-types.md),
[Lexical syntax](../language/lexical-syntax.md).
