# Collections

`use algo` provides standard algorithmic collections. `index`, `queue`, `set`
and `counter` support implicit local naming; ordered multisets are named.

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
They do not replace the implicit local instance.

Assignment and argument passing preserve the structure's reference.
`Alias = Seen` shares `Seen`; `Seen = set` shares the current implicit set.
Neither assignment creates a copy. Named structures can be captured by local
functions and returned from functions.

Named sets and counters accept `Name add Value`. A set keeps one equal
element; a counter increments that element's frequency. The whole expression
after `add` is evaluated once. Ordinary postfix calls `Name Value add`
also work, and `add` returns the receiver when used as a function. Named
queues accept `Name push Value`; named indices use addressed assignment.

Bare `index`, `queue`, `set` and `counter` refer only to the current
function call's implicit instances, or the module instances at top level.
Reading and writing use the same instances. To share a structure with another
function, pass or capture its explicit name.

## Implicit local structure

If a function uses only one instance of a standard structure, the type word
itself denotes that lazily-created local instance.

### Index

`index` is a sparse keyed structure.

```rank
index Value = Position
```

Read:

```rank
j = index Need
```

Membership:

```rank
if Need in index
  ...
end
```

Default:

```rank
Last = index C default -1
```

Multi-dimensional keyed addressing:

```rank
index A B C = Value
X = index A B C
```

The complete tuple is the key, so an `index` can represent a sparse matrix or
higher-dimensional tensor. It does not infer rectangular dimensions or carry a
dense shape; programs keep those dimensions separately when needed. The key
and value types are inferred from uses within the function.

Bare `index` always refers to the current function call's local structure
(or the module structure at top level), for both reading and writing.
Recursive calls do not share it, and an outer implicit index is not inherited.

Use an ordinary name to share a dictionary explicitly:

```rank
use algo
Index = index

fun store Cache K V
  Cache K = V
  return 0
end

X = Index 7 99 store
Index 7 rem 99
```

`Index = index` aliases the current structure; it does not allocate a copy.
Passing it as `Cache` preserves that reference. Named indices support reads,
membership, padded reads and writes with the same complete tuple keys as
implicit indices. Compound writes such as `Cache K += 1` require an existing
entry. Keys may be integers, real numbers, booleans, text or labels. A named index can also
be captured by a local function.

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
A deque supports `pushfront`, `pushback`, `popfront`, `popback`, `peekfront` and
`peekback`. Its plain `push` appends at the back, and `pop`/`peek` use the front.
Binary functions use postfix syntax, such as `Ends Value pushfront`.

A heap is a stable min-priority queue. `Heap push Value` uses the value itself
as its priority. `Heap Priority Value enqueue` accepts a separate payload of
any type. Priorities must be comparable scalars of one ordering family;
integer and real priorities can mix. NaN priorities are rejected. Equal
priorities preserve insertion order. For a numeric max-heap, negate priorities
when calling `enqueue`. `pop` and `peek` return payloads, not priorities.

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

### Implicit queue

```rank
queue push X
return queue
```

The first use of `queue` lazily creates one queue in the current function-call
workspace. Separate and recursive calls receive separate queues. The queue is
ordered, zero-based, iterable and addressable after it is returned.
For elementwise operations, a queue behaves as a rank-1 array. This lets a
function return a queue and a test compare it directly with an array literal.

`push` takes one argument, so the rest of its line is one complete expression:

```rank
queue push A i + Carry
```

Structure methods place the receiver first and the method second. A method with
no arguments ends after its name; a method with one argument consumes the rest
of the line. The block syntax for methods with two or more arguments is not yet
settled. The earlier `with ... end` proposal is disputed and is not current
syntax.

Addressed mutation uses assignment rather than a `put` method:

```rank
index Row Column = Value
A Row Column = Value
```

An `index` writes a sparse tuple key. An array write requires one in-bounds
index per dense axis and changes the existing material array.

### Set

```rank
set add X
set remove X
if X in set
  ...
end
Count = set len
```

The first use of `set` lazily creates one set in the current function-call
workspace. `add` is idempotent: adding an equal value again leaves the set
unchanged. `remove` deletes that value and raises `.Missing` when it is absent.
Scalars, arrays and records can be elements. Array equality includes
both shape and contents; record equality includes field names and recursively
equal values. `in` tests membership, and `len` returns the number of unique
elements.

As with `queue`, separate and recursive function calls receive separate sets.
A set is iterable in insertion order. Adding an existing value does not move
it. An array is useful for a composite value such as a coordinate:

```rank
set add array X Y
```

A numeric set is a finite collection for `sum`, `min` and `max`:

```rank
Total = set sum
Smallest = set min
Largest = set max
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
Tree = Values min segment
Sums = Values + segment
Tree = Values Operation segment
```

`segment` is an operation modifier, like `scan` and `reduce`. The named form
resolves `Operation` once when the tree is built. It therefore honors a
user-defined `min` or any other binary function. Rank does not try to prove
that the operation is associative.

User-defined record states can supply an explicit neutral element:

```rank
Tree = Values combine segment with Identity
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
numeric `+ segment` tree:

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
Tree = Values maxsum segment
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
counter add X
Count = counter X
Kinds = counter len
```

The first use lazily creates one counter in the current function-call workspace.
`add` increments the frequency by one. Addressing an absent key returns zero,
and `len` returns the number of distinct keys. Scalar and array keys use the
same equality as `set` elements. Separate and recursive calls receive separate
counters. `counter` is a first-class value with runtime type `.counter`.

Counter iteration and direct frequency assignment are not defined yet.

If multiple structures of the same type are needed, they should be given
explicit names.

## Design rule

These are general data structures, not puzzle-specific shortcuts. Candidate
additions are tracked in the
[competitive-programming library roadmap](../design/competitive-programming-library.md).
