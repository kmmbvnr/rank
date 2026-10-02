# algo manual

## index

### NAME

Store and retrieve sparse keyed values.

### SYNOPSIS

```text
index Key = Value
Capitalized words stand for your values.
```

### DESCRIPTION

An index stores sparse keys rather than
positional array cells. Reading an
absent key raises a missing-value error;
default supplies a fallback.

### EXAMPLES

Store and look up a keyed value: 3.

```rank
use algo
index "red" = 3
index "red"
```

## new

### NAME

Create an empty named mutable container.

### SYNOPSIS

```text
new Kind
Capitalized words stand for your values.
```

### DESCRIPTION

Choose a container kind such as queue,
stack, set or counter. Named mutable
containers are shared when assigned to
another name.

### EXAMPLES

Create an empty queue, then remove 7.

```rank
use algo
Q = new queue
Q push 7
Q pop
```

## push

### NAME

Appends a value to a queue, stack, deque
or heap, which orders it by priority.

### SYNOPSIS

```text
Q push Value -> collection
Q: queue or stack; Value: item
```

### DESCRIPTION

Queue removal is oldest-first; stack
removal is newest-first. A heap removes
the smallest priority first. Reading an
empty container raises a missing-value
error. This operation changes the
receiver in place.

### EXAMPLES

Append 7 to a queue, then remove it.

```rank
use algo
Q = new queue
Q push 7
Q pop
```

## set add

### NAME

Add an item to the implicit local set.

### SYNOPSIS

```text
set add Value
Capitalized words stand for your values.
```

### DESCRIPTION

set is an implicit local mutable set.
Repeated equal values do not add
entries. Use new set for a named
instance.

### EXAMPLES

Adding 3 twice keeps one item.

```rank
use algo
set add 3
set add 3
set len
```

## counter add

### NAME

Count an item in the implicit local
counter.

### SYNOPSIS

```text
counter add Value
Capitalized words stand for your values.
```

### DESCRIPTION

counter is an implicit local frequency
collection. Adding an equal value
increments its count; use new counter
for a named instance.

### EXAMPLES

Count two occurrences of a.

```rank
use algo
counter add "a"
counter add "a"
counter "a"
```

## add

### NAME

Adds a value to a set, counter or
multiset.

### SYNOPSIS

```text
Seen add Value -> collection
Seen: set/counter/multiset; Value: item
```

### DESCRIPTION

An ordered multiset keeps duplicates. A
lookup with no qualifying value raises a
missing-value error; append default to
supply a fallback. This operation
changes the receiver in place.

### EXAMPLES

Insert one occurrence of 7.

```rank
use algo
Bag = (array 2 5 5 9) multiset
Bag add 7
Bag len
```

## ceiling

### NAME

Smallest stored value at least the
limit.

### SYNOPSIS

```text
Bag ceiling Limit -> element
Bag: ordered multiset; Limit: item
```

### DESCRIPTION

An ordered multiset keeps duplicates. A
lookup with no qualifying value raises a
missing-value error; append default to
supply a fallback.

### EXAMPLES

Find a value at least 5: 5.

```rank
use algo
Bag = (array 2 5 5 9) multiset
Bag 5 ceiling
```

## combinations

### NAME

Lazy sequence of the combinations of
that size, in input order.

### SYNOPSIS

```text
Values Count combinations -> sequence
Values: finite collection; Count:
integer
```

### DESCRIPTION

The input is a finite one-dimensional
collection. Generated combinations and
permutations are lazy, so consume only
the results you need. Values are
produced on demand; storing the result
does not force every item.

### EXAMPLES

Choose pairs without repetition.

```rank
use algo
(array 1 2 3) 2 combinations
```

## enqueue

### NAME

Inserts a payload into a heap under a
separate priority.

### SYNOPSIS

```text
Heap Priority Value enqueue ->
collection
Heap: heap; Priority: ordered value
Value: payload
```

### DESCRIPTION

Queue removal is oldest-first; stack
removal is newest-first. A heap removes
the smallest priority first. Reading an
empty container raises a missing-value
error. This operation changes the
receiver in place.

### EXAMPLES

Store a payload under priority 1.

```rank
use algo
H = new heap
H 1 "first" enqueue
```

## fenwick

### NAME

Fixed-size integer Fenwick tree with
inclusive prefix sums.

### SYNOPSIS

```text
Size fenwick -> fenwick
Size: nonnegative integer
```

### DESCRIPTION

Size is a nonnegative integer. Cells
start at zero; indices start at zero.
Prefix sums include their final index.

### EXAMPLES

Store 5 at position 1 and sum through 2.

```rank
use algo
F = 4 fenwick
F 1 = 5
F sum 2
```

## firstatleast

### NAME

First position whose monotone prefix
aggregate reaches the target.

### SYNOPSIS

```text
Tree Target firstatleast -> integer
Tree: numeric segment; Target: number
```

### DESCRIPTION

Finds the first position whose prefix
aggregate reaches Target. Aggregates
must be numeric and monotone for this
search to be valid.

### EXAMPLES

The prefix reaches 4 at position 1.

```rank
use algo
S = (array 2 3 5) segment +
S 4 firstatleast
```

## floor

### NAME

Largest stored value at most the limit.

### SYNOPSIS

```text
Bag floor Limit -> element
Bag: ordered multiset; Limit: item
```

### DESCRIPTION

An ordered multiset keeps duplicates. A
lookup with no qualifying value raises a
missing-value error; append default to
supply a fallback.

### EXAMPLES

Find a value at most 5: 5.

```rank
use algo
Bag = (array 2 5 5 9) multiset
Bag 5 floor
```

## lowerbound

### NAME

Smallest stored value at least the
query, an alias for ceiling.

### SYNOPSIS

```text
Bag lowerbound Value -> element
Bag: ordered multiset; Value: item
```

### DESCRIPTION

An ordered multiset keeps duplicates. A
lookup with no qualifying value raises a
missing-value error; append default to
supply a fallback.

### EXAMPLES

Find the first value at least 5.

```rank
use algo
Bag = (array 2 5 5 9) multiset
Bag 5 lowerbound
```

## maxsum

### NAME

Prefix and subarray sum profile: query
returns sum, prefix, suffix and best.

### SYNOPSIS

```text
Values segment maxsum -> record
Values: numeric vector
```

### DESCRIPTION

Used as the combiner after segment. The
query returns a record containing sum,
prefix, suffix and best; best is the
maximum subarray sum.

### EXAMPLES

Query the maximum-subarray profile.

```rank
use algo
S = (array -2 4 -1) segment maxsum
S 0 2 query
```

## missing

### NAME

Smallest subset sum a wavelet position
range cannot make.

### SYNOPSIS

```text
Data Bounds missing -> integer
Data: wavelet of positive integers
Bounds: inclusive integer index pairs
```

### DESCRIPTION

The wavelet source must contain positive
integers. Each bounds pair selects an
inclusive positional range; the result
is the least positive sum unavailable
from its subset sums.

### EXAMPLES

The first impossible subset sum is 4.

```rank
use algo
W = (array 1 2 7) wavelet
W (array 0 2) missing
```

## multicomb

### NAME

Lazy sequence of the combinations of
that size with repetition.

### SYNOPSIS

```text
Values Count multicomb -> sequence
Values: finite collection; Count:
integer
```

### DESCRIPTION

The input is a finite one-dimensional
collection. Generated combinations and
permutations are lazy, so consume only
the results you need. Values are
produced on demand; storing the result
does not force every item.

### EXAMPLES

Choose pairs allowing repeated items.

```rank
use algo
(array 1 2) 2 multicomb
```

## multiset

### NAME

Ordered multiset holding every value,
duplicates kept.

### SYNOPSIS

```text
Values multiset -> collection
Values: comparable vector
```

### DESCRIPTION

The input is a one-dimensional
collection of comparable values. Values
must have compatible types.

### EXAMPLES

Store values in sorted order, keeping
duplicates.

```rank
use algo
(array 3 1 3) multiset
```

## peek

### NAME

Next value of a queue, stack, deque or
heap, left in place.

### SYNOPSIS

```text
Q peek -> element
Q: queue, stack, deque or heap
```

### DESCRIPTION

Queue removal is oldest-first; stack
removal is newest-first. A heap removes
the smallest priority first. Reading an
empty container raises a missing-value
error.

### EXAMPLES

Read the next payload without removing
it.

```rank
use algo
H = new heap
H 2 "later" enqueue
H 1 "first" enqueue
H peek
```

## peekback

### NAME

Last value of a deque, left in place.

### SYNOPSIS

```text
Ends peekback -> element
Ends: deque
```

### DESCRIPTION

The front is the first item and the back
the last. Peek leaves the item in place;
pop removes it; push inserts it. Reading
an empty deque raises a missing-value
error.

### EXAMPLES

Use the named front or back of a
two-ended queue.

```rank
use algo
D = new deque
D 1 pushback
D 2 pushback
D peekback
```

## peekfront

### NAME

First value of a deque, left in place.

### SYNOPSIS

```text
Ends peekfront -> element
Ends: deque
```

### DESCRIPTION

The front is the first item and the back
the last. Peek leaves the item in place;
pop removes it; push inserts it. Reading
an empty deque raises a missing-value
error.

### EXAMPLES

Use the named front or back of a
two-ended queue.

```rank
use algo
D = new deque
D 1 pushback
D 2 pushback
D peekfront
```

## permutations

### NAME

Lazy sequence of every ordering of the
values.

### SYNOPSIS

```text
Values permutations -> sequence
Values: finite collection
```

### DESCRIPTION

The input is a finite one-dimensional
collection. Generated combinations and
permutations are lazy, so consume only
the results you need. Values are
produced on demand; storing the result
does not force every item.

### EXAMPLES

Enumerate all orders of three items.

```rank
use algo
(array 1 2 3) permutations
```

## pop

### NAME

Removes and returns the next value of a
queue, stack, deque or heap.

### SYNOPSIS

```text
Q pop -> element
Q: queue, stack, deque or heap
```

### DESCRIPTION

Queue removal is oldest-first; stack
removal is newest-first. A heap removes
the smallest priority first. Reading an
empty container raises a missing-value
error. This operation changes the
receiver in place.

### EXAMPLES

Remove the next payload.

```rank
use algo
H = new heap
H 2 "later" enqueue
H 1 "first" enqueue
H pop
```

## popback

### NAME

Removes and returns the last value of a
deque.

### SYNOPSIS

```text
Ends popback -> element
Ends: deque
```

### DESCRIPTION

The front is the first item and the back
the last. Peek leaves the item in place;
pop removes it; push inserts it. Reading
an empty deque raises a missing-value
error. This operation changes the
receiver in place.

### EXAMPLES

Use the named front or back of a
two-ended queue.

```rank
use algo
D = new deque
D 1 pushback
D 2 pushback
D popback
```

## popfront

### NAME

Removes and returns the first value of a
deque.

### SYNOPSIS

```text
Ends popfront -> element
Ends: deque
```

### DESCRIPTION

The front is the first item and the back
the last. Peek leaves the item in place;
pop removes it; push inserts it. Reading
an empty deque raises a missing-value
error. This operation changes the
receiver in place.

### EXAMPLES

Use the named front or back of a
two-ended queue.

```rank
use algo
D = new deque
D 1 pushback
D 2 pushback
D popfront
```

## pushback

### NAME

Appends a value to the back of a deque.

### SYNOPSIS

```text
Ends Value pushback -> collection
Ends: deque; Value: item
```

### DESCRIPTION

The front is the first item and the back
the last. Peek leaves the item in place;
pop removes it; push inserts it. Reading
an empty deque raises a missing-value
error. This operation changes the
receiver in place.

### EXAMPLES

Use the named front or back of a
two-ended queue.

```rank
use algo
D = new deque
D 1 pushback
D 2 pushback
D 3 pushback
D len
```

## pushfront

### NAME

Adds a value to the front of a deque.

### SYNOPSIS

```text
Ends Value pushfront -> collection
Ends: deque; Value: item
```

### DESCRIPTION

The front is the first item and the back
the last. Peek leaves the item in place;
pop removes it; push inserts it. Reading
an empty deque raises a missing-value
error. This operation changes the
receiver in place.

### EXAMPLES

Use the named front or back of a
two-ended queue.

```rank
use algo
D = new deque
D 1 pushback
D 2 pushback
D 3 pushfront
D len
```

## query

### NAME

Reduces an inclusive segment-tree range
in left-to-right order.

### SYNOPSIS

```text
Tree Left Right query -> element
Tree: segment; Left, Right: integer
indices
```

### DESCRIPTION

Left and Right are inclusive zero-based
positions in the segment tree. Left must
not exceed Right; out-of-bounds
positions raise an error.

### EXAMPLES

Sum positions 1 through 2: 8.

```rank
use algo
S = (array 2 3 5) segment +
S 1 2 query
```

## remove

### NAME

Removes one occurrence from a set,
counter or multiset.

### SYNOPSIS

```text
Bag remove Value -> collection
Bag: multiset; Value: item
```

### DESCRIPTION

An ordered multiset keeps duplicates. A
lookup with no qualifying value raises a
missing-value error; append default to
supply a fallback. This operation
changes the receiver in place.

### EXAMPLES

Remove one occurrence of 5.

```rank
use algo
Bag = (array 2 5 5 9) multiset
Bag remove 5
Bag len
```

## segment

### NAME

Segment tree over one associative binary
operation.

### SYNOPSIS

```text
Values segment Operation -> segment
Values: vector; Operation: binary
combiner
```

### DESCRIPTION

The binary combiner must be associative.
query uses inclusive zero-based bounds.
Point assignment updates the stored
values and their aggregates.

### EXAMPLES

Build a sum tree and sum all three
cells.

```rank
use algo
S = (array 2 3 5) segment +
S 0 2 query
```

## sumwithin

### NAME

Sums wavelet values inside inclusive
position and value ranges.

### SYNOPSIS

```text
Data Left Right Low High sumwithin ->
number
Data: numeric wavelet
Left, Right: integer indices
Low, High: numbers
```

### DESCRIPTION

Both positional and value bounds are
inclusive. within counts qualifying
cells; sumwithin adds them and requires
numeric values.

### EXAMPLES

Consider positions 0..3 and values 2..4.

```rank
use algo
W = (array 3 1 2 5) wavelet
W 0 3 2 4 sumwithin
```

## upperbound

### NAME

Smallest stored value greater than the
query.

### SYNOPSIS

```text
Bag upperbound Value -> element
Bag: ordered multiset; Value: item
```

### DESCRIPTION

An ordered multiset keeps duplicates. A
lookup with no qualifying value raises a
missing-value error; append default to
supply a fallback.

### EXAMPLES

Find the first value strictly above 5.

```rank
use algo
Bag = (array 2 5 5 9) multiset
Bag 5 upperbound
```

## wavelet

### NAME

Immutable wavelet matrix for range
counts and sums.

### SYNOPSIS

```text
Values wavelet -> structure
Values: comparable vector
```

### DESCRIPTION

The input is a one-dimensional
collection of comparable values. Values
must have compatible types.

### EXAMPLES

Index values for range-count queries.

```rank
use algo
(array 3 1 2) wavelet
```

## within

### NAME

Counts wavelet values inside inclusive
position and value ranges.

### SYNOPSIS

```text
Data Left Right Low High within ->
integer
Data: wavelet; Left, Right: integer
indices
Low, High: comparable values
```

### DESCRIPTION

Both positional and value bounds are
inclusive. within counts qualifying
cells; sumwithin adds them and requires
numeric values.

### EXAMPLES

Consider positions 0..3 and values 2..4.

```rank
use algo
W = (array 3 1 2 5) wavelet
W 0 3 2 4 within
```
