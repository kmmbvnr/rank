# Tensors

Rank's array model is intended to scale from ordinary vectors to dense tensors
used in numerical computing and ML.

An atom has shape `[]`. A tensor stores a flat sequence of atoms with a
rectangular shape `[D1, D2, ...]`. Lazy dimensions may have an exact, unknown
finite, or infinite size; asking for an unknown finite shape is a demand point.

## Core operations

The current implementation includes dense construction through `array shape`
and dynamic row-major `reshape`:

```rank
M = Values (array Rows Columns) reshape
```

Dense storage may also be allocated with a fill value and updated in place:

```rank
M = array shape Rows Columns pad 0
M Row Column = Value
```

Only material arrays are writable. Lazy tensor results must first be
materialized with postfix `array`.

`transpose` returns a lazy read-only view. Without an axis modifier it reverses
the order of every axis:

```rank
T = A transpose
rem shape 2 3 4 becomes 4 3 2
```

An explicit axis list gives the complete output-axis order:

```rank
T = A transpose axis 2 0 1
rem shape 2 3 4 becomes 4 2 3
```

Axis numbers are zero-based. The list must contain every source axis exactly
once; missing, repeated and out-of-range axes are errors. A matrix transpose is
`A transpose axis 1 0`.

## Axis reductions

`sum` and `mean` without modifiers reduce every element. `axis` reduces only
the named axes and preserves the remaining axes in their original order:

```rank
Total = A sum
Rows = A mean axis 1
Columns = A mean axis 0
Planes = T sum axis 0 2
```

An axis list is treated as a set, so its written order does not affect the
result. Every axis must exist and may appear only once. An empty `sum` is zero;
an empty `mean` raises `.EmptyReduction`. `mean` always returns real values.

`rank` and `axis` answer different questions. `rank` chooses trailing cells and
applies the whole operation to every cell in the leading frame. `axis` names
the coordinate dimensions that the operation consumes.

The broader tensor direction includes:

```rank
matmul
max
exp
log
sqrt
softmax
gelu
layernorm
```

The exact module split is still evolving.

## Matrix inversion

`inverse` from `use linalg` has intrinsic rank 2. It inverts a square numeric
matrix and returns a real matrix with the same shape:

```rank
B = A inverse
BatchInverse = Batch inverse
Planes = T inverse axis 1 rank 2
```

The second expression applies to every trailing matrix cell. The third uses
axis 1 as the frame and forms each matrix from the remaining two axes. A
non-square cell raises `.DimensionMismatch`; a singular cell raises
`.SingularMatrix`. Ranked matrix cells are evaluated lazily and cached.

## Sliding windows

Multidimensional `window` creates overlapping tensor cells without eagerly
copying them:

```rank
WindowShape = array 2 3
Blocks = M WindowShape window
Scores = Blocks + reduce rank 2
```

For source shape `4 5`, `Blocks` has shape `3 3 2 3`. The trimmed source axes
form the leading window-position frame and the requested window axes are
appended as trailing cells. This makes `rank 2` apply directly to each `2 3`
block.

Selected axes follow the operation:

```rank
Columns = M 3 window axis 1
Blocks = T WindowShape window axis 0 2
```

There must be one window size for every selected axis. The appended cell axes
follow the explicit axis order.

## Rank-based application

The same `rank` mechanism used for arrays applies to tensor cells:

```rank
X normalize rank 1
```

For a row-wise table calculation:

```rank
Geo distance rank 1
```

An explicit axis list selects the frame, so non-trailing and non-contiguous
cells do not require a transpose:

```rank
rem T has shape 2 64 128
Rows = T normalize rank 2
rem two cells of shape 64 128

Planes = T normalize axis 1 rank 2
rem 64 cells of shape 2 128
```

For `T shape = 2 3 4 5`, `T F axis 1 3 rank 2` has frame shape `3 5` and
passes cells of shape `2 4` to `F`. Explicit axes are frame axes and their
written order becomes the leading result-axis order. All remaining source axes
form the cell in natural order. The number of frame axes plus the cell rank
must equal the tensor rank.

Scalar cell results have the frame shape. Array results append their common
shape to the frame. Source cells and assembled results are lazy read-only views;
each demanded function result is cached. This avoids a separate
dataframe-specific row API.

## Iteration by axis and cell rank

Ordinary `for` over a rank-N tensor yields its rank-(N-1) cells along the
leading axis:

```rank
for Row i in M
  Row print
end
```

A bare `rank` in the iterable position selects trailing cells. The leading
frame supplies the coordinate bindings:

```rank
for Value i j in M rank 0
  Value print
end
```

`axis` explicitly lists the frame axes being iterated. It is core contextual
vocabulary, not a reserved grammar keyword, and it comes before its numeric
arguments so they cannot be confused with addressing:

```rank
for Column j in M axis 1 rank 1
  Column print
end

for Line i j in T axis 0 1 rank 1
  Line print
end
```

The first binding receives the cell. Subsequent bindings receive coordinates
for the listed frame axes in the same order. Index bindings may be omitted.
Axis numbers are zero-based and unique, and this invariant must hold:

```text
number of frame axes + cell rank = tensor rank
```

Without `axis`, the frame axes are the leading axes in natural order. `rank 0`
yields atoms; a rank equal to the tensor rank yields the whole tensor once.
Iteration produces cells in row-major frame order.

The same `axis` word selects tensor slices and arbitrary positions:

```rank
Rows = M axis 0 from 1 until 4
Columns = M axis 1 array 0 2 5
```

The selected axis is preserved and receives the length of the range or index
array. All other axes keep their order and size.

## Outer

`outer` is a higher-order modifier: the operator or named binary function
immediately before it is applied to every pair of cells:

```rank
Sums = A B + outer
Grid = Values Values bxor outer
Operation = min
Smallest = A B Operation outer
```

Cell ranks belong to the operation, while `outer` combines the remaining
frames. Symbolic binary operations have intrinsic ranks `0 0`. The named
functions `band`, `bor`, `bxor`, `shl`, `shr`, `min` and `max` also declare
ranks `0 0`. User-defined binary functions currently default to `all all`;
syntax for declaring their intrinsic ranks remains deferred.

The result shape is the concatenation of the left and right frame shapes. Thus
atom-pairing operations preserve all operand axes. Left frame axes come first
and the right frame varies fastest. The operation must accept two arguments and
currently must return a scalar for every pair.

Both operands must be finite and restartable. Construction is lazy and may
compute a demanded pair again. A named function supplied to `outer` must
therefore be pure: its result and observable behavior may depend only on its
arguments and immutable captured values. The runtime does not yet prove this
property; static effect analysis is tracked separately as tooling work.

Explicit binary rank overrides remain deferred.

A future axis-qualified cell view can be passed to `outer`: `axis` order will
define frame order and `rank` will define its cells. This will support pairings
such as every row of one matrix with every column of another as lazy views.
The expression syntax remains deferred because `axis` already introduces
selection. `outer` itself does not permute axes.

## Matrix multiplication

`matmul` is distinct from `outer`.

- `outer` adds combination axes.
- `matmul` contracts compatible axes.

## ML direction

High-level names such as `logistic`, `linear` and `cnn` have been useful as
temporary examples while stress-testing Kaggle workflows.

They are **not** treated as magical core primitives.

A current project goal is to implement logistic regression itself in Rank
using the tensor/array layer, and later use the same approach for more advanced
models.
