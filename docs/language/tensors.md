# Tensors

Rank's array model is intended to scale from ordinary vectors to dense tensors
used in numerical computing and ML.

An atom has shape `[]`. A tensor stores a flat sequence of atoms with a
rectangular shape `[D1, D2, ...]`. Lazy dimensions may have an exact, unknown
finite, or infinite size; asking for an unknown finite shape is a demand point.

An array variable keeps the number of axes of its first value. Axis lengths may
change, but assigning a different rank raises `DimensionMismatch` and leaves
the previous value in place. Use a new variable for a reshape that changes rank:

```rank
use sequences
A = array 1 2 3 4
A = array 5 6 7 8 9 10
M = A reshape 2 3
```

`A` stays a vector; `M` is a matrix. Assigning `M` back to `A` is an error.
Function parameters and local variables establish their rank per call.

## Core operations

The current implementation includes dense construction through `array shape`
and dynamic row-major `reshape`:

List values or a range followed by `shape` to create a tensor on one line:

```rank
M = array 1 2 3 4 shape 2 2
Grid = array 1 to 4 shape 2 2
Odds = array 1 to 9 by 2 shape 5 1
Zeros = array shape 2 2 fill 0
```

A range also constructs a rank-1 array without parentheses:

```rank
V = array 1 to 10
Countdown = array 10 till 0 by -2
```

Values use row-major order. Their count must equal the product of the dimensions.
The `shape` suffix needs no import. Use `(shape)` to store the function itself
as an array element.

Reshape an existing value with:

```rank
M = Values reshape Rows Columns
```

One dimension may be `#`, inferred from the total number of elements:

```rank
Col = Values reshape # 1
Row = Values reshape 1 #
Pairs = Values reshape # 2
Flat = Values reshape #
```

The other dimensions must have a positive product that divides the element
count exactly. An empty source can reshape to `# 1` (shape `0 1`), but `# 0`
is ambiguous and raises `DimensionMismatch`. Only one `#` is allowed, written
directly among the reshape dimensions; it is not a value to store in a shape
array. Negative dimensions, including `-1`, remain invalid. Finite sequences
are consumed once. Transpose keeps its existing axis-permutation behavior.

Inside a function, private integer expressions using `outer +`, `outer -` or
`outer *` can fuse with reshape, a bit-mask filter and a following reduction.
The candidates are read in row-major order without storing the product or
mask. A following `copy` stores only selected values. This still visits every
candidate; it does not skip whole branches of the product. Sources with
observable reads or potentially failing arithmetic keep ordinary evaluation.


Dense storage may also be allocated with a fill value and updated in place:

```rank
M = array shape Rows Columns fill 0
M Row Column = Value
M # Column = Values
```

An ordinary binding completes a finite array expression and makes its result
writable. Arrays have value semantics: changing `Writable` does not change
`Source`, including when `Source` is already stored.

```rank
Writable = Source
```

`Writable = Source copy` is also valid with `use sequences`. Keep `copy` when
it helps express the intent to take a snapshot; it is not required for array
independence or writability.

Contiguous slices of completed numeric buffers can share storage until either
array is written. A write then takes a private copy; the saved slice keeps its
original values. Temporary slices used inside expressions do not themselves
require a copy of the source.

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

## Scanning along an axis

`scan axis` accumulates along one axis. Without a seed it keeps the shape:

```rank
Balance = Factor scan * axis 0
Highest = Path scan max axis 0
```

`Factor` is a table with one row per year and one column per lane; `Balance`
has the running product of every column. The operator may be a symbolic one or
a named binary operation. The axis is a literal number, and the first item along
it is kept as it is. Every line along the other axes is scanned independently.

```rank
Balances = Factor scan * axis 0 with 1
RowTotals = Factor scan + rank 1 with 0
```

`with Seed` prepends the same rank-0 seed to every line and grows the selected
axis by one; accumulated results must also have rank 0. An empty selected axis
then has length 1, while any empty frame axis stays empty. The seed expression
is evaluated once. `rank R` selects the leading axis of each trailing rank-`R`
cell: axis `source rank - R`. Thus `rank 1` scans each row of a matrix and
`rank 2` scans each column. `R` is a positive integer literal no larger than the
source rank. Use one `axis` or one `rank`, followed by optional `with Seed`.
Symbols, named builtins and binary user functions accept the same modifiers;
callbacks receive individual elements rather than entire slices.

## Axis reductions

`reduce <op|fn>` also accepts `axis` with one or more distinct axes and an
optional seed, for example `M reduce add axis 0 with 0`. It folds the selected
elements in row-major order, preserving the other axes. The order of the axis
list does not change the fold order. `rank R` instead reduces each trailing
rank-`R` cell, for example `M reduce add rank 1 with 0`. `rank` and `axis` are
alternatives and precede `with`. Empty cells return the seed when supplied;
without one, symbolic identities still apply, while named folds require a seed.
An empty frame returns an empty result without invoking the callback.

`sum`, `mean`, `std`, `min`, `max`, `all` and `any` without modifiers reduce
every element. `axis` reduces only the named axes and preserves the remaining
axes in their original order:

```rank
Total = A sum
Rows = A mean axis 1
Columns = A mean axis 0
Spread = A std axis 0
Planes = T sum axis 0 2
Lows = A min axis 0
Highs = A max axis 1
Complete = Flags all axis 1
Present = Flags any axis 0
Loss = Pred mse Target
RowLoss = Pred mae Target axis 1
```

An axis list is treated as a set, so its written order does not affect the
result. Every axis must exist and may appear only once. An empty `sum` is zero;
empty `all` and `any` cells return `true` and `false`; an empty `mean`, `std`,
`min` or `max` raises `.EmptyReduction`. `mean` and `std` always return real
values. `std` uses the population denominator `N`.

`all` and `any` stop within each reduced cell as soon as its result is known.
Later elements of that cell are not read or checked. Each new demand of a
deferred axis reduction computes its cells again.

`rank` and `axis` answer different questions. `rank` chooses trailing cells and
applies the whole operation to every cell in the leading frame. `axis` names
the coordinate dimensions that the operation consumes.

The binary error metrics `mse` and `mae` first broadcast their two operands to
one shape. Without `axis` they average every squared or absolute difference.
With `axis` they average only the named axes and preserve the remaining frame:

```rank
Loss = Pred mse Target
PerSample = Pred mse Target axis 1
```

Their framed results are lazy. Empty reduced cells raise `.EmptyReduction`.
Standard binary functions may declare intrinsic ranks. Rank splits array
arguments into trailing cells, broadcasts their leading frames, and applies
the function to corresponding cells. An atomic or whole-value argument has an
empty frame and is reused for every cell of the other argument. `rank L R`
overrides the two cell ranks, including on infix arithmetic operators:

```rank
Tops = Scores max axis 1
Shift' = Scores - Tops rank 1 0
Exps = Shift exp
Totals = Exps sum axis 1
Weights = Exps / Totals rank 1 0
```

Here the matrix supplies rank-1 rows and the vector supplies rank-0 scalars.
Their leading row frames match; the scalar broadcasts within its row. No
transpose is needed. Without `rank`, arithmetic keeps trailing-axis broadcasting.
The tensor planner represents the two frame/cell broadcasts directly, retaining
the operands' row-major order.

The broader tensor direction includes:

```rank
matmul
max
exp
log
sqrt
round
sin
cos
tan
atan2
softmax
gelu
layernorm
```

The exact module split is still evolving.

## Determinant

`det` from `use linalg` has intrinsic rank 2 and computes the determinant of a
square numeric matrix:

```rank
D = A det
BatchDeterminants = Batch det
Planes = T det axis 0 2
```

Integer-only cells produce exact `integer` results. A cell containing any
`real` value produces a `real`. A singular cell returns zero, and the
determinant of a `0` by `0` matrix is one. A non-square cell raises
`.DimensionMismatch`; a nonnumeric element raises `.TypeError`. An ordinary
binding completes batched results; `BatchDeterminants' = Batch det` keeps a
recipe that recomputes on demand.

## Linear solve

`solve` from `use linalg` solves the equation `A * X = B` directly:

```rank
X = A solve B
```

`A` is a square rank-2 numeric matrix. `B` is either a numeric vector of
length `N` or a rank-2 matrix with shape `N K`; the real result preserves
the shape of `B`. The operation is eager. Incompatible shapes raise
`.DimensionMismatch`, singular coefficients raise `.SingularMatrix`, and
nonnumeric elements raise `.TypeError`.

The equation is the contract, not a particular factorization. An implementation
may choose an equivalent solver from known or detected matrix properties.
The current interpreter uses Gaussian elimination with partial pivoting.

## Matrix inversion

`inverse` from `use linalg` has intrinsic rank 2. It inverts a square numeric
matrix and returns a real matrix with the same shape:

```rank
B = A inverse
BatchInverse = Batch inverse
Planes = T inverse axis 0 2
```

The second expression applies to every trailing matrix cell. The third uses
axes 0 and 2 for each matrix, preserving axis 1 as its frame. The result
keeps the original axis positions. A
non-square cell raises `.DimensionMismatch`; a singular cell raises
`.SingularMatrix`. Ordinary binding completes every ranked matrix result;
`BatchInverse' = Batch inverse` keeps a recipe. Repeated demands recompute the
matrix results rather than retaining them implicitly.

## Symmetric eigendecomposition

`eigh` from `use linalg` decomposes one real symmetric matrix:

```rank
unpack Values Vectors = A eigh
```

`Values` contains the eigenvalues in ascending order. The matching eigenvectors
are the columns of `Vectors`, so `Vectors # j` belongs to `Values j`. The
operation returns eager real arrays. It accepts a square rank-2 numeric matrix;
shape errors raise `.DimensionMismatch`, nonnumeric or nonfinite elements raise
`.TypeError` or `.DomainError`, and an asymmetric matrix raises `.NotSymmetric`.
The current interpreter uses Jacobi rotations. Eigenvector signs and bases
inside repeated-eigenvalue subspaces are not otherwise canonicalized.

## Standard deviation

`std` from `use stats` computes population standard deviation:

```rank
Spread = Values std
Columns = Data std axis 0
Rows = Data std axis 1
```

It divides by `N`, always returns real values, and supports ordinary `rank` and
`axis` reduction. An empty cell raises `.EmptyReduction`; every demanded cell
must be finite and numeric.

## Covariance

`covariance` from `use stats` calculates sample covariance. By default, the
last axis contains observations, the preceding axis contains features, and all
earlier axes are independent batches:

```rank
Cov = Features covariance
BatchCov = Batch covariance
```

```text
Features Observations       -> Features Features
Batch Features Observations -> Batch Features Features
```

An explicit axis pair handles other layouts:

```rank
Cov = Samples covariance axis 1 0
BatchCov = T covariance axis 2 0
```

The first number selects the feature axis and the second selects the
observation axis. Both are zero-based, valid, and distinct. All remaining axes
become batch axes in their original order. This operation-specific `axis` form
already defines the cells and is not combined with `rank`.

Covariance divides by `N - 1`, always returns real values, and raises
`.InsufficientData` when the observation axis has fewer than two items. The
ordinary result is completed by `=`. Use `Cov' = Features covariance` to keep a
recipe; each observation recomputes. A full traversal shares feature means only
within its current batch. Independent cell reads, later traversals and retries
after failure start fresh. Assigning `Saved = Cov` retains the completed matrix.

## Sliding windows

Multidimensional `window` creates overlapping tensor cells without eagerly
copying them:

```rank
WindowShape = array 2 3
Blocks = M window WindowShape
Scores = Blocks reduce + rank 2 with 0
```

For source shape `4 5`, `Blocks` has shape `3 3 2 3`. The trimmed source axes
form the leading window-position frame and the requested window axes are
appended as trailing cells. This makes `rank 2` apply directly to each `2 3`
block.

Selected axes follow the operation:

```rank
Columns = M window 3 axis 1
Blocks = T window WindowShape axis 0 2
```

There must be one window size for every selected axis. The appended cell axes
follow the explicit axis order.

Stride and symmetric zero padding are contextual modifiers:

```rank
Blocks = M window WindowShape stride 2
Blocks = M window WindowShape padding 1
Blocks = M window WindowShape stride 2 padding 1
```

A scalar applies to every selected axis; a rank-1 integer array supplies one
value per selected axis. Strides are positive, padding is nonnegative, and the
defaults are one and zero. When `axis` is also present it follows these
modifiers. Padding is available for arrays and inserts integer zero beyond the
source boundary; `padding 1 with V` inserts `V` instead, for example
`with -infinity` before a `max` reduction. Position axes use the usual
convolution formula `max(0, floor((N + 2*P - W) / S) + 1)`.

## Shifting along an axis

`shift` moves the items of a tensor along one axis and keeps the shape:

```rank
Down = M shift 1
Right = M shift 1 with 9 axis 1
Up = M shift -1 axis 0
```

A positive count moves items toward higher positions and vacated positions read
integer zero or the `with` value. The axis defaults to zero and follows `with`.
The result is a lazy, read-only view.

## Addressing with a coordinate vector

A rank-1 coordinate array addresses one cell through `unpack`, and adding an
offset vector moves to a neighbor without repeating `(Y - 1)` for each axis:

```rank
Cell = array 1 1
Up = array -1 0
Next = Cell + Up
Value = M unpack Next
```

Write `M unpack (Cell + Up)` when the sum stays inline: `M unpack Cell + Up` adds
`Up` to the cell value instead. See
[Sequences and arrays](sequences-arrays.md#addressing-with-a-coordinate-vector).

## Rank-based application

The same `rank` mechanism used for arrays applies to tensor cells:

```rank
X normalize rank 1
```

For a row-wise table calculation:

```rank
Geo distance rank 1
```

An explicit axis list selects the cell, so non-trailing and non-contiguous
cells do not require a transpose:

```rank
rem T has shape 2 64 128
Rows = T normalize rank 2
rem two cells of shape 64 128

Planes = T normalize axis 0 2
rem 64 cells of shape 2 128
```

The [canonical rank rules](sequences-arrays.md#rank) define frame-axis order,
cell selection, broadcasting and result assembly, including array-valued results
and empty frames. A binary operation accepts `rank L R`, one rank per operand.
Keeping one side whole and taking the other item by item finds several values in one vector at once:

```rank
Kinds = "SAMFL" split ""
Index = Kinds find (Ops split "") rank 1 0
rem one position for every code
```

`M find Targets rank 1 0` pairs each row of `M` with its own target. Each cell
result here is a scalar position; other functions may return array cells.

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

`axis` explicitly lists the axes of each cell. The remaining axes are iterated. It is core contextual
vocabulary, not a reserved grammar keyword, and it comes before its numeric
arguments so they cannot be confused with addressing:

```rank
for Column j in M axis 0
  Column print
end

for Line i j in T axis 2
  Line print
end
```

The first binding receives the cell. Subsequent bindings receive coordinates
for the remaining frame axes in natural source order. Index bindings may be omitted.
Axis numbers are zero-based and unique, and this invariant must hold:

```text
number of frame axes + cell rank = tensor rank
```

Without `axis`, the frame axes are the leading axes in natural order. `rank 0`
yields atoms; a rank equal to the tensor rank yields the whole tensor once.
Iteration produces cells in row-major frame order.

A range selects a slice and an integer array selects arbitrary positions;
`#` keeps a whole axis, and `axis` names the axis for an index array:

```rank
Rows = M (1 till 4)
Columns = M axis 1 array 0 2 5
```

A range preserves one axis with the selected length. An integer index array
replaces the selected axis with its full shape. For example, a `2 3` index
array applied to axis 1 of a `4 5` matrix returns shape `4 2 3`. All other
axes keep their order and size.

## Outer

`outer` is a higher-order modifier: the operator or named binary function
immediately after it is applied to every pair of cells:

```rank
Sums = A B outer +
Grid = Values Values outer bxor
operation = min
Smallest = A B outer operation
```

Cell ranks belong to the operation, while `outer` combines the remaining
frames. Symbolic binary operations have intrinsic ranks `0 0`. The named
functions `band`, `bor`, `bxor`, `shl`, `shr`, `min` and `max` also declare
ranks `0 0`. User-defined binary functions default to `all all` and may declare
intrinsic ranks in their headers; see the [rank rules](sequences-arrays.md#rank).

The result shape is the concatenation of the left and right frame shapes. Thus
atom-pairing operations preserve all operand axes. Left frame axes come first
and the right frame varies fastest. The operation must accept two arguments and
currently must return a scalar for every pair.

Both operands must be finite. Ordinary binding completes the result; use
`Pairs' = A B outer operation` to keep a recipe. Each observation recomputes
the demanded pairs, including callback effects. An ordinary `Saved = Pairs`
binding retains the completed result. A deferred assignment does not make a
single-pass operand restartable; bind its completed data before reusing it.

For paired cells with broadcasting, use the
[ranked-call forms](sequences-arrays.md#rank). `outer` instead forms all pairs
using the supplied operation's intrinsic ranks.

A future axis-qualified cell view can be passed to `outer`: `axis` order will
define frame order and `rank` will define its cells. This will support pairings
such as every row of one matrix with every column of another as lazy views.
The expression syntax remains deferred because `axis` already introduces
selection. `outer` itself does not permute axes.

## Matrix multiplication

`matmul` from `use linalg` contracts one axis from each numeric array:

```rank
C = A matmul B
```

By default it contracts the last axis of `A` with the first axis of `B`.
The contracted dimensions must be equal. All remaining axes from `A` form
the leading result axes, followed by all remaining axes from `B`:

```text
2 3       matmul 3 4   -> 2 4
2 3       matmul 3     -> 2
3         matmul 3 4   -> 4
5 2 3     matmul 3 4   -> 5 2 4
```

Two vectors produce a scalar dot product, with exact integer accumulation when
both operands contain integers. An empty contraction returns integer zero.
The default call does not broadcast
or pair leading axes. Use explicit matrix-cell ranks for batched multiplication:

```rank
use linalg
A = array shape 8 1 2 3 fill 1
B = array shape 1 6 3 4 fill 2
C = A matmul B rank 2 2
rem C shape is 8 6 2 4; each value is 6
```

| Left shape | Right shape | Result with `rank 2 2` |
| --- | --- | --- |
| `8 2 3` | `8 3 4` | `8 2 4` |
| `8 1 2 3` | `1 6 3 4` | `8 6 2 4` |
| `0 2 3` | `1 3 4` | `0 2 4` |

Only the frames broadcast. The cells must still have matching contracted
sizes. Empty frames preserve the matrix result axes without multiplying any
cells; an empty contracted axis in a nonempty batch instead produces zeros.

An explicit pair selects a different contracted axis from each operand. The
first number belongs to the left operand and the second to the right:

```rank
C = A matmul B axis 2 0
```

Both axes are zero-based. Exactly two axes are required, and out-of-range axes
are errors. Scalar or nonnumeric operands are errors; unequal contracted
dimensions raise `.DimensionMismatch`.

A deferred binding such as `C' = A matmul B` computes output elements on
demand. Repeated demands recompute them; `C = A matmul B` stores the completed
array explicitly.
The calculation uses ordinary Rank numeric promotion: integer-only terms stay
integer, while a real term promotes that output element to real. A contraction
over an empty dimension produces zero for every output element.

`matmul` differs from `outer`: `outer` adds combination axes, while `matmul`
removes the selected compatible axes by summing their products.

## ML direction

High-level names such as `logistic`, `linear` and `cnn` have been useful as
temporary examples while stress-testing Kaggle workflows.

They are **not** treated as magical core primitives.

A current project goal is to implement logistic regression itself in Rank
using the tensor/array layer, and later use the same approach for more advanced
models.
