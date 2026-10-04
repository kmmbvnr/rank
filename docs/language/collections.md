# Collections

`use algo` provides standard algorithmic collections. Each one is created
with `new` and held by a name; there are no implicit per-function instances.

## Named structures

Use `new` to create an independent empty structure. Each evaluation creates
a new instance and requires `use algo`:

```rank
use algo
Graph = new index
Distance = new index
Seen = new set
Counts = new counter
Pending = new queue
Bag = new multiset

Graph 1 2 = 10
Distance 1 = 0
Seen add 1
Counts add 1
Pending push 1
Bag add 1
```

Constructors include `new index`, `new queue`, `new set`, `new counter`,
`new multiset`, `new orderedset`, `new stack`, `new deque` and `new heap`.

`new Kind Items` fills the new structure from the items of one collection:
a queue, stack, deque or heap is pushed in order (a heap uses each item as its
own priority), and a set, counter or multiset is added to:

```rank
Pending = new queue (1 to 5)
Seen = new set "hello"
Counts = new counter (array 1 1 2)
```

`new heap Priorities Values` builds a heap from two arrays with the same leading
length. `Priorities` must be a vector of comparable scalar values. Each leading
cell of `Values` becomes one payload, so a matrix supplies one row per entry.
The constructor builds the heap in linear time. The default order pops the
smallest priority; `.descending` pops the largest. The direction is fixed at
construction and also applies to later insertions. Equal priorities retain
input order:

```rank
Priorities = array 2 9 1
Payloads = array "a" "b" "c"
Work = new heap Priorities Payloads .descending
Work pop                     rem "b"
```

`new heap Items .descending` uses each item as its own priority, and
`new heap .descending` creates an empty max-heap.

An index addressed by an array or a finite sequence of keys gathers: it
answers one value per key, in the shape of the keys. A missing key raises,
or takes the `default` when one follows:

```rank
Labels = Part Nodes default 0
```

Assignment and argument passing preserve the structure's reference.
`Alias = Seen` shares `Seen`. The assignment does not create a copy. Named structures can be captured by local
functions and returned from functions.

Named sets and counters accept `Name add Value`. A set keeps one equal
element; a counter increments that element's frequency. The whole expression
after `add` is evaluated once. Ordinary postfix calls `Name Value add`
also work, and `add` returns the receiver when used as a function. Named
queues accept `Name push Value`; named indices use addressed assignment.

A function that needs a structure creates its own with `new`; separate and
recursive calls each get a fresh one. To share a structure with another
function, pass or capture its name. The bare words `index`, `queue`, `set` and
`counter` no longer name an instance and are an error that suggests `new`.

`push` appends one value to a queue, stack, deque or heap, even an array.
`push unpack Items` appends each item of a rank-1 array or tuple instead.

## Index

An index is a sparse keyed structure, created with `new index`.

```rank
use algo
Cache = new index
Cache Value = Position
```

Read:

```rank
j = Cache Need
```

Membership:

```rank
if Need in Cache
  ...
end
```

Default:

```rank
Last = Cache C default -1
```

Multi-dimensional keyed addressing:

```rank
Cache A B C = Value
X = Cache A B C
```

The complete tuple is the key, so an index can represent a sparse matrix or
higher-dimensional tensor. It does not infer rectangular dimensions or carry a
dense shape; programs keep those dimensions separately when needed. The key
and value types are inferred from uses within the function.

An index is a reference structure. Passing it to a function preserves that
reference, so every name sees the write:

```rank
use algo
Cache = new index

fun store Cache K V
  Cache K = V
  return 0
end

X = Cache 7 99 store
Cache 7 rem 99
```

An index supports reads, membership, padded reads and writes with complete
tuple keys. Compound writes such as `Cache K += 1` require an existing
entry. Keys may be integers, real numbers, booleans, text or labels. An index
can also be captured by a local function.

Index values may have different types, and replacing an entry may change its
type. The collection element contract below does not apply to an index.

### Mutable collection element types

Each `set`, `counter`, `queue`, `stack`, `deque` and `heap` has an element
contract. The first successful insertion fixes the runtime type of its values
(`counter` keys and `heap` payloads). Integer and real are distinct types.
Aliases and function arguments share the same contract, which remains after
the collection becomes empty. An incompatible insertion raises an error
before storing the new value. No constructor type annotation is required.

An array element also fixes its number of axes and its cell types. Axis lengths
may vary. For example, after inserting `array 1 2`, inserting `array 3 4 5`
succeeds, while a text array, a real array or a rank-2 array fails. If the first
array contains several cell types, later arrays may use those types but cannot
introduce another one. The same rule applies recursively to nested arrays.
Empty arrays fix their rank but defer their cell contract until cells are
inserted. Record fields and the contents of nested mutable collections do not
form part of this contract.

Insertion reads array cells, including lazy cells, to validate their types.
This adds work proportional to the number of cells inspected. A failed read
does not establish or widen the contract; side effects performed by the read
itself still take place. Static analysis reports proven incompatibilities and
retains element facts through safe reads and direct aliases. Unknown calls or
aliasing discard facts that cannot be proved; runtime checks still apply.

### Queue, stack, deque and heap

All operations below require `use algo`. Use `use sequences` for `len`.

```rank
Pending = new queue
Pending push 7
First = Pending peek
Removed = Pending pop

Path = new stack
Path push 3
Path push 8
Last = Path pop                 rem 8

Ends = new deque
Ends 2 pushback
Ends 1 pushfront
Left = Ends peekfront
Right = Ends popback

Work = new heap
Work 10 "vertex A" enqueue      rem receiver, priority, payload
Work 3 "vertex B" enqueue
Next = Work pop                 rem vertex B
```

`push` appends to a queue or stack. `pop` removes and returns the oldest queue
entry or the newest stack entry; `peek` returns that entry without removing it.
The first inserted element fixes the element's outer type for each queue, stack,
deque or heap instance. Later insertions must have that type, even after the
container becomes empty. For arrays, the number of axes must also match;
array contents are not checked. Heap priorities have their separate ordering
rule below.
Set and counter insertions still hash array contents for equality, which may
read a lazy array; this is separate from the element-type check.

A deque supports `pushfront`, `pushback`, `popfront`, `popback`, `peekfront` and
`peekback`. Its plain `push` appends at the back, and `pop`/`peek` use the front.
Binary functions use postfix syntax, such as `Ends Value pushfront`.

A heap is a stable priority queue, smallest first unless created with
`.descending`. `Heap push Value` uses the value itself
as its priority. `Heap Priority Value enqueue` accepts a separate payload
whose type is fixed by the first insertion. Priorities must be comparable
scalars of one ordering family;
integer and real priorities can mix. NaN priorities are rejected. Equal
priorities preserve insertion order. `pop` and `peek` return payloads, not
priorities.

Empty `pop` and `peek` operations raise a missing-value error, so
`Pending pop default -1` supplies a fallback. `len` counts remaining entries.
Queue, stack and deque indices start at zero at the current front/bottom.
They retain queue-style array operations. Heap iteration visits payloads in
internal heap order, not sorted order; repeatedly call `pop` to get priority order.
Queue iteration can observe entries appended during the loop. Do not remove
entries while iterating a container; use a conditional `for` with `pop` instead.

End operations use constant expected time with numeric-keyed storage; heap
insertion and extraction use O(log n) comparisons and `peek` takes O(1).
Materializing a queue-family container as an array takes O(n). Named containers
are shared references when assigned, captured or passed to functions. Their
runtime types are `.queue`, `.stack`, `.deque` and `.heap`.

### Queue methods

```rank
Pending = new queue
Pending push X
return Pending
```

A queue is ordered, zero-based, iterable and addressable after it is returned.
For elementwise operations, a queue behaves as a rank-1 array. This lets a
function return a queue and a test compare it directly with an array literal.

`push` takes one argument, so the rest of its line is one complete expression:

```rank
Pending push A i + Carry
```

Structure methods place the receiver first and the method second. A method with
no arguments ends after its name; a method with one argument consumes the rest
of the line. The block syntax for methods with two or more arguments is not yet
settled. The earlier `with ... end` proposal is disputed and is not current
syntax.

Addressed mutation uses assignment rather than a `put` method:

```rank
Cache Row Column = Value
A Row Column = Value
```

An index writes a sparse tuple key. An array write requires one in-bounds
index per dense axis and changes the array this name holds; a second name that
was given the same array keeps what it was given. An index is a reference
structure, so every name for it sees the write. See
[values and sharing](values-addressing.md#values-and-sharing).

### Set

```rank
Seen = new set
Seen add X
Seen remove X
if X in Seen
  ...
end
Count = Seen len
```

`add` is idempotent: adding an equal value again leaves the set
unchanged. `remove` deletes that value and raises `.Missing` when it is absent.
Sets and counters keep the outer type and, for arrays, the rank of their first
inserted element even after all elements are removed. A mismatched `add` is an
error. The cells of an array element are not checked.

Scalars, arrays and records can be elements. Array equality includes
both shape and contents; record equality includes field names and recursively
equal values. `in` tests membership, and `len` returns the number of unique
elements.

Separate and recursive function calls each create their own set.
A set is iterable in insertion order. Adding an existing value does not move
it. An array is useful for a composite value such as a coordinate:

```rank
Seen add array X Y
```

A numeric set is a finite collection for `sum`, `min` and `max`:

```rank
Total = Seen sum
Smallest = Seen min
Largest = Seen max
```

Each distinct value contributes once. An empty set sums to zero; `min` and
`max` reject it as an empty reduction.

### Ordered multiset

`new orderedset` creates the unique-value variant of a multiset: repeated
`add` calls for an existing value have no effect. It shares multiset operations
and the `.multiset` runtime type.

`Bag lowerbound X` (also `Bag X lowerbound`) returns the smallest value >= X;
it is an alias for `ceiling`. `Bag upperbound X` returns the smallest value > X.
These return values, not iterator positions. If no value qualifies, they raise
a missing-value error that can be handled with `default`. Both use the multiset's
expected O(log n) tree lookup and preserve exact integer comparisons.

An ordered multiset keeps duplicate comparable scalar values in sorted order.
It is always named because algorithms often need more than one instance:

```rank
Tickets = Prices multiset
Empty = new multiset
```

`Values multiset` fills a new multiset from text or a finite rank-1 array,
queue, set, multiset or sequence. `new multiset` creates an empty instance and
infers its ordering from the first added value. All values must share one
scalar ordering: numeric, text, boolean or symbol. Integers and real numbers
share the numeric ordering.

Methods put the receiver before the operation:

```rank
Tickets add Price
Tickets remove Price
Best = Tickets floor Limit
Next = Tickets ceiling Limit
Third = Tickets 2
```

These method words are contextual library names, not reserved words. Rank
dispatches `floor`, `ceiling`, `lowerbound` and `upperbound` as multiset
methods only when the expression before the operation evaluates to a
multiset. Otherwise the operation resolves as an ordinary function, so a
program may define and call `fun ceiling A B` as `3 ceiling 4`.

`remove` deletes one equal occurrence. Removing an absent value raises
`.Missing`. `floor` returns the greatest value at most its argument;
`ceiling` returns the least value at least its argument. When no such value
exists they also raise `.Missing`, so ordinary `default` supplies a fallback:

```rank
Best = Tickets floor Limit default -1
```

`Bag I` addresses the occurrence at zero-based position `I` in sorted order.
Equal values occupy separate positions. A negative or out-of-bounds position
raises `.Missing`, so it also composes with `default`.

Iteration is sorted and repeats duplicate values. With `use sequences`, `len`
counts all occurrences and `shape` is its one-dimensional size. Numeric
`min` and `max` from `use numbers` read its endpoints.

Construction takes expected `O(N log N)` time. Indexing, `add`, `remove`,
`floor` and `ceiling` take expected `O(log N)` time. Membership with `in` has
the same expected bound. The runtime type is `.multiset`.

### Fenwick tree

A Fenwick tree is a fixed-size integer array with logarithmic prefix sums:

```rank
F = N fenwick
F I = Value
F I += Delta
Value = F I
Prefix = F sum I
```

Indices are zero-based. Cells start at zero. Addressed assignment writes one
cell, and compound assignment updates it. `F sum I` returns the inclusive sum
from index zero through `I`; `F sum -1` is the empty prefix and returns zero.
Other negative and out-of-bounds indices raise `.Missing` and compose with
`default`. Cell access is constant time; assignment and prefix sums take
`O(log N)` time. The runtime type is `.fenwick`.

`sum` is also contextual rather than reserved. The middle form is a Fenwick
method only when `F` evaluates to a Fenwick tree. For any other receiver the
ordinary application chain remains intact; for example, `A sum print` first
reduces `A` and then prints the result. Receiver dispatch happens at each application, so
`F sum I print` computes the prefix and then prints it, with or without
`use numbers`. The receiver and index are evaluated once.

### Segment tree

A segment tree stores a finite rank-1 value under one associative binary
operation:

```rank
Tree = Values segment min
Sums = Values segment +
Tree = Values segment Operation
```

`segment` is a higher-order operation, like `scan` and `reduce`. The named form
resolves `Operation` once when the tree is built. It therefore honors a
user-defined `min` or any other binary function. Rank does not try to prove
that the operation is associative.

User-defined record states can supply an explicit neutral element:

```rank
Tree = Values segment combine with Identity
```

Each input element is already a state. `combine Left Right` must return a
state, be associative, and leave both operands unchanged. `Identity` must
satisfy `combine Identity X = X` and `combine X Identity = X`; these laws are
part of the caller's contract and are not checked at runtime. The function
and identity are evaluated once during construction.

Ranges remain inclusive. With an explicit identity, `Tree I (I - 1) query`
returns the identity for `0 <= I <= Tree len`. An empty tree therefore accepts
`Tree 0 (-1) query`. Other reversed ranges and out-of-bounds positions are
errors. Without an explicit identity, the existing range rules apply.

A [flat record array](sequences-arrays.md#flat-record-arrays) makes the tree
store its nodes in a compact buffer with the same schema. Reads return record
copies. Replace a whole leaf with `Tree Position = State` to recompute its
ancestors. A schema mismatch or overflow during an update leaves the stored
tree unchanged. Flat identities are copied on construction and on empty reads.
Ordinary record trees retain the existing reference semantics. Eligible pure
integer `combine` functions use a scalar kernel without intermediate records.
Query intermediates keep arbitrary-precision integer semantics; only stored
nodes are checked against the signed 64-bit limit.

Only point updates are supported for user-defined operations. Lazy range
updates need an additional action algebra and are not inferred from `combine`.

A point uses ordinary zero-based addressing. Assignment changes the point and
updates its ancestors:

```rank
Value = Tree Position
Tree Position = Value
Tree Position += Delta
```

A numeric tree built with the standard `+` operation also accepts inclusive
range assignment and addition:

```rank
Tree Left Right = Value
Tree Left Right += Delta
```

These operations broadcast the numeric value across the range. They use lazy
propagation internally, so range updates and sum queries take `O(log N)` time.
Assignment replaces earlier pending additions; later additions apply to the
assigned value. Other segment operations remain point-update trees.

With `use sequences`, postfix `copy` creates an independent version of a
numeric `segment +` tree:

```rank
Version = Tree copy
Version Position = Value
```

The first copy converts the source to persistent storage in `O(N)` time.
It does not change its values. That copy and all later copies share unchanged
nodes in `O(1)` time. Updating any persistent version copies only its affected
root paths in `O(log N)` time; no update changes another version.

`query` reduces an inclusive range while preserving left-to-right operand
order:

```rank
Answer = Tree Left Right query
```

Both bounds must be valid positions and `Left` must not exceed `Right`.
Out-of-bounds positions raise `.Missing` and compose with `default`. No identity
value is required because an empty range is not a valid query. Empty trees may
be constructed but cannot be queried or addressed.

`firstatleast` finds the first position where the aggregate of the prefix
reaches a numeric target:

```rank
Position = Tree Target firstatleast
```

It returns `-1` when no prefix reaches the target. Prefix aggregates must be
monotone relative to the target. Typical valid trees use `max`, or `+` with
nonnegative values. Rank does not attempt to prove this condition.

`maxsum` is the native numeric profile for prefix and subarray sums:

```rank
Tree = Values segment maxsum
State = Tree Left Right query
```

`State` is a record with `.sum`, `.prefix`, `.suffix` and `.best`. The three
maxima allow the empty subarray and are therefore never negative. Addressing
still reads the numeric point, and point assignment accepts a number. The
profile keeps the standard four-value segment aggregate inside the runtime so
large queries do not pay for millions of interpreted combining calls.

The built-in is recognized by function identity. A user function named
`maxsum` remains an ordinary binary operation when used with `segment`.

Construction takes `O(N)` time. Point access is constant time; point updates
and range queries take `O(log N)` time, excluding the cost of the selected
operation. `firstatleast` also takes `O(log N)`. With `use sequences`, `len`
and `shape` report the fixed size.
The runtime type is `.segment`.

### Wavelet matrix

A wavelet matrix prepares immutable range-count queries over comparable scalar
values:

```rank
Data = Values wavelet
Count = Data Left Right Low High within
Sum = Data Left Right Low High sumwithin
One = Data (array Left Right) missing
Answers = Data Queries missing
```

Both position and value ranges are inclusive. `within` counts positions from
`Left` through `Right` whose values lie from `Low` through `High`. Values must
all be numbers, text, booleans or symbols of one comparable kind. Bounds of a
different kind are errors.

`sumwithin` uses the same ranges and sums their matching values. It requires a
numeric wavelet. Its sum tables are prepared lazily on the first aggregate
query. `missing` requires positive integer values and returns the smallest
positive sum that no subset of the selected positions can form. Its right
argument has intrinsic rank 1: one pair produces one answer, while a `Q 2`
query matrix produces a length-`Q` answer vector.

Construction takes `O(N log S)` time and memory, where `S` is the number of
distinct values. `within` and `sumwithin` take `O(log S)` per query. If `T` is
the returned missing sum, `missing` takes `O(log S log T)`. The prepared value
cannot be changed. With `use sequences`, `len` and `shape` report its fixed
size. Its runtime type is `.wavelet`.


### Permutations

`permutations` has intrinsic rank 1. It accepts text or a finite rank-1 array,
queue, set or sequence. Text produces a lazy sequence of texts; other inputs
produce a lazy sequence of rank-1 arrays:

```rank
for Route in Cities permutations
  Route visit
end
```

The empty collection has one empty permutation. Input order determines
generation order; sets use insertion order. Results are distinct by value:
equal input values never produce duplicate permutations. The exact sequence
size is the multinomial count, so `len` does not need to enumerate it. An
unbounded sequence is an error.

### Combinations

`combinations` accepts a finite collection and a nonnegative count, then
returns a lazy sequence of selections without repetition:

```rank
for Pair in Values 2 combinations
  Pair score
end
```

Selections follow input order. A count greater than the collection length
produces an empty sequence; count zero produces one empty selection. Equal
values at different positions remain distinct choices. An unbounded sequence
is an error.

For a tensor, `combinations` selects cells along the leading axis and preserves
the remaining cell shape. Given `Rings` with shape `6 3`, every value from
`Rings 2 combinations` therefore has shape `2 3`.

`multicomb` is the corresponding generator with repetition:

```rank
for Pair in Values 2 multicomb
  Pair score
end
```

It uses the same order and tensor cell rules. A selection may use the same
input position more than once. Count zero produces one empty selection,
including for an empty input; a positive count from an empty input produces
an empty sequence. Its exact size is the multiset coefficient, so `len` does
not enumerate the results.

### Counter

`counter` is a frequency map:

```rank
Counts = new counter
Counts add X
Counts remove X
Present = X in Counts
Count = Counts X
Kinds = Counts len

for Key in Counts
  Count = Counts Key
end
```

`new counter` allocates a named instance. `add` increments the frequency of an element by one. `remove` decrements
the frequency by one and removes the entry when its count reaches zero
(raising `.Missing` if the element was not present). Addressing an absent key
returns zero without raising an error. `Key in Counts` checks whether an
element currently has a non-zero count. `len` returns the number of distinct
keys.

Iterating with `for Key in Counts` yields the distinct keys in insertion order,
identical to `set`. Counters can also be converted to ordered multisets with
`Counts multiset` or passed to collection sequences.

Direct frequency reassignment (e.g. `Counts X = N`) is not defined. Scalar and
array keys use the same structural equality as `set` elements. Separate and
recursive calls each create their own counter. A counter is a
first-class value with runtime type `.counter`.

## Design rule

These are general data structures, not puzzle-specific shortcuts. Candidate
additions are tracked in the
[competitive-programming library roadmap](../design/competitive-programming-library.md).
