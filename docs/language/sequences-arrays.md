# Sequences and arrays

## Sequences

Ranges and algorithmic sources are sequences:

```rank
Range = 1 until 1000
Primes = primes
Fib = fibonacci to 4000000
```

Sequences are lazy by default. Constructing, transforming or filtering a
sequence builds a plan. A terminal operation such as `sum`, explicit
materialization, or iteration demands values from that plan. A terminal
operation that would consume an unbounded sequence is an error.

`fibonacci` starts with `1 2 3 5 8 ...`. Applied to an ordered algorithmic
source, `to` includes the boundary and `until` excludes it:

```rank
Fib = fibonacci to 100
```

`primes` starts with `2 3 5 7 11 ...`. It is infinite until bounded with `to`
or `until`, and supports ordinary zero-based sequence addressing:

```rank
BelowTwenty = primes until 20
SixthPrime = primes 5
```

Sequence sources may accept bounds, filters and reductions in their own plan.
For example, applying an `even` mask to `fibonacci` allows the source to produce
only `2 8 34 ...`. A source that has no specialized implementation uses the
general lazy operation with the same observable result.

Boundary operations such as `from`, `to` and `until` may be pushed into the
source by the execution planner when the source can seek efficiently.

## Explicit materialization

Postfix `array` consumes a sequence and stores its yielded items in a dense
rank-1 array:

```rank
Values = 3 weird array
```

Materialization is eager and preserves each yielded value as one array item;
it does not flatten yielded collections. An empty sequence produces an array
with shape `0`. A single-pass generator is consumed by this operation.

A sequence known to be infinite is rejected. A sequence whose finiteness is
unknown is evaluated until it ends, so materialization may raise a delayed
error or fail to terminate. No module import is required because `array` is the
core array constructor and conversion.

Position disambiguates the three uses of `array`:

```rank
A = array 2 7 11       rem construct
Picked = A array 2 0   rem select
Copy = Source array    rem materialize
```

Values after `array` form a selector; postfix `array` at the end of the
expression materializes.

Postfix `copy` accepts a material or lazy array, eagerly evaluates all of its
cells and returns independent writable dense storage with the same shape:

```rank
use sequences
Writable = Source copy
```

Changing the copy does not change the source. `copy` does not accept a
sequence; postfix `array` remains the operation that materializes a finite
sequence into a rank-1 array.

## Sliding windows

`window` produces every overlapping, contiguous cell of a fixed size. The
source and size precede the operation:

```rank
Pairs = Text 2 window
Windows = Values Width window
```

Text windows are text values, so ordinary text comparison and addressing keep
working. Windows over a finite numeric vector form a rank-2 tensor whose first
axis selects the window and whose trailing axis contains the window cell. The
operation is lazy and does not copy all overlapping cells before they are
demanded. An unbounded sequence may likewise produce windows indefinitely.

For a tensor, a rank-1 integer array supplies one size per selected axis:

```rank
WindowShape = array 2 3
Blocks = M WindowShape window
```

Without `axis`, the size array must cover every tensor axis. If `M` has shape
`4 5`, the example has shape `3 3 2 3`: window-position axes come first and
window-cell axes are appended last.

`axis` selects and orders a subset of source axes:

```rank
Columns = M 3 window axis 1

WindowShape = array 2 3
Blocks = T WindowShape window axis 0 2
```

There must be one size for each selected axis. Axis numbers are zero-based and
unique. Source axes retain their original order in the position frame; appended
window axes follow the stated `axis` order. A scalar size without `axis` is
valid only for a rank-1 value.

Window sizes are positive integers. Only complete windows are returned. If a
window is larger than its source axis, that position axis is empty. Windows are
read-only views of their source.

## Shape and size

An atom has shape `[]`. A finite sequence has shape `[Size]`. A tensor stores a
flat sequence of atoms together with its rectangular shape `[D1, D2, ...]`.

A lazy sequence carries one of three size states:

- `exact`: its length is known;
- `unknown`: its length and possibly its finiteness are not known;
- `infinite`: it is proven to have no finite length.

Requesting the shape of an `unknown` sequence is a demand point and iterates it;
that request may not terminate. Requesting a finite shape from an `infinite`
sequence is an error.

`shape` from `sequences` returns every dimension as a rank-1 integer array:

```rank
Dims = A shape
unpack Rows Columns = A shape
```

Text, queues and finite lazy sequences have one dimension. `len` returns the
leading-axis length by default. An `axis` modifier selects another tensor axis:

```rank
Rows = A len
Columns = A len axis 1
```

Axis numbers are zero-based. Asking for a missing axis is an error. `axis` is a
general operation modifier; each operation defines what selecting axes means.

## Array construction

`array` is the common constructor for rectangular arrays of every rank. A
rank-1 array is a vector, a rank-2 array is a matrix, and arrays of rank 3 or
higher are tensors.

A vector is written on one line. Every value after `array` is an element, so
the constructor remains unambiguous beside Rank's whitespace-based addressing:

```rank
A = array 2 7 11 15
Pair = array J i
```

Multidimensional arrays use a block. `shape` is followed by the dimensions,
then the elements are supplied in row-major order:

```rank
M = array shape 2 3
  1 2 3
  4 5 6
end
```

The same form works for any number of dimensions:

```rank
T = array shape 2 2 2
  1 2 3 4
  5 6 7 8
end
```

Dimensions are nonnegative integers. The number of elements must equal the
product of the dimensions. Line breaks inside the block are formatting only;
they do not add an axis or change the declared shape.

`pad` fills every cell with one evaluated value and therefore needs no block:

```rank
Dist = array shape Rows Columns pad -1
```

The dimensions follow the same nonnegative-integer rule. A zero dimension
creates an empty material array with the declared shape.

`reshape` constructs a dense array dynamically from existing values:

```rank
Shape = array Rows Columns
M = Values Shape reshape
```

It is provided by `use sequences`. The shape must be a rank-1 array of
nonnegative integers. Values are consumed in row-major order, and their count
must exactly equal the product of the dimensions. Arrays, queues, finite
sequences and Unicode text can be reshaped. An unbounded sequence is an error.
An empty shape describes a scalar and therefore requires one value; a zero
dimension describes an empty array.

Array addressing uses one zero-based index per axis:

```rank
X = A i
Y = M i j
Z = T i j k
```

A material dense array can be changed through the same address:

```rank
M Row Column = Value
M # Column = Values
M # Column *= -1
M Row = 0
```

An incomplete address preserves its trailing axes, and `#` preserves the axis
at its position. A scalar right side fills the selected region. An array right
side must have exactly the selected shape or `.DimensionMismatch` is raised.
Negative and out-of-bounds indices are errors. Addressed assignment supports
`=` and every compound assignment operator. Assignment changes the existing
array object, so every alias of that array observes the new cells. The target,
selectors, previous cell values and right side are evaluated before any write.
This gives both ordinary and compound assignment snapshot semantics when
selections overlap.

Lazy arrays produced by operations such as `outer` and `window` are not
writable. Copy a finite result explicitly with postfix `copy` before changing
its cells.

Contiguous slices use `from` after the value. Arbitrary positions use an integer
array as the selector:

```rank
Part = A from 2 until 6
Picked = A array 4 1 1
Rows = M axis 0 from 1 to 3
```

Ranges and integer arrays preserve the selected axis. A scalar integer removes
its axis. The complete selector rules are defined in
[Values and addressing](values-addressing.md).

## Selection with boolean masks

Selection uses Rank's normal addressing model.

```rank
Mask = A greater 0
B = A Mask
```

The mask is an ordinary first-class value. It can be named, reused and combined
before it is applied.

```rank
Mask = N multiple by 3
Mask or= N multiple by 5

Selected = N Mask
```

Masks are demand-driven by default. Creating a mask builds a deferred boolean
plan; it does not require an immediate boolean array. Combining masks with
`and`, `or`, `xor` or `not` also remains deferred.

Applying a mask is a demand point, but it does not by itself require full
materialization. An implementation may stream the selected values, fuse the
mask with a following operation, or push predicates into a source such as a
table scan. It may also materialize a mask eagerly when that produces the same
observable result.

A lazy sequence mask retains its source and is itself a selected sequence when
used by a sequence operation. The explicit addressing form remains valid, and
the two examples below are equivalent:

```rank
Mask = Fib even
Answer = Fib Mask sum

Answer = Fib even sum
```

Iteration, indexing, reductions and transformations such as `window` consume
the matching source values. Boolean composition still combines the deferred
predicates. A materialized boolean array does not retain a source and therefore
still needs an explicit value on its left when used for selection.

Reusing a mask does not promise that its computed bits are cached. A mask
captures the logical values of its operands when it is created, rather than
looking up later assignments to their variable names. This snapshot rule does
not require copying the underlying storage.

Expressions deferred inside a mask must be pure. Operations with observable
side effects are not allowed there, so an implementation may change evaluation
order, fuse operations or recompute values without changing program meaning.

Addressing does not mutate `A` or `N`.

## Ordering and uniqueness

`sort`, `argsort` and `unique` have intrinsic rank 1. `sort` and `unique`
preserve text as text and a rank-1 array as a rank-1 array:

```rank
Letters = "caab" sort
Distinct = Letters unique
rem Letters is "aabc"; Distinct is "abc"
```

Text is ordered by Unicode code point. Arrays may contain one comparable
scalar type: numbers, text, booleans or symbols. Integers and real numbers form
one numeric ordering. `unique` preserves the first occurrence. It also accepts
queues, sets and lazy sequences; sequence filtering stays lazy.

`argsort` returns the stable, zero-based permutation that would sort each
rank-1 cell. Text produces an integer vector. An array produces an integer
array of the same shape:

```rank
Order = (array 30 10 20) argsort
rem Order is array 1 2 0

Rows = M argsort
Columns = M argsort axis 0
```

Without `axis`, intrinsic rank 1 means that a tensor is ordered independently
along its last axis. `axis N` instead orders every vector along axis `N` and
places the local source positions in the same tensor shape. The source is not
changed. A missing axis or mixed incomparable values in one vector is an
error.

`sort by` orders a finite rank-1 collection by a separate key. A sequence of
field symbols forms a lexicographic key for records:

```rank
Sorted = Events sort by .time .delta
```

A single unary function may compute the key instead:

```rank
Sorted = Values sort by magnitude
```

`argsort by` accepts the same sources and keys but returns their zero-based
source positions:

```rank
Order = Events argsort by .time .delta
Order = Values argsort by magnitude
```

Every key component must be a comparable scalar. Values at the same key keep
their source order, and a key function runs exactly once per value in source
order. The operation materializes a new rank-1 array and does not change its
source. It accepts rank-1 arrays, queues, sets, multisets and finite sequences;
an unbounded sequence is an error. Field sorting requires records and reports a
missing field as `.Missing`. A compound source expression must be parenthesized.

## Elementwise arithmetic

Arithmetic on compatible arrays is elementwise:

```rank
C = A + B
Squares = Range * Range
Powers = Bases ** Exponents
Pred = Pred - 1
```

Array operands use trailing-axis broadcasting. Shapes are aligned from the
right; corresponding dimensions are compatible when they are equal or either
dimension is `1`. Missing leading dimensions behave as dimensions of size `1`.
The result has the larger compatible size on every axis:

```rank
M = array shape 2 3 pad 1
Row = array 10 20 30
Result = M + Row
rem Result shape is 2 3
```

Broadcast results are lazy and cached. Incompatible shapes raise
`.DimensionMismatch`. Scalar broadcasting is the rank-0 case of the same rule.
Sequences retain their elementwise zip behavior and do not use tensor
broadcasting.

Because scalar `+` concatenates two text values, the same array rule provides
elementwise text concatenation and scalar broadcasting:

```rank
Labels = (array "A" "B") + "!"
rem A! B!
```

`**`, `%` and comparisons are also elementwise over compatible arrays:

```rank
M3 = N % 3 equal 0
```

## Operation modifiers

An operation may be followed by a word that changes how it is applied:

```rank
Total = A + reduce
Prefix = A + scan
Products = A B * outer
Cells = A F rank 0
```

The trailing modifier binds the operation and its operands as one expression.
In `A B * outer`, `A B` is not evaluated first as addressing.

## Each

`each` applies a scalar function to every atom while preserving shape:

```rank
Numbers = Text integer each
Flags = Values prime each
```

`each` is reserved as the friendly spelling of rank-0 application. Whether it
is an exact alias for `rank 0` in every value model, especially for text,
tables and nested values, remains open. The examples above are design sketches
until that equivalence is settled.

## Rank

General cell-wise application follows J-like trailing-cell semantics:

```rank
A F rank 0
A F rank 1
A F rank 2
```

Example:

```rank
Rows = Matrix normalize rank 1
```

Every function declares an intrinsic rank for each supported arity. Without an
explicit modifier, that rank determines the cells it receives. `rank R`
overrides the unary rank: if the argument rank is greater than `R`, the function
is applied to each trailing `R`-cell and the leading frame is preserved. If the
argument rank is at most `R`, the function receives the whole argument once.
Rank values are currently nonnegative integers.

An explicit `axis` list before `rank` names the frame axes. The remaining axes,
kept in their original order, form the cell passed to the unary function:

```rank
rem T has shape 2 64 128
A = T F rank 2
rem frame 2, cells 64 128

B = T F axis 1 rank 2
rem frame 64, cells 2 128
```

The axis order also determines the frame order in the result. For a tensor of
shape `2 3 4 5`, `T F axis 1 3 rank 2` applies `F` to `2 4` cells and produces
results in a `3 5` frame. The number of frame axes plus the cell rank must equal
the tensor rank. Frame axes are zero-based, unique and in bounds.

Every cell result must have the same shape. Scalar results leave only the frame
shape; array results append their shape to the frame. Source cells and the
assembled result are lazy views, and a demanded cell result is cached.

For example, `integer` has intrinsic unary rank 1. It converts a complete text
value by default, while an explicit rank 0 converts its character atoms:

```rank
Value = "1203" integer
Digits = "1203" integer rank 0
rem Value is 1203; Digits are 1 2 0 3
```

Rank-0 application over a lazy sequence remains lazy. Binary rank
specifications remain deferred.

## Reduce

A reduction collapses values:

```rank
Total = A + reduce
Product = A * reduce
```

Without an explicit rank, reduction consumes the complete finite value in
row-major order. `reduce rank R` instead reduces every trailing rank-`R` cell
to one atom while preserving its leading frame:

```rank
RowTotals = M + reduce rank 1
BlockProducts = Blocks * reduce rank 2
```

Reduction is a left fold. A scalar and a rank-0 cell reduce to themselves.
The current symbolic reducers are `+`, `-`, `*`, `**`, `/`, `//`, `%`, `and`,
`or` and `xor`.
Empty `+`, `*`, `and`, `or` and `xor` reductions produce `0`, `1`, `true`,
`false` and `false` respectively. Other operations reject an empty cell. A
reduction of an unbounded sequence is an error.

Named reductions use the same data-first style:

```rank
Total = A sum
Largest = A max
Average = A mean
```

Boolean collections have named reductions in `use sequences`:

```rank
Every = Mask all
Some = Mask any
TrueCount = Mask count
Rows = Flags all axis 1
RowCounts = Flags count axis 1
```

`all` is equivalent to `and reduce`; `any` is equivalent to `or reduce`.
`count` returns the integer number of `true` values. All three operations
require boolean cells. `all` and `any` short-circuit as soon as the result is
known, while `count` examines the complete cell. An empty collection produces
`true` for `all`, `false` for `any` and zero for `count`. All three support
`rank` and `axis`. A known unbounded sequence is rejected.

`min` and `max` reduce one finite collection or compare two numeric values:

```rank
Largest = A max
Bound = Low High max
```

Their binary form returns one operand and is not an elementwise clamp.

## Scan

Prefix accumulation:

```rank
Prefix = A + scan
```

## Outer

`outer` is a higher-order modifier. It applies the operator or named binary
function immediately before it to every pair of cells:

```rank
Sums = A B + outer
Products = A B * outer
Grid = Values Values bxor outer
Operation = min
Smallest = A B Operation outer
```

Cell ranks belong to the operation; `outer` combines the remaining frames.
Symbolic binary operations have intrinsic ranks `0 0`. The named functions
`band`, `bor`, `bxor`, `shl`, `shr`, `min` and `max` also declare ranks `0 0`.
User-defined binary functions currently default to `all all`; syntax for
declaring their intrinsic ranks remains deferred.

The result shape is the concatenation of the left and right frame shapes.
Therefore, if `A` has shape `2 3` and `B` has shape `4 5`, the result of atom
pairing `A B * outer` has shape:

```text
2 3 4 5
```

`outer` combines axes. `matmul` contracts axes.

The left frame axes come first and the right frame varies fastest. The operation
must accept two arguments and currently must return a scalar for every pair.
Both operands must be finite and restartable.

Construction is lazy and may compute a demanded pair again. A named function
supplied to `outer` must therefore be pure: its result and observable behavior
may depend only on its arguments and immutable captured values. The runtime does
not yet prove this property; static effect analysis is tracked separately as
tooling work.

Explicit binary rank overrides remain deferred.

An axis-qualified cell view may become an operand of `outer`. Its `axis` order
will define frame order and its `rank` will define the cells, allowing rows of
one tensor to be paired with columns of another without moving data. The
expression syntax is deferred because `axis` already introduces selection;
`outer` itself does not permute axes.

Applying a same-shaped boolean mask to a tensor returns a rank-1 lazy sequence
of the selected atoms in iteration order. Tables retain their separate
row-selection rule.
