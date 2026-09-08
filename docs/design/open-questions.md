# Open questions

These are active design questions, not alternate historical syntaxes.

## `each` and `rank 0`

`each` is reserved as the readable spelling of rank-0 application. It is not
yet settled whether it is an exact alias for `rank 0` for text, tables and
nested values, or whether those value models need a distinct rule.

## Argument expansion

Vararg declarations currently use `*`, but the data-first call-site spelling
for expanding a sequence into arguments is not yet fixed. The former prefix
sketch `lcm * Range` is not current syntax.

## Comparison words

`equal`, `not equal`, `less`, `greater` and `at least` are established.

`at most` is currently being tested as the readable spelling for `<=`, starting
with TPC-H Q6, but is not yet considered settled.

## Tensor iteration

`for Value Index in Sequence` now makes value and index bindings explicit. For
a tensor, the remaining question is what sequence the tensor itself exposes:
row-major atoms, leading-axis items, cells of a requested rank, or slices along
a requested axis.

J treats a rank-N array as a frame of cells of a chosen rank; its ordinary items
are rank-(N-1) cells. Julia separates ordinary value/index iteration from
`eachrow`, `eachcol` and `eachslice(..., dims=...)`. NumPy's `nditer` supports
flat traversal, tracked multi-indices and explicit axis mappings.

The current direction is to keep `for` simple: axis and cell-rank operations
should produce iterable views, and `for` should consume those views normally.
The default tensor iterator and the spelling of those view operations are not
yet settled.

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

## Missing values

`pad` is the current common mechanism for absent data.

Statistical reductions over table columns are expected to skip missing values by
default, but the exact generic missing-value policy still needs a formal spec.

## ML library boundary

`logistic`, `linear` and `cnn` have appeared in Kaggle sketches as placeholders.

The current design goal is to implement logistic regression in Rank itself,
using general tensor and reduction primitives, before deciding what belongs in
`use ml`.

## NLP preprocessing

`vocab` and `tfidf` were useful in the Disaster Tweets sketch, but it is not yet
decided whether they should be standard library words or examples implemented
from more primitive operations.
