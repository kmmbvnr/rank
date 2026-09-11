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

The five constructors are `new index`, `new queue`, `new set`, `new counter`
and `new multiset`. They do not replace the implicit local instance.

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
Last = index C pad -1
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
entry. Keys may be integers, booleans, text or labels. A named index can also
be captured by a local function.

### Queue

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
if X in set
  ...
end
Count = set len
```

The first use of `set` lazily creates one set in the current function-call
workspace. `add` is idempotent: adding an equal value again leaves the set
unchanged. Scalars and arrays can be elements; array identity includes both
shape and contents. `in` tests membership, and `len` returns the number of
unique elements.

As with `queue`, separate and recursive function calls receive separate sets.
A set is iterable in insertion order. Adding an existing value does not move
it. An array is useful for a composite value such as a coordinate:

```rank
set add array X Y
```

### Ordered multiset

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
```

`remove` deletes one equal occurrence. Removing an absent value raises
`.Missing`. `floor` returns the greatest value at most its argument;
`ceiling` returns the least value at least its argument. When no such value
exists they also raise `.Missing`, so ordinary `pad` supplies a fallback:

```rank
Best = Tickets floor Limit pad -1
```

Iteration is sorted and repeats duplicate values. With `use sequences`, `len`
counts all occurrences and `shape` is its one-dimensional size. Numeric
`min` and `max` from `use numbers` read its endpoints.

Construction takes expected `O(N log N)` time. `add`, `remove`, `floor` and
`ceiling` take expected `O(log N)` time. Membership with `in` has the same
expected bound. The runtime type is `.multiset`.

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

These are general data structures, not puzzle-specific shortcuts. Advanced
structures may live in modules:

- heaps;
- disjoint-set union;
- Fenwick tree;
- segment tree;
- bitset;
- sparse table;
- graph structures.
