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

`from` gives an ordered source an inclusive lower value bound:

```rank
Candidates = primes from 100
First = Candidates 0
rem First is 101
```

This is a source boundary rather than a positional slice. `primes` seeks to
the first candidate at least equal to the bound, and `fibonacci` advances its
recurrence to the first matching value. The result remains unbounded unless it
also receives `to` or `until`. A source that cannot interpret a lower value
bound reports an error.

The existing `A from Start until End` form remains positional slicing.

Sequence sources may accept bounds, filters and reductions in their own plan.
For example, applying an `even` mask to `fibonacci` allows the source to produce
only `2 8 34 ...`. A source that has no specialized implementation uses the
general lazy operation with the same observable result.

Sequence plans expose lower- and upper-bound hooks, so other ordered sources
can implement `from`, `to` and `until` without enumerating discarded prefixes.

## Take and drop

`take` keeps at most the requested number of leading items. `drop` skips that
many items and returns the remaining tail. Both belong to `sequences`:

```rank
use sequences
FirstFive = primes 5 take
NextFive = primes 5 drop 5 take
Values = NextFive copy
Prefix = "abcdef" 3 take
Tail = "abcdef" 3 drop
```

The count must be a nonnegative integer. Counts larger than a finite source
are clamped: `take` returns all its items and `drop` returns an empty result.
`take 0` reads nothing; `drop 0` preserves all items. Text counts Unicode code
points. Arrays return lazy views along their leading axis, preserving the
remaining dimensions. Writes to the source are visible through those views;
use `copy` for an independent snapshot.

Sequences remain lazy, including user generators. `take` stops without
requesting an extra item and closes the source iterator. `drop` traverses the
skipped prefix when demanded. Neither operation makes a single-pass source
replayable. `take` bounds an infinite source by count; `drop` alone leaves it
infinite. Materializing a bounded sequence still uses `copy` or postfix `array`.

`from` on an ordered source sets a value bound. For example,
`(primes from 10) 3 take copy` gives `11 13 17`, while
`primes 10 drop 3 take copy` gives `31 37 41`. General generators and mapped
sequences do not acquire value bounds through `take` or `drop`. Numeric ranges
already specify their starting value, as in `10 to 20`.

## Explicit materialization

Postfix `array` consumes a sequence and stores its yielded items in a dense
array:

```rank
Values = 3 weird array
```

Materialization is eager. Scalar or record items produce a rank-1 array.
Array items with the same shape are stacked along a new leading axis: `N`
items of shape `3` produce shape `N 3`, and `N` items of shape `2 3` produce
shape `N 2 3`. Different item shapes, or a mixture of arrays and non-arrays,
raise `DimensionMismatch`. An empty sequence has shape `0`. A single-pass
generator is consumed, and each yielded array is copied before requesting
the next item.

A sequence known to be infinite is rejected. A sequence whose finiteness is
unknown is evaluated until it ends, so materialization may raise a delayed
error or fail to terminate. No module import is required because `array` is the
core array constructor and conversion. A SQLite-backed table view also uses
postfix `array` to execute its query and produce a rank-1 array of object rows;
see [Tables](tables.md#sqlite).

Position disambiguates the three uses of `array`:

```rank
A = array 2 7 11       rem construct
Picked = A array 2 0   rem select
Copy = Source array    rem materialize
```

Values after `array` form a selector; postfix `array` at the end of the
expression materializes. A materialized value may continue through ordinary
postfix operations on the same line:

```rank
Count = Values array len
Values array len print
```

When `array` has following words, the evaluated receiver resolves the apparent
overlap: a sequence is materialized and the remaining words continue the
application chain, while an array uses `array` and its following values as a
selector. This keeps `A array 2 0` unchanged.

Postfix `copy` accepts a material or lazy array, eagerly evaluates all of its
cells and returns independent writable dense storage with the same shape:

```rank
use sequences
Writable = Source copy
```

Changing the copy does not change the source. `copy` also consumes a finite
sequence, using the same stacking rule as postfix `array`:

```rank
fun rows
  yield array 1 2 3
  yield array 4 5 6
end
Rows = rows
Matrix = Rows copy
Matrix shape          rem 2 3
Matrix transpose      rem requires an array
```

`Rows` stays a stream of row values until explicitly copied. Iteration can
consume one row at a time, including rows with different shapes. `shape` on
the stream describes its one-dimensional sequence length; `Matrix shape`
describes the materialized tensor. `transpose` does not implicitly consume a
sequence: use `copy` first. User generators remain single-pass.

## Derived values and mutation

Built-in pure tensor computations reuse demanded cells while their source
arrays are unchanged. Naming a derived array is one of those sources' bindings,
so a later write to a source builds a new value for the written name and leaves
the named result alone:

```rank
use sequences
A = array 1 2
B = A * 2
Before = B 0
A 0 = 5
After = B 0
```

`Before` and `After` are both `2`, and `A` is `5 2`. Naming the last reader in
a chain freezes every source it reads through. Write the expression again to
compute a result from current values.

`copy` forces storage for a lazy result. It is no longer needed to keep one
name safe from another's writes; see
[values and sharing](values-addressing.md#values-and-sharing).

This applies to arithmetic and broadcasting, numeric transformations, axis
reductions, transpose and slice views, array windows, matrix multiplication,
and covariance. A change can conservatively invalidate the whole derived
array; there is no promise of per-cell invalidation. Errors are not retained
as successful cached values. An unrelated array write does not discard valid
computed cells.

A cached result is therefore invalidated by writes that value semantics does
not redirect: writes made through the embedding's own storage, and writes to an
array that only unnamed readers inside the same expression observe. This cache
policy does not introduce implicit replay of I/O or generators. User-function
effect and capture analysis is a separate concern from the built-in pure tensor
operations described here.

For TypeScript embedding, `createArraySnapshot` makes owned array storage.
Writes through its public `items` invalidate dependent computations. Plain
host arrays or unknown mutable nested values have no reliable mutation proof;
pure computations over them use live reads rather than retain an unsafe cache.

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

`stride` moves by more than one position and `padding` adds symmetric zero
padding before positions are chosen:

```rank
Blocks = M WindowShape window stride 2
Blocks = M WindowShape window padding 1
Blocks = M WindowShape window stride 2 padding 1
```

Each value may instead be a rank-1 integer array with one item per selected
axis. `stride` comes before `padding`, and `axis` follows both when they are
combined. Strides must be positive and padding must be nonnegative. Their
defaults are one and zero. Nonzero padding is defined only for arrays and
inserts integer zero outside the source; text, queues and sequences still
support stride.

For source length `N`, window width `W`, stride `S` and padding `P`, the
position-axis length is `max(0, floor((N + 2*P - W) / S) + 1)`. Windows remain
lazy, read-only views of their source and the conceptual zero border.

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

`default` fills every cell with one evaluated value and therefore needs no block:

```rank
Dist = array shape Rows Columns fill -1
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

A lazy sequence mask contains one boolean per source item. Display, iteration,
indexing, `count`, `any`, `all`, `copy`, and postfix `array` all consume those
booleans. Selection is explicit:

```rank
Mask = Fib even
Selected = Fib Mask
Answer = Selected sum
```

Numeric operations cannot use booleans, so they read the source items the mask
selects instead: `sum`, `min`, `max`, `lcm`, `mean`, `median`, `std`,
`variance`, `skewness`, `quantile` and `percentile`. A pipeline therefore reads
like a calculator, and both lines below give 44 for `Fib = fibonacci to 100`:

```rank
Answer = Fib even sum
Answer = Fib (Fib even) sum
```

The mask retains its source so explicit selection can push the predicate into
that source without allocating a boolean array. This does not change the mask's
values. Bound the source before creating a mask, or bound the explicitly selected
sequence when its source supports value bounds. A boolean mask itself does not
inherit numeric `from`, `to`, or `until` bounds from its source.

Reusing a mask does not promise that its computed bits are cached. A mask
captures the logical values of its operands when it is created, rather than
looking up later assignments to their variable names. This snapshot rule does
not require copying the underlying storage.

Expressions deferred inside a mask must be pure. Operations with observable
side effects are not allowed there, so an implementation may change evaluation
order, fuse operations or recompute values without changing program meaning.

Addressing does not mutate `A` or `N`.

## Filter clause

`filter` selects from a value without naming it twice. The filtered value is
the elided subject of the condition, so a leading comparison operator takes it
as the left operand:

```rank
Large = N filter greater 5
Ordinary = N filter not equal 5
Known = N filter in primes
```

Any other condition is a predicate applied to the value:

```rank
Even = N filter even
Palindromes = Products filter palindrome rank 0
```

A predicate follows the ordinary rank rules, so `rank` and `axis` choose the
cells it receives and therefore the axis the result is selected along. A
predicate over whole cells keeps the frame axis, which selects rows or columns
rather than atoms:

```rank
rem M has shape 3 2
Heavy = M filter row_total rank 1
rem Heavy has shape 2 2: the rows the predicate kept

Wide = M filter column_total axis 1 rank 1
rem Wide has shape 3 1: the columns the predicate kept
```

Without a cell rank the predicate applies to atoms, the frame is the whole
shape, and the result is the selected atoms as a rank-1 value. A frame of two
or more axes is not supported yet.

Conditions combine with `and`, `or` and `xor` inside one line. A block combines
complete lines with `and`, as a table condition block does:

```rank
Kept = N filter
  greater 2
  even
end
```

A condition that supplies its own operands is left alone, so an existing mask
or a full comparison still works:

```rank
Kept = N filter (N greater Limit)
```

A bare name is a predicate when it names an operation and the mask itself when
it names data, so a mask computed earlier reads the same with or without
parentheses:

```rank
Mask = N greater 5
Kept = N filter Mask
```

`filter` over a table keeps the table form even when its condition names no
column, because only that form returns rows that are still a table. A table is
a SQLite view or a rank-1 value of rows, and filtering one needs `use tables`.

Filtering a lazy sequence stays lazy, and filtering an array yields a lazy
selection. Materialize it with `copy` or postfix `array` when the result must
be an array.

A condition extends to the end of its line, so a following operation needs
parentheses:

```rank
Total = (N filter even) sum
Values = (N filter greater 5) array
```

`filter` is source syntax over the mask model above, not a separate kind of
value, and it does not change its input. It does not replace a named mask: a
mask can be built from one value and applied to another, which a filter
condition cannot express, because the condition's subject is the filtered
value itself.

```rank
Mask = Labels equal Wanted
Cluster = Points Mask
```

A condition that names a column is a table query instead; see
[Tables](tables.md). Filtering a plain array or sequence needs no `use tables`.

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

Directions are symbols and may be written for the whole sort or for individual keys:

```rank
Sorted = Values sort .descending
Order = Values argsort .descending
Rows = Events sort by .cost .descending .name
```

`.ascending` is the explicit spelling of the default direction. In `sort by`
and `argsort by`, a direction belongs to the preceding field or function key.
Descending reverses comparison, preserving the order of ties in arrays. It
works for text and date keys as well as numbers. Plain directions also compose
with intrinsic rank, explicit rank, and `argsort axis`; put direction after
the modifiers. Named array tables retain their header through field sorting.
SQLite emits DESC for descending keys and still needs explicit tie-breakers
for a deterministic order among equal keys. Keep sorting as the final SQL
operation before output when order is required.

`Mask TrueValues FalseValues choose` selects a value at each position. A
scalar boolean selects one branch; arrays broadcast by the usual trailing-axis
rules and produce a lazy array. Only the chosen branch is read at each cell.
The mask must contain booleans, and an absent mask cell gives an absent result
cell. Incompatible shapes are errors.

```rank
Rate = Guest GuestRate MemberRate choose
```

When the operands are SQLite expressions from one view, `choose` builds a
parameterized `CASE` expression. It does not read rows. An SQL `NULL` condition
stays `NULL` instead of selecting the false branch.

Every key component must be a comparable scalar. Values at the same key keep
their source order, and a key function runs exactly once per value in source
order. The operation materializes a new rank-1 array and does not change its
source. It accepts rank-1 arrays, queues, sets, multisets and finite sequences;
an unbounded sequence is an error. Field sorting requires object rows or records.
Absent cells sort after present cells; a field absent from every row and from
the table schema reports `.Missing`. A compound source expression must be
parenthesized.

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
M = array shape 2 3 fill 1
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
Total = A + reduce with 0
Prefix = A + scan with 0
Tree = A + segment
Products = A B * outer
Cells = A F rank 0
```

The trailing modifier binds the operation and its operands as one expression.
In `A B * outer`, `A B` is not evaluated first as addressing.
A completed modified operation can feed the next operation in the same chain:

```rank
Total = "1203" integer rank 0 sum
Prefix = A + scan with 0
Total = Prefix sum
Total = A B * outer sum rank 1 sum
Total = M sum axis 0 sum
```

`rank` consumes its integer argument; `axis` consumes its axis numbers (and
an optional `rank R`). The following operation receives the modified result.
`with` consumes one seed or identity operand before the chain continues.
For example, `A + scan with 0 sum` sums the scan results. `segment`
constructs the algorithmic collection described in
[Collections](collections.md). Operands are evaluated once. Parentheses remain
available to make grouping explicit.


## Each

`each` applies a scalar function to every atom while preserving shape:

```rank
Numbers = Text integer each
Flags = Values odd each
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

Rank-0 application over a lazy sequence remains lazy.

### Binary comparison rank

Infix comparisons keep their elementwise behavior. Postfix comparisons accept
an explicit cell rank and return one boolean for each pair of cells:

```rank
A equal B
A B equal rank 0
A B equal rank 1
A B equal rank 2
```

`rank 0` compares individual array elements. `rank 1` compares whole vectors,
or corresponding trailing rows of matrices. `rank 2` compares whole matrices.
A rank at least as large as an operand's array rank uses that operand whole.
`equal` and `not equal` compare cell shapes and nested values. `less`, `greater`,
`at least` and `at most` order cells lexicographically by their items in storage
order: the first difference decides, a matching shorter prefix comes first,
and shape dimensions break ties when all items match. Incompatible scalar
families still raise `.TypeError`. Text remains an atomic value in these binary
comparisons.

The leading frame shapes use trailing-axis broadcasting. For example, a
matrix and a vector with `rank 1` compare every matrix row with that vector.
Incompatible frame shapes raise `.DimensionMismatch`. Different cell shapes
are unequal; they are not broadcast inside a whole-cell comparison. Results
are lazy over array frames and reflect changes to their source arrays.

An explicit `axis` list names frame axes for **both** array operands, retaining
the listed order. The remaining axes form each cell:

```rank
A B equal axis 0 rank 1
A B equal axis 1 rank 1
A B less axis 1 rank 1 count
```

For matrices these compare rows, columns, and count columns of `A` that sort
before the corresponding columns of `B`. Axis numbers must be unique and in
bounds; the number of frame axes plus the cell rank must equal each operand's
array rank. Explicit axes require arrays on both sides.

Sequences stay lazy at `rank 0`; a higher rank materializes a bounded sequence
for comparison as one vector. Known infinite sequences are rejected for a
whole-vector comparison. These explicit binary forms currently apply to the
six comparison operators above; general binary function rank remains deferred.

## Reduce

A reduction collapses values:

```rank
Total = A + reduce with 0
Product = A * reduce
```

Without an explicit rank, reduction consumes the complete finite value in
row-major order. `reduce rank R` instead reduces every trailing rank-`R` cell
to one atom while preserving its leading frame:

```rank
RowTotals = M + reduce rank 1 with 0
BlockProducts = Blocks * reduce rank 2
```

`with Seed` supplies an explicit initial accumulator. The seed is combined with
the first value, reused independently for every `reduce rank R` cell, and
returned unchanged for an empty cell. Reduction is a left fold. Without
`with`, a scalar and a rank-0 cell reduce to themselves.
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

Numeric sets also support `sum`, `min` and `max`. Duplicate insertion remains
idempotent, so each distinct set member contributes once.

Boolean collections have named reductions in `use sequences`:

```rank
Every = Mask all
Some = Mask any
TrueCount = Mask count
Rows = Flags all axis 1
RowCounts = Flags count axis 1
```

`all` is equivalent to `and reduce with true`; `any` is equivalent to
`or reduce with false`.
`count` returns the integer number of `true` values. All three operations
require boolean cells. `all` and `any` short-circuit as soon as the result is
known, while `count` examines the complete cell. An empty collection produces
`true` for `all`, `false` for `any` and zero for `count`. All three support
`rank` and `axis`. A known unbounded sequence is rejected.

A lazy sequence mask is also accepted by `count`. It counts its `true` values,
just as it does for a boolean array.

A finite lazy source may define a direct cardinality count. The numbers module
uses this hook for `N divisors count`; other numeric sequences still fail the
boolean-cell requirement.

Postfix `min` and `max` reduce one finite collection. Infix binary forms choose
between numeric values and broadcast over arrays:

```rank
Largest = A max
Bound = Low max High
Clamped = Values max 0
```

Binary chains associate from the left. `axis` and `rank` modify the postfix
reduction; the binary form already follows ordinary elementwise broadcasting.

Infix calls resolve the function normally, after evaluating the left and right
operands. A user-defined `min` or `max` takes precedence, even without
`use numbers`. For example, after `fun max A B` returning `A + B`, both
`3 max 4` and `3 4 max` return `7`. A named builtin (`Op = max`) supports
the same lazy binary broadcasting as infix calls. Equal numeric operands
preserve the left operand, including its integer/real representation.

## Scan

Prefix accumulation:

```rank
Prefix = A + scan with 0
```

`scan with Seed` returns the seed followed by every left-to-right accumulated
value. Its result therefore has one more item than the source; an empty source
returns an array containing only the seed. This form makes prefix tables start
at index zero without a separate allocation or mutation. Without `with`, the
first result remains the first source value and an empty source returns an empty
array for compatibility.

`scan` accepts a rank-1 array, queue, text or sequence. An array, queue or text
produces a material rank-1 array. A sequence produces another lazy sequence, so
an unbounded source is valid when a later operation requests only a finite
prefix or a particular position. Higher-rank arrays are rejected. `scan`
currently has no `rank` or `axis` form.

A binary user function can also accumulate states:

```rank
States = Steps next scan with Start
Prefixes = Steps next scan
```

`next State Step` receives the previous state and the next source item. The
seed is the first result. Without a seed, `Steps next scan` starts from the
first source item. The function is resolved once when the scan is created;
sequence sources remain lazy.

## Short-circuiting selection

A rank-1 value and an aligned boolean mask support three ordered operations:

```rank
Match = Values first where Mask
Position = Values first index where Mask
Prefix = Values take while Mask
```

`first where` returns the first value selected by the mask. `first index where`
returns its zero-based position. Both stop reading as soon as the mask first
produces `true`. If no position matches, they raise `.Missing`, so `default`
can provide a fallback.

`take while` returns the leading values for which the mask remains `true` and
stops before the first `false`. Array and queue sources produce an array, text
produces text, and a sequence produces another lazy sequence. It can therefore
bound an unbounded source without reading the rest. Known unequal source and
mask lengths are errors.

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

Explicit binary comparison rank and frame axes are supported as described
in the Rank section. General binary function rank overrides remain deferred.

An axis-qualified cell view may become an operand of `outer`. Its `axis` order
will define frame order and its `rank` will define the cells, allowing rows of
one tensor to be paired with columns of another without moving data. The
expression syntax is deferred because `axis` already introduces selection;
`outer` itself does not permute axes.

Applying a same-shaped boolean mask to a tensor returns a rank-1 lazy sequence
of the selected atoms in iteration order. Tables retain their separate
row-selection rule.


## Flat record arrays

`use sequences` enables compact storage for records with a fixed set of scalar
fields:

```rank
use sequences
State = record
  .sum = 0
  .count = 0
end
Values = 1000 State flat
Values 0 .sum = 42
Values 0 .count = 1
Packed = (array State State) flat
Independent = Values copy
```

`Count State flat` allocates directly and copies the state into each slot.
`Values flat` copies a nonempty rank-1 array of records, using the first record
as its schema. Use `0 State flat` for an empty array. Field order in later
records may differ, but field names and types must match exactly.

Each field occupies eight bytes in an interleaved `ArrayBuffer`, accessed
through `DataView`. Integers use signed 64-bit storage, reals use float64, and
booleans use a byte within their eight-byte slot. Integers outside
`-9223372036854775808` through `9223372036854775807` raise an error before any
field is written. Arithmetic still uses ordinary Rank integers and reals.
Text, nested records, arrays, and other reference fields are not supported.

The array has type `.array`, and each element reads as a `.record` value copy.
Changing `Saved = Values 0` later does not change `Values`. Write back with
`Values 0 = Saved`, or update a field directly with `Values 0 .sum += 1`.
Assignment of the array itself still aliases it; `copy` duplicates its buffer.
This initial storage form supports rank-1 arrays and single-element writes.
Other transformations may return ordinary arrays; apply `flat` to pack them.

A segment tree built from a flat array also packs its nodes. Persistent storage
has no record object or maps per element. For integer-only schemas, a pure Rank
`combine` consisting of a single `return record` can use a scalar kernel.
Supported expressions are parameter field reads, integer literals, unary signs,
`+`, `-`, `*`, and standard binary `min`/`max`. The kernel skips intermediate
record construction; the public query result remains a record copy.

Builtin bindings and call-depth limits are checked before using the kernel.
Captured values, side effects, mixed field types, unsupported syntax, and
restricted dynamic code generation retain ordinary Rank calls and temporary
records. This is a JavaScript specialization, not an LLVM backend; BigInt
arithmetic and public result records still allocate. See the
[measured speed comparison](../design/flat-segment-speed.md).
