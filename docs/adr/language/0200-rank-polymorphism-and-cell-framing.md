# 0200. Rank polymorphism and leading-frame cell application

* **Status:** Accepted
* **Date:** 2026-09-08
* **Deciders:** @kmmbvnr

## Context

An operation has a natural input cell: an atom, vector, matrix or whole value.
Applying it to a larger tensor should use one set of shape and iteration rules.
Programs also need to choose explicitly whether they store those results or
recompute a named stage.

## Decision

### Cells and frames

Unary functions declare an intrinsic cell rank. Binary functions may declare
one rank per data operand. Elementwise arithmetic uses scalar cells, `sort`
uses vectors, and `det` and `inverse` use matrix cells. Whole-value operations
such as `reshape`, global `sum`, and `solve` retain their own operand rules.
Intrinsic cell rank is separate from the ranks an operation accepts.

`rank R` overrides a unary cell rank. An operand with rank at most `R` is passed
whole; otherwise its trailing `R` axes form each cell and the remaining axes
form the frame. Negative ranks count down from the operand rank, with a minimum
cell rank of zero.

```rank
Digits = "1203" integer rank 0
RowSums = Matrix sum rank 1
BatchDets' = Batch det rank 2
```

Ordinary bindings complete the result. An apostrophe binding retains a recipe
that recomputes on each demand. The same rule applies to scalar and array-valued
cell results; a function's parameter mode determines whether its argument is
completed at entry. `return` does not introduce another storage boundary.

### Explicit frame axes and binary calls

`axis` lists distinct zero-based frame axes, in result-axis order. The remaining
axes form the cell in natural source order:

```rank
Planes' = Tensor inverse axis 1 rank 2
```

The number of frame axes plus cell rank equals source rank. Explicit frame axes
support unary application and the documented binary comparison forms; general
binary calls use trailing cells. Two binary frames align by their trailing axes.
Equal lengths agree, and a length-one axis can stretch. A statically unknown
length is not proof of a mismatch.

`rank L R` chooses both binary cell ranks. For ordinary named binary functions,
`rank L` changes the left cell rank while retaining the right declared rank.
Comparison shorthand follows its own documented rules. Only positional data
operands participate; function operands and optional configuration stay fixed.
General lifting supports one or two data operands. Special forms such as
`reduce`, `scan`, `outer`, constructors and indexing keep their own rules.

### Result assembly and demand

Scalar results leave the frame shape. Array results append their cell shape;
every observed result cell must have the same shape. Text, sequences and tuples
remain boxed frame elements. Unequal array shapes are errors, without padding.

Known result-cell shapes can be used without calling the function. Unknown
lengths remain unknown until observation. Determining a nonempty result's shape
may call the function on its first cell. The resulting shape evidence is kept;
the computed value is not kept for a separate read. A shape query therefore
neither validates later cells nor promises that its effects will be reused by
another demand.

During one traversal, assembly can retain its current result cell while reading
its scalar elements. A later traversal recomputes. Ordinary binding stores the
completed array instead. Callback effects, operand order, failures and resource
ownership must be preserved by optimized paths. A failed traversal does not
silently retain its successful prefix.

Bulk evaluation before demand requires completed scalar operands and an unchanged
builtin implementation. A lazy operand remains deferred even for a pure builtin;
array size alone does not permit reading its cells. Cancellation propagates
through bulk execution and empty-frame shape inference, without a fallback retry.

### Empty frames

A zero-sized application frame makes no call to its operation. Known result-cell
axes remain present: sorting shape `0 3` at rank 1 gives `0 3`. Unknown lengths of a
known result rank become zero only for empty-frame assembly; an unknown result
rank adds no cell axes. Thus `unique` over `0 3` gives `0 0`.

An operand can itself contain nonempty producer frames of empty cells. Completing
the new result preserves their selected observations, without calling the new
operation. Producer axes that survive framing remain selectable in the result.
Consumed producer axes are observed together within a result cell. If the
combined logical frame is itself empty, it makes no producer calls. Unused
nonempty operands are not forced by these empty-cell observations.

Completing a nonempty frame invokes every callback even when each result is an
empty array. Its effects and shape checks are still required.

Selecting a whole empty result cell invokes that cell's producer and checks its
shape. A view retains the selected producer geometry through indexing, gathers,
`take` and `drop`. It does not invoke unrelated frame cells. Duplicate indices
observe their producer separately; a selection with an empty frame invokes none.
Ranked and axis reductions preserve the same demand boundary. An empty result
cell's reduction identity does not replace the call that produces that cell.

Permutation and broadcast views keep producer frame positions independently of
scalar offsets. Frame axes may move among cell axes after a transpose. Selecting
a frame maps back to its original producer; completing the view observes the
selected producers in the view's frame order, including zero-width cells.

An empty frame also differs from a nonempty frame of empty input cells: shape `2 0` at rank
1 contains two vectors, and `sum` produces two zeros. Declared cell constraints
still apply: an empty batch does not make nonsquare `inverse` cells valid.

Result facts and previously established return-rank contracts can supply shape
metadata without running user code. Only pure builtins without a shape hook may
use a bounded zero-filled prototype; a failed or oversized probe leaves the
result shape unknown. Binary empty frames use shape metadata without a
prototype call.

### Iteration

`for` uses the same cell/frame geometry. Its ordinary data bindings complete
selected values before the body runs:

```rank
for Row i in Matrix
  Row print
end

for Value i j in Matrix rank 0
  Value print
end

for Column j in Matrix axis 1 rank 1
  Column print
end
```

## Consequences

The same geometry covers scalar mapping, row operations and matrix batches.
Deferred stages can compose without retaining every intermediate result;
ordinary bindings offer explicit reuse and writable storage. Shape inference
can be incomplete, and a shape observation can run an effectful callback.
Runtime validation remains necessary for data-dependent result dimensions.

## References

- [Sequences and arrays](../../language/sequences-arrays.md#rank)
- [Tensor operations](../../language/tensors.md)
- [Shape contracts](../../stdlib/reference.md#shape-contracts)
- [Function and return contracts](../../language/control-functions.md)
