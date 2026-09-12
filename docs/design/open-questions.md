# Open questions

These are active design questions, not alternate historical syntaxes.

## Pattern matching

`match / case` is a candidate for readable branching over labels, union types
and structured values. It appears in many modern languages and could make
exhaustive handling clearer than a long chain of type guards:

```rank
match Value
  case .integer
    Total += Value
  case .text
    Value print
end
```

This is not current syntax. The design still needs to settle value binding,
guards, destructuring, a default case and whether the interpreter checks that
all members of an inferred union are covered.

## `each` and `rank 0`

`each` is reserved as the readable spelling of rank-0 application. It is not
yet settled whether it is an exact alias for `rank 0` for text, tables and
nested values, or whether those value models need a distinct rule.

## Argument expansion

Vararg declarations currently use `*`, but the data-first call-site spelling
for expanding a sequence into arguments is not yet fixed. The former prefix
sketch `lcm * Range` is not current syntax.

## Addressing followed by operations

An addressed tensor result does not yet continue into a postfix operation in
the same flat chain. For example, `Queries # 0 max` reports that `#` is outside
addressing, while these two statements work:

```rank
Arguments = Queries # 0
Limit = Arguments max
```

If more examples need the compact form, application continuation should make
the address boundary explicit without changing the meaning of `#` or claiming
operation names during parsing.

## Multi-argument method blocks

The earlier `with ... end` form for supplying two or more method arguments is
disputed. `with` is not reserved as current syntax. A replacement should wait
for the first real multi-argument method and must remain distinguishable from a
method with no arguments followed by ordinary statements.

## Compound conditions in table source clauses

Multiple condition lines in a table source clause currently mean implicit AND.

The exact interaction between that implicit AND and explicit `or` is not yet
fixed. Complex OR expressions should currently be expressed with first-class
boolean masks where their semantics are unambiguous.

## Negative indexing

`pad` is cleanest if out-of-range coordinates are truly absent. Python-style
negative indexing conflicts with expressions such as:

```rank
A -1 pad 0
```

Current addressing rejects negative indices, including when followed by `pad`.
The spelling of explicit operations such as `A last` is not yet fixed.

## Window dilation

`window stride S padding P` now controls movement and a symmetric zero border.
Dilation, which leaves gaps between values inside each window, remains
separate and has no reserved syntax. A future proposal must not confuse it with
stride, which moves the complete window, or padding, which changes its valid
position frame.

## Remaining standard-input modes

Standard input modes are symbol values. The current implementation supports
`.integer` and `.word`. The accepted direction reserves two broader modes:

```rank
Line = stdin .line
Text = stdin .text
```

`.line` will read one line without its line ending; `.text` will read all
remaining input and preserve line endings. Before implementation, mixed token
and line reads still need one exact cursor rule, especially after a token at the
end of a CRLF line. These forms are design notes, not current syntax with
runtime support.

## Reusable operation plans

Source-bound masks and window results are already lazy values. A separate
future feature could store an operation before it receives its source:

```rank
Even = even
Window13 = 13 window

Answer = Fib Even sum
Windows = Digits Window13
```

This requires one general design for functions as values and partial
application. It must not be a special case for `even` or `window`. These
spellings are illustrative and are not current syntax.

## Static effect analysis

Lazy higher-order operations such as `outer` require their function argument to
be pure, but the runtime does not yet prove that property. A future semantic
analysis pass should classify functions as `pure`, `effectful` or `unknown` from
their resolved call graph and captured bindings. Built-ins can declare their
effect directly; recursive groups need a fixed-point analysis, and calls through
values may remain unknown.

The language server and small-screen UI can use the same result to distinguish
effectful calls and warn at operations that may reorder or repeat evaluation.
The exact diagnostic policy and any source annotation remain undecided.

## Join variants

`leftjoin by`, `innerjoin by` and explicit key pairs with `on` are current for
array-backed tables. Remaining questions are right/full joins, optional
cardinality validation, and how the current SQLite-backed source translates
joins into SQL and declares row order. Duplicate non-key names currently
raise `.TypeError` until an explicit rename operation is designed.

## Stack / combine

Rank still needs a final name and exact semantics for combining unequal arrays
into a higher-rank rectangular value with padding.

`mix` was rejected as a user-facing name. `stack` is a candidate but is not yet
fixed.

## Rectangular and ragged construction

Find one coherent construction syntax for rectangular tensors and rows of
unequal length. The existing `array shape ...` and the proposed
`array .ragged` use inconsistent forms; `.ragged` is not approved or reserved.
The design should stay easy to type on a phone and avoid new keywords where
existing vocabulary can express the distinction clearly.

Euler 18 motivates preserving row boundaries and addressing a triangle by row
and column. Its current example already writes the input in 15 data lines,
but stores a flat array and computes triangular offsets manually. Other uses
include graph adjacency lists and batches of sequences with different lengths.

Before implementation, settle row boundaries and line continuation, shape,
addressing, and the meaning of `axis` and `rank` on unequal rows. Absent cells
must remain distinct from numeric zero. Combining rows into a rectangular
tensor with explicit padding is a separate conversion (see Stack / combine).

## Graph accelerator packing

The current first-class `graph` API is specified in
[Graphs](../language/graphs.md). Its public behavior is independent of physical
storage, so CPU traversal may later move from mutable adjacency lists to CSR
without changing programs.

Future accelerator conversion should be explicit rather than an automatic
materialization:

```rank
Packed = Graph coo
Sources = Packed .sources
Targets = Packed .targets
```

An optional `csr` conversion may expose offsets and targets for efficient
neighbor ranges. An `M 2` human-facing edge matrix and a `2 M` COO tensor carry
the same topology and can be converted by transposing axes.

Batching should concatenate packed node and edge arrays, shift vertex indices,
and retain per-graph node and edge counts. Node features and edge features stay
in parallel tensors rather than changing the topology value. This follows the
separation used by
[PyTorch Geometric](https://pytorch-geometric.readthedocs.io/en/latest/generated/torch_geometric.data.Data.html)
and the batched sender/receiver representation in
[Jraph](https://jraph.readthedocs.io/en/latest/api.html).

The design must preserve stable vertex indices and either stable edge IDs or a
reported packing permutation. It must also decide how parallel edges,
self-loops and logical undirected edges map to directed COO entries. Automatic
deduplication would lose information needed by multigraph algorithms and edge
features, so it should require an explicit operation if supported.

Weighted traversal, packing and batching can be added without changing current
neighbor iteration.

## Triangular matrices

Consider upper- and lower-triangular matrix representations and specialized
algorithms as a future linear-algebra feature. A triangular matrix has a square
logical shape and zeros on one side of the diagonal; ragged rows have absent
elements instead. The two concepts need separate semantics even if their
storage can share implementation techniques.

Potential benefits include forward/back substitution for `solve`, exploiting
triangular factors from LU or Cholesky, and specialized multiplication and
determinant evaluation. Structure could be represented by a view or metadata
without new language keywords. The design must settle validation, mutation,
storage and how operations preserve or discard that structure. Coordinate this
with Linear solver dispatch below; no constructor syntax is agreed yet.

Julia's [triangular matrix views](https://docs.julialang.org/en/v1/stdlib/LinearAlgebra/#LinearAlgebra.LowerTriangular)
are a reference for this design.

## Permutations by tensor axis

The current `permutations` implementation handles text and rank-1 collections.
The agreed tensor extension will permute equal-shaped cells along one axis and
return a lazy sequence of tensors with the original shape. It will reuse the
existing `axis` vocabulary:

```rank
Rows = M permutations axis 0
Columns = M permutations axis 1
```

The default is axis 0. Multiple-axis permutation and the interaction with an
explicit `rank` modifier remain to be specified before implementation.

## Missing values

`pad` is the current common mechanism for absent data. `mean`, `median` and
`std` skip missing cells in projected table columns. Missing-value behavior for
other reductions and operations remains open.

## Optional results and `maybe`

A future operation modifier such as `maybe` could turn an expected failure
into an optional value instead of unwinding to `catch`:

```rank
Parsed = Text integer maybe
Value = Parsed pad 0
```

This should be reconsidered after Rank has a first-class `missing` or optional
type. Open questions include whether `maybe` changes the result type, how
optional atoms behave in arrays and tables, and whether every operation may use
the modifier or only operations that declare an expected failure.

## Resumable errors and interactive repair

Rank may later add a Common Lisp-style condition and restart layer above
`try / catch`. In the interpreter or debugger, an error could suspend at its
origin and offer operations such as:

- replace the offending value and retry the operation;
- supply a result and continue after the operation;
- retry a containing function;
- edit the source file, reload the affected code and continue the current run.

This is intended as an interactive usability feature rather than ordinary
program control flow. Its design must define continuation capture, stack-frame
state, already-performed side effects, lazy sequence demand, changed function
definitions and source locations before any syntax is reserved.

## ML library boundary

`logistic`, `linear` and `cnn` have appeared in Kaggle sketches as placeholders.

The current design goal is to implement logistic regression in Rank itself,
using general tensor and reduction primitives, before deciding what belongs in
`use ml`.

## Linear solver dispatch

The current `A B solve` contract deliberately describes `A * X = B` without
exposing a factorization. The interpreter currently uses dense Gaussian
elimination with partial pivoting. A future implementation may dispatch to:

- direct diagonal or triangular substitution;
- Cholesky for symmetric positive-definite matrices;
- pivoted LU for general dense square matrices;
- sparse direct or iterative solvers;
- QR or SVD least-squares paths if rectangular systems are later accepted.

The design still needs to decide whether structure comes from safe runtime
inspection, persistent tensor metadata, explicit matrix wrapper types, or some
combination. Cached reusable factorizations and batch/axis semantics also remain
open. Every path must preserve the observable `solve` result and error
contract.

## Array element types

An optional element-type annotation would let an array name a narrower
representation than a boxed Rank atom — `int32`, `f32`, `fp8`, `fp4` — and keep
its cells in a typed buffer. An `integer` cell costs 31.9 bytes today, so the
question is mainly about which problems fit in memory.

The decisions still open are whether a representation is a storage choice or a
type, where the annotation attaches, which `fp8` format to accept, and where an
MXFP4 block scale lives. See
[Array element types and compact storage](array-element-types.md).

## NLP preprocessing

`vocab` and `tfidf` were useful in the Disaster Tweets sketch, but it is not yet
decided whether they should be standard library words or examples implemented
from more primitive operations.

## Explain and explore a calculation interactively

Future interface idea, agreed 2026-09-12. This is not current syntax or an
implemented inspection feature.

The CLI, a future editor and the calculator UI could expose the same inspection
model. A result could show its shape, element type, evaluation state and measured
execution time. A short explanation should describe how it was computed:

> Matrix 1000×32 · real · materialized · computed in one pass

For lazy results, distinguish a pending computation, partially evaluated cells,
and a fully materialized result. Time spent preparing or compiling a computation
should be distinguishable from time spent actually computing its values.
Reading already-known metadata should not force a lazy result. Richer inspection
may explicitly compute values, including a prefix of a lazy result.

Distinguish three actions:

- Inspect existing metadata without advancing evaluation.
- Preview requested values or a prefix in an isolated execution state, without
  changing the running program or retaining progress in its caches.
- Advance the real computation by an explicit step and retain that progress,
  including any newly computed values in the program's cache.

This should support an interactive, educational BASIC-like workflow. The user
must be able to tell which action observes the program and which advances it.
A preview must not silently consume the live iterator, advance stdin or file
positions, mutate shared arrays, change the live random generator, or duplicate
external effects. Isolation requires more than dropping the returned value:
mutable dependencies and evaluation state need an actual branch or equivalent
mechanism. Effects that cannot be isolated or replayed from recorded inputs
require an explicit real-execution step.

When progress is retained, subsequent execution must reuse valid work rather
than accidentally repeat effects. Mutation invalidation still applies. The
interface should distinguish preview values from committed execution results;
inspection must not silently change the normal execution history.

An optional detail view could show which operations were combined, which ran
through the ordinary interpreter, and why a planned optimization did not apply.
This would help both users understand a calculation and language developers
find missed compiler coverage without changing readable Rank programs.

Explanations must come from the path actually executed. A plan that was prepared
but declined a runtime guard must not be shown as a successful optimization.
“One pass” should describe the computation itself and distinguish any additional
validation or resource-ownership scans.

Start with short result annotations suitable for a narrow mobile screen; keep
compiler diagnostics in the detail view. The metadata API, timing boundaries, isolated preview mechanism and visual
design remain to be decided. This is a future tooling design, not a change to
current Rank evaluation semantics.
