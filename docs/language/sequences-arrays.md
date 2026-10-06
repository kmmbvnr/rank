# Sequences and arrays

## Sequences

Ranges and algorithmic sources are sequences:

```rank
Range = 1 till 1000
Primes = primes
Fib = fibonacci to 4000000
```

Sequences are lazy by default. Constructing, transforming or filtering a
sequence builds a plan. A terminal operation such as `sum`, explicit
materialization, or iteration demands values from that plan. A terminal
operation that would consume an unbounded sequence is an error.

`fibonacci` starts with `1 2 3 5 8 ...` and `primes` with `2 3 5 7 11 ...`.
Both are infinite until a bound ends them, and both support ordinary
zero-based sequence addressing:

```rank
Fib = fibonacci to 100
SixthPrime = primes 5
```

## Bounds

Four words bound a sequence, an array or text by value. `to` and `till` end
it; `from` and `after` start it. `to` and `from` include the bound, `till` and
`after` exclude it:

| Boundary | Inclusive | Exclusive |
|---|---|---|
| Upper | `to X` (≤ X) | `till X` (< X) |
| Lower | `from X` (≥ X) | `after X` (> X) |

```rank
Fib = fibonacci to 89
rem 1 2 3 5 8 13 21 34 55 89
Small = primes till 20
rem 2 3 5 7 11 13 17 19
Large = primes from 101 take 3
rem 101 103 107
Next = primes after 101 take 3
rem 103 107 109
Window = primes after 100 till 130
rem 101 103 107 109 113 127
```

After a number, `to` and `till` build a range instead: `1 to 10` counts from
1 through 10 and `1 till 10` from 1 through 9. A bound is a value rather than
an item to find, because a sequence need never equal it.

`till` and `from` also take a condition. `till` stops before the first item
that meets it; `from` starts at the first item that meets it and keeps it:

```rank
Leading = fibonacci till greater 50
rem 1 2 3 5 8 13 21 34
Big = primes from greater 100 take 3
rem 101 103 107
Word = "hello world" till equal " "
rem hello
Run = Values till not even
```

The condition's subject is the item, as in [`filter`](#filter-clause): a
comparison with its right operand (`greater 50`), a predicate (`even`), a
function of one argument, `not` and the logical words over those, or a mask.
Text asks the condition of each character. `to` and `after` take only a value.

Bounds continue a pipeline, so they chain with filters and each other in any
order:

```rank
Answer = fibonacci to Limit filter even sum
Even = fibonacci filter even till 1000
Middle = fibonacci from 8 to 100
```

Bounds read items in order and work on any rank-1 value. An ordered source
seeks instead: `primes from 100` starts its sieve at 100, `fibonacci` advances
its recurrence to the bound, and a filter over such a source keeps the
ability. Seeking applies to a plain bound and to `greater` and `at least`
conditions, and gives the same items as reading. On a stored native stream,
`to` and `till` look at the first excluded value and leave it for the next
consumer.

Sequence sources may also accept filters and reductions in their own plan.
For example, filtering `fibonacci` by `even` lets the source produce only
`2 8 34 ...`. A source that has no specialized implementation uses the general
lazy operation with the same observable result.

## Take and drop

`take` and `drop` count items. `take` keeps at most the requested number of
leading items; `drop` skips that many and returns the tail:

```rank
FirstFive = primes take 5
NextFive = primes drop 5 take 5
Prefix = "abcdef" take 3
Tail = "abcdef" drop 3
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
infinite. Materializing a bounded sequence uses postfix `array`.

## Array construction

Prefix `array A B ...` constructs an array from its items. Scalar items form
one leading axis. Array-valued items must have the same shape and are stacked:
two matrices of shape `3 4` give a tensor of shape `2 3 4`. Their cells remain
lazy; construction checks shapes without reading every cell.

```rank
A = array 1 2 3
B = array 4 5 6
M = array A B
M shape               rem 2 3
M 1                   rem 4 5 6
```

Different array shapes, or mixing arrays and non-arrays, raise
`DimensionMismatch` at construction with zero-based item positions and shapes.
There is no padding. Use `tuple A B` for a fixed group of differently shaped
arrays. Streams and collections can hold array items without constructing a
rectangular tensor; materializing them still requires matching cell shapes.

With explicit `array shape ...` item lists, the declared dimensions describe
the frame: the item count must match that frame, and array items add their
trailing cell axes. `array shape ... fill Value` keeps its allocation contract:
it repeats `Value` as a cell and retains its type even for an empty frame.
Postfix `array` materializes items eagerly as described below.

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

Postfix `array` also copies a queue, stack, deque, set or multiset into a
rank-1 array (or a stacked array when every element is an array of one shape),
in the order `for` visits the container: front to back for queues and deques,
insertion order for stacks and sets, ascending order for multisets and
ordered sets. The source is not consumed and later writes to it do not reach
the copy. An empty container gives shape `0`. A counter or heap has no
contract order and raises an error. This lets
`Reversed array reverse` turn a queue into a reversed array.

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

An array whose cells are arrays or finite sequences stacks them the same way,
with the new axes after its own. Every cell must then be an array or sequence
of one shape; a different shape, or a mixture with scalar cells, raises
`DimensionMismatch`. Series computed as separate vectors become the columns of
a matrix:

```rank
Series = (array Month Interest Balance) copy transpose
Series shape          rem 360 3 for 360 months
```

`stack Month Interest Balance transpose` constructs the same shape lazily from
three equal-length arrays or exact-size sequences. `stack` adds a leading axis
for its arguments, and `transpose` turns them into columns. It reads cells on
demand and checks that all arguments have the same shape.
`stack unpack Items` spreads an array's leading-axis cells or a tuple's items
into the constructor.

Prefix `concat A B ... axis N` joins same-rank arrays along an existing axis.
Axes are zero-based and the default is axis 0. The dimensions on every other
axis must match. The selected lengths are added, preserving the input rank
and order: shapes `2 4` and `3 4` give `5 4` on axis 0; shapes `2 4` and `2 3`
give `2 7` on axis 1. Invalid axes or mismatched ranks or other dimensions
raise `DimensionMismatch`. Axis selection never flattens or merges axes.
Cells are read on demand. Rank-one sequences remain lazy, including sequences
of unknown length; mixing rank-one arrays and sequences returns a sequence.
Use `concat unpack Parts axis N` to spread a tensor's leading-axis cells or a
tuple's items.

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
source precedes `window`, and the size follows it:

```rank
Pairs = Text window 2
Windows = Values window Width
```

Text windows are text values, so ordinary text comparison and addressing keep
working. Windows over a finite numeric vector form a rank-2 tensor whose first
axis selects the window and whose trailing axis contains the window cell. The
operation is lazy and does not copy all overlapping cells before they are
demanded. An unbounded sequence may likewise produce windows indefinitely.

For a tensor, a rank-1 integer array supplies one size per selected axis:

```rank
WindowShape = array 2 3
Blocks = M window WindowShape
```

Without `axis`, the size array must cover every tensor axis. If `M` has shape
`4 5`, the example has shape `3 3 2 3`: window-position axes come first and
window-cell axes are appended last.

`axis` selects and orders a subset of source axes:

```rank
Columns = M window 3 axis 1

WindowShape = array 2 3
Blocks = T window WindowShape axis 0 2
```

There must be one size for each selected axis. Axis numbers are zero-based and
unique. Source axes retain their original order in the position frame; appended
window axes follow the stated `axis` order. A scalar size without `axis` is
valid only for a rank-1 value.

`stride` moves by more than one position and `padding` adds symmetric zero
padding before positions are chosen:

```rank
Blocks = M window WindowShape stride 2
Blocks = M window WindowShape padding 1
Blocks = M window WindowShape stride 2 padding 1
```

Each value may instead be a rank-1 integer array with one item per selected
axis. `stride` comes before `padding`, and `axis` follows both when they are
combined. Strides must be positive and padding must be nonnegative. Their
defaults are one and zero. Nonzero padding is defined only for arrays and
inserts integer zero, or the `with` value, outside the source; text, queues and sequences still
support stride.

`with` after `padding` replaces the zero border with any single value, so a
border can be neutral for the reduction that follows. A negative value needs no
parentheses:

```rank
Above = M window WindowShape padding 1 with -infinity
Below = M window WindowShape padding 1 with infinity
```

`with` is valid only directly after `padding`, and `axis` follows it.

For source length `N`, window width `W`, stride `S` and padding `P`, the
position-axis length is `max(0, floor((N + 2*P - W) / S) + 1)`. Windows remain
lazy, read-only views of their source and the conceptual padding border.

## Shifting along an axis

`shift` moves the items of an array along one axis and keeps the shape, so an
item can be compared with its neighbor without index arithmetic:

```rank
Previous = Values 1 shift
Rises = Values greater Previous
```

A positive count moves items toward higher positions; a negative count moves
them toward lower positions. Positions left empty read
integer zero. `with` supplies another single value and `axis` selects the axis,
zero by default. `axis` follows `with`:

```rank
Ends = Starts -1 shift with Total
Down = M 1 shift axis 0
Right = M 1 shift with 9 axis 1
```

Unlike `window`, `shift` never changes the length of an axis. It is available
for arrays and is a lazy, read-only view of its source.

## Addressing with a coordinate vector

`unpack` spreads a rank-1 array into separate addresses, so one vector can name
a cell of a tensor and offsets are added to whole coordinates at once:

```rank
Cell = array 1 1
Up = array -1 0
Value = M unpack Cell
Above = M unpack Next
```

with `Next = Cell + Up` on the line before. An expression after `unpack` needs
parentheses, as in `M unpack (Cell + Up)`, because whitespace application binds
tighter than `+`: `M unpack Cell + Up` is `(M unpack Cell) + Up`. Prefer a named
step such as `Next`, which also keeps the line inside the parenthesis budget.
The vector needs one item per axis, and coordinates outside the tensor are
out-of-bounds errors as for any address.

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
M = Values reshape unpack Shape
```

It is provided by `use sequences`. Dimensions must be nonnegative integers;
`unpack` expands a rank-1 shape array. Values are consumed in row-major order, and their count
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
Counts (Step to Limit by Step) += 1
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

A range selects a contiguous run. Arbitrary positions use an integer array as
the selector:

```rank
Part = A (2 till 6)
Picked = A array 4 1 1
Columns = M # (1 to 3)
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
Mask = N mod 3 equal 0
Mask or= N mod 5 equal 0

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

A mask contains one boolean per source item. Display, iteration, indexing,
`count`, `any`, `all`, `copy`, and postfix `array` all consume those booleans.
Selection is explicit:

```rank
Mask = Fib even
Selected = Fib Mask
Answer = Selected sum
```

A mask is positional. Its first flag selects the first item of whatever it is
applied to, so a mask built from one value can select from another, and masks
of different values combine flag by flag. The value and the mask are read in
lockstep. A mask shorter than the value ends the selection where the mask
ends, which lets a finite mask bound an endless source. A value that ends while
the mask still has flags is an error.

```rank
Mask = fibonacci till 1000 even
Even = fibonacci Mask
rem 2 8 34 144 610
```

A mask is a predicate, not a bound. `Fib (Fib less 1000)` never ends when `Fib`
is endless: after 987 every flag is `false`, and nothing proves that no later
one is `true`. Bound the sequence with `till` instead.

In the pipeline that makes it, a mask stands for the values it selects, so
numeric operations after the predicate read those values: `sum`, `min`, `max`,
`lcm`, `mean`, `median`, `std`, `variance`, `skewness`, `quantile` and
`percentile`. A pipeline therefore reads like a calculator, and both lines
below give 44 for `Fib = fibonacci till 100`:

```rank
Answer = Fib even sum
Answer = Fib (Fib even) sum
```

The same holds for a boolean array made by a predicate (`A even`), by
comparing an array with a scalar (`A greater 2`), or by `not`, `and`, `or` and
`xor` over such masks: `A even sum` adds the even cells of `A`, read in
row-major order.

A mask read by its name has left its pipeline and is only booleans. A numeric
operation on it is an error that names the explicit forms:

```rank
Mask = Fib even
Total = Fib Mask sum
Count = Mask count
rem Mask sum is an error
```

The runtime may remember a mask's source so that selecting from that same
source pushes the test into it without allocating booleans. This never changes
a result.

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

A function condition is a predicate applied to each selected cell:

```rank
Even = N filter even
First = Candidates filter palindrome first
Palindromes = Products filter palindrome rank 0
```

Without a modifier, `filter` passes each sequence item or each array cell
along the leading axis to the predicate. For a matrix, those cells are rows;
the predicate's declared rank does not change this default. `rank R` chooses
cells with R axes. For an array with N axes, the remaining N - R axes form the
frame traversed by the filter. `axis` names those frame axes in traversal
order and must name exactly N - R distinct axes; without it, they are the
first N - R axes. The predicate returns one
boolean per cell. A predicate over whole rows or columns keeps the other array
axis:

```rank
rem M has shape 3 2
Heavy = M filter row_total
rem Heavy has shape 2 2: the rows the predicate kept

Wide = M filter column_total axis 1
rem Wide has shape 3 1: the columns the predicate kept
```

`Products` above is a matrix, so `rank 0` deliberately tests individual
products and returns a rank-1 selection. A leading comparison on a matrix
produces an atom mask, not one boolean per row; write
`M filter (M greater 3)` to select those atoms explicitly. When a filter
traverses several axes, the retained cells are collected in traversal order;
those frame axes become one axis at their first original position. For an array
with shape `2 3 4`, `filter P rank 1` sends twelve vectors of length 4 to P
and returns shape `k 4`. `filter P axis 1 2 rank 1` sends twelve vectors of
length 2 and returns shape `2 k`. Here k is the number of accepted cells.
Conditions in one filter block must traverse the same axes.

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

A named function of one argument is a predicate too:

```rank
fun big X
  return X greater 10
end
Kept = N filter big
```

`filter` over a table keeps the table form even when its condition names no
column, because only that form returns rows that are still a table. A table is
a SQLite view or a rank-1 value of rows, and filtering one needs `use tables`.

Filtering a lazy sequence stays lazy, and filtering an array yields a lazy
selection. Materialize it with `copy` or postfix `array` when the result must
be an array.

A condition is one predicate, so the pipeline goes on after it. A comparison
takes one operand, a predicate takes its `rank` and `axis` modifiers, and a
function after data takes that data as its data-first arguments (`5 near`).
Everything after the condition applies to the filtered result:

```rank
Total = N filter even sum
Values = N filter greater 5 array
Early = N filter even till 100 take 3
```

Parenthesize an operand to compute it first: `N filter greater (Limit sqrt)`.

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

`max` and `min` take `.index` for the 0-based position of the first extreme
value and `.indexed` for the pair `[Value, Position]`; `sort` takes `.indexes`
(or `.index`) for the same permutation as `argsort` and `.indexed` for the pair
`[SortedValues, Indices]`. They combine with a direction in either order, and
ties give the earliest position. Both extremes need a rank-1 array or a bounded
sequence and raise `EmptyReduction` on an empty one.

```rank
Row = Heads max .index
unpack Value Position = Heads max .indexed
Order = Values sort .indexes .descending
unpack Sorted Order = Values sort .indexed
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

`merge` combines already sorted streams into a lazy sequence. Give it two
rank-1 arrays or sequences, a finite collection of streams, or a rank-2
matrix whose rows are sorted. It reads one head from each input, then only
advances the stream that supplied the next result. Equal keys keep their
order within a stream; ties between streams use input order.

```rank
Merged = (array 1 3 5) (array 2 4 6) merge
Rows = stack (array 9 5 1) (array 8 4 0)
Descending = Rows merge .descending
```

The default direction is ascending. Inputs must already follow that order;
an out-of-order item raises an error when it is read. `merge by .field` or
`merge by Key` compares one field or the result of a unary key function and
returns the original items. The key runs only when the item is read. Write
`.descending` after the field or key for descending inputs. To merge matrix
columns, transpose the matrix first. `merge` consumes whole streams, so it
has no special `axis` or `rank` form.

```rank
Events = Arrivals Departures merge by .time
ByMagnitude = Negative Positive merge by magnitude
```

`Mask choose TrueValues FalseValues` selects a value at each position. A
scalar boolean selects one branch; arrays broadcast by the usual trailing-axis
rules and produce a lazy array. Only the chosen branch is read at each cell.
The mask must contain booleans, and an absent mask cell gives an absent result
cell. Incompatible shapes are errors. `choose` is available without `use sequences`.
The earlier postfix calls remain valid. Parenthesize compound alternatives.

```rank
Rate = Guest choose GuestRate MemberRate
```

`Index choose Choices` generalizes the mask to more than two branches. Each
cell of the integer index names a choice: a leading-axis cell of `Choices`,
so either an item of `array A B C` or a slice of a stacked tensor. Index and
choices broadcast by trailing axes, and only the chosen value is read at each
cell. An index outside the choices raises `.Missing`; a nonintegral index is a
`.TypeError`. A column index therefore picks a different aggregate for every
column of a matrix:

```rank
Index = array 0 2 1
Picked = Index choose (array Sums Maxima Means)
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

`**`, `mod` and comparisons are also elementwise over compatible arrays:

```rank
M3 = N mod 3 equal 0
```

## Operation modifiers

Two kinds of trailing words change how an operation is applied.

**Call parameters** say how a function is applied to cells. They follow the
function: `A F rank 0`, `M sum axis 0`.

**Higher-order operations** (`reduce`, `scan`, `segment`, `outer`) take a
function as their argument. The function is the word or symbol right after
the operation, with the other parameters, as in `sort by .field`:

```rank
Total = A reduce + with 0
Prefix = A scan + with 0
Tree = A segment +
Products = A B outer *
States = Steps scan next with Start
Cells = A F rank 0
```

The function is a symbol (`+`, `*`, `and`, `less`), or a name that holds a
function, builtin or user-defined. An operator symbol directly after one of
these four words is its argument, never an infix operator. `scan`, `segment`
and `outer` need the function; the old orders `A + scan with 0` and
`Steps next scan` are rejected with a message that shows the new spelling.
`reduce` takes only a symbol. If a program binds `scan`, `reduce`, `segment` or
`outer` itself, the symbol form (`A scan +`) is rejected; the name form
follows the binding.

The operation takes everything on its left: `Start + Y scan +` scans
`Start + Y`. In `A B outer *`, `A B` is not evaluated first as addressing.
A completed modified operation can feed the next operation in the same chain:

```rank
Total = "1203" integer rank 0 sum
Prefix = A scan + with 0
Total = Prefix sum
Total = A B outer * sum rank 1 sum
Total = M sum axis 0 sum
```

`rank` consumes its integer argument, or two for `rank L R`; `axis` consumes its axis numbers (and
an optional `rank R`). The following operation receives the modified result.
`with` consumes one seed or identity operand before the chain continues.
For example, `A scan + with 0 sum` sums the scan results. `segment`
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
Total = A reduce + with 0
Product = A reduce *
```

Without an explicit rank, reduction consumes the complete finite value in
row-major order. `reduce rank R` instead reduces every trailing rank-`R` cell
to one atom while preserving its leading frame:

```rank
RowTotals = M reduce + rank 1 with 0
BlockProducts = Blocks reduce * rank 2
```

`with Seed` supplies an explicit initial accumulator. The seed is combined with
the first value, reused independently for every `reduce rank R` cell, and
returned unchanged for an empty cell. Reduction is a left fold. Without
`with`, a scalar and a rank-0 cell reduce to themselves.
The current symbolic reducers are `+`, `-`, `*`, `**`, `/`, `//`, `mod`, `and`,
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

`all` is equivalent to `reduce and with true`; `any` is equivalent to
`reduce or with false`.
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

`min` and `max` with one argument reduce one finite collection. With two
arguments they choose between numeric values and broadcast over arrays. Like
every other function, they follow their arguments:

```rank
Largest = A max
Bound = Low High max
Clamped = Values 0 max
Best = Best Now .spent min
```

Chains associate from the left: `Low High max Limit min`. `axis` and `rank`
modify the one-argument reduction; the binary form already follows ordinary
elementwise broadcasting. Parenthesize a compound operand, as in
`0 (Limit - Used) max`. The infix form `Low max High` is rejected with a hint
to write `Low High max`.

A user-defined `min` or `max` takes precedence, even without `use numbers`.
For example, after `fun max A B` returning `A + B`, `3 4 max` returns `7`.
A named builtin (`op = max`) supports the same lazy binary broadcasting.
Equal numeric operands preserve the left operand, including its integer/real
representation.

## Scan

Prefix accumulation:

```rank
Prefix = A scan + with 0
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
States = Steps scan next with Start
Prefixes = Steps scan next
```

`next State Step` receives the previous state and the next source item. The
seed is the first result. Without a seed, `Steps scan next` starts from the
first source item. The function is resolved once when the scan is created;
sequence sources remain lazy.

## Short-circuiting selection

`first where` and `first index where` take a condition, as `filter` does, or
an aligned boolean mask:

```rank
Match = Values first where greater 10
Position = Values first index where Mask
```

`first where` returns the first value that meets the condition. `first index
where` returns its zero-based position. Both stop reading at the first match,
so they work on an unbounded source. If nothing matches, they raise `.Missing`,
so `default` can provide a fallback. Known unequal source and mask lengths are
errors.

The leading run that meets a condition is `till not Condition`; see
[Bounds](#bounds).

## Outer

`outer` is a higher-order modifier. It applies the operator or named binary
function immediately before it to every pair of cells:

```rank
Sums = A B outer +
Products = A B outer *
Grid = Values Values outer bxor
operation = min
Smallest = A B outer operation
```

Cell ranks belong to the operation; `outer` combines the remaining frames.
Symbolic binary operations have intrinsic ranks `0 0`. The named functions
`band`, `bor`, `bxor`, `shl`, `shr`, `min` and `max` also declare ranks `0 0`.
User-defined binary functions currently default to `all all`; syntax for
declaring their intrinsic ranks remains deferred.

The result shape is the concatenation of the left and right frame shapes.
Therefore, if `A` has shape `2 3` and `B` has shape `4 5`, the result of atom
pairing `A B outer *` has shape:

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
