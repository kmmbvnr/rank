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

## Extended window geometry

The current `window` operation moves by one element and produces only complete
contiguous cells. Future examples may justify three independent extensions:

- `by` to move the window by a larger stride;
- padding and a boundary-value policy for positions near tensor edges;
- dilation to leave gaps between values inside a window.

No syntax is reserved for these extensions yet. They must remain distinct:
stride moves a window, padding changes its valid position frame, and dilation
changes the geometry inside each cell.

## Segment tree

A segment tree is a candidate general algorithmic structure for range queries
that cannot be expressed efficiently by a Fenwick tree. It should support a
user-selected associative reduction, point updates and later lazy range
updates. Before adding syntax, a real example must settle the identity value,
half-open or inclusive bounds, how a pure combining function is supplied, and
whether lazy updates need their own operation type. No segment-tree syntax is
current or reserved yet.

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

The compact form:

```rank
A B join
```

is current, but exact rules for:
- inner/left/right/full joins;
- key inference;
- duplicate column names

still need specification.

## Stack / combine

Rank still needs a final name and exact semantics for combining unequal arrays
into a higher-rank rectangular value with padding.

`mix` was rejected as a user-facing name. `stack` is a candidate but is not yet
fixed.

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

`pad` is the current common mechanism for absent data.

Statistical reductions over table columns are expected to skip missing values by
default, but the exact generic missing-value policy still needs a formal spec.

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

## NLP preprocessing

`vocab` and `tfidf` were useful in the Disaster Tweets sketch, but it is not yet
decided whether they should be standard library words or examples implemented
from more primitive operations.
