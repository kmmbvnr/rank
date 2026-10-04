# algo manual

## index

A lookup table from keys to values, like
a dictionary.

```rank
use algo
Colors = new index
Colors "red" = 3
Colors "red"
```

```result
3
```

### Usage

```text
Name = new index
Name Key = Value
Name Key
```

Keys can be numbers, text or other
single values, and need not be
consecutive. Give each index a name
with new index.

### Notes

Reading a key that was never stored is
an error. Add default for a fallback:
`Colors "blue" default 0`.

### See also

new, add, default

## new

Create an empty container: a queue,
stack, deque, heap, set or counter.

```rank
use algo
Q = new queue
Q push 7
Q pop
```

```result
7
```

### Usage

```text
new Kind
new Kind Items
```

With Items, the container starts with
each item of that collection: a queue,
stack, deque or heap is pushed in order,
a set, counter or multiset is added to.

Containers change in place. Giving one a
second name does not copy it: both names
refer to the same container.

### See also

push, pop, add, pushback

## push

Put a value into a queue, stack or heap.

```rank
use algo
Q = new queue
Q push 1
Q push 2
Q pop
```

```result
1
```

### Usage

```text
Container push Value
Container push unpack Items
```

push Value puts one value in, even an
array. push unpack Items puts each item
in.

What pop gives back next depends on the
container: a queue gives the oldest
value, a stack the newest, a heap the
smallest.

### See also

pop, peek, enqueue, new

## add

Put a value into a set, counter or
multiset.

```rank
use algo
Bag = (array 2 5 5 9) multiset
Bag add 7
Bag len
```

```result
5
```

### Usage

```text
Container add Value
```

A set ignores a value it already has. A
counter adds one to its count. A
multiset keeps every copy.

### See also

remove, new, multiset

## ceiling

The smallest value in a multiset that is
at least a limit.

```rank
use algo
Bag = (array 2 5 5 9) multiset
Bag 6 ceiling
```

```result
9
```

### Usage

```text
Bag Limit ceiling
```

### Notes

If every value is below Limit, it is an
error. Add default for a fallback.

### See also

floor, upperbound, lowerbound, multiset

## combinations

Every way to pick N items, ignoring
order.

The pairs from 1 2 3 are 1 2, 1 3 and 2
3.

```rank
use algo
(array 1 2 3) 2 combinations
```

```result
1 2 1 3 2 3
```

### Usage

```text
Values Count combinations
```

Each item is used at most once, and the
pairs keep the input order. Results are
made one at a time as you read them, so
even huge counts are fine if you only
read a few.

### See also

multicomb, permutations, binomial

## enqueue

Add a value to a heap with its own
priority.

The value with the smallest priority
comes out first.

```rank
use algo
H = new heap
H 2 "later" enqueue
H 1 "first" enqueue
H pop
```

```result
first
```

### Usage

```text
Heap Priority Value enqueue
```

Use this when the order you want is not
the value itself, such as tasks ranked
by distance.

### See also

push, pop, peek, new

## fenwick

A list of numbers that can quickly sum
the first N of them while changing.

Positions start at zero; the sum through
position 2 adds positions 0, 1 and 2.

```rank
use algo
F = 4 fenwick
F 1 = 5
F 3 = 2
F sum 2
```

```result
5
```

### Usage

```text
Size fenwick
Tree Position = Value
Tree sum Position
```

All cells start at zero. Both setting a
cell and summing take very little time,
even for millions of cells.

### See also

segment, query, sum

## firstatleast

The first position where a running total
reaches a target.

The running totals are 2, 5, 10; the
first to reach 4 is at position 1.

```rank
use algo
S = (array 2 3 5) segment +
S 4 firstatleast
```

```result
1
```

### Usage

```text
Tree Target firstatleast
```

Works on a segment tree. The running
total must only ever grow, so the values
should not be negative.

### See also

segment, query

## floor

The largest value in a multiset that is
at most a limit.

```rank
use algo
Bag = (array 2 5 5 9) multiset
Bag 6 floor
```

```result
5
```

### Usage

```text
Bag Limit floor
```

### Notes

If every value is above Limit, it is an
error. Add default for a fallback.

### See also

ceiling, lowerbound, multiset

## lowerbound

Another name for ceiling: the smallest
value at least a limit.

```rank
use algo
Bag = (array 2 5 5 9) multiset
Bag 5 lowerbound
```

```result
5
```

### Usage

```text
Bag Limit lowerbound
```

### See also

ceiling, upperbound

## maxsum

Set up a segment tree to find the best
sum of a run of neighbours.

The best run in -2 4 -1 is just 4.

```rank
use algo
S = (array -2 4 -1) segment maxsum
R = S 0 2 query
R .best
```

```result
4
```

### Usage

```text
Values segment maxsum
```

Use it in place of an operator after
segment. A query then gives a record
with .sum, .prefix, .suffix and .best,
where .best is the largest sum of a run
of neighbouring items.

### See also

segment, query

## missing

The smallest total you cannot make by
adding up some of the numbers in a
range.

From 1, 2 and 7 you can make 1, 2 and 3,
but not 4.

```rank
use algo
W = (array 1 2 7) wavelet
W (array 0 2) missing
```

```result
4
```

### Usage

```text
Data Bounds missing
```

Data is a wavelet of positive integers.
Bounds is a pair of positions, both
included.

### See also

wavelet, within

## multicomb

Every way to pick N items when an item
may be picked more than once.

```rank
use algo
(array 1 2) 2 multicomb
```

```result
1 1 1 2 2 2
```

### Usage

```text
Values Count multicomb
```

From 1 2 the pairs are 1 1, 1 2 and 2 2.
Results are made one at a time as you
read them.

### See also

combinations, permutations

## multiset

A sorted collection that keeps
duplicates and can quickly find nearby
values.

```rank
use algo
Bag = (array 3 1 3) multiset
Bag 2 ceiling
```

```result
3
```

### Usage

```text
Values multiset
```

Values stay sorted as you add and remove
them. Look up neighbours with floor,
ceiling and upperbound.

### See also

add, remove, floor, ceiling

## peek

Look at the next value of a queue, stack
or heap without removing it.

```rank
use algo
H = new heap
H 2 "later" enqueue
H 1 "first" enqueue
H peek
```

```result
first
```

### Usage

```text
Container peek
```

### Notes

Peeking at an empty container is an
error.

### See also

pop, push

## peekback

Look at the last value of a deque
without removing it.

```rank
use algo
D = new deque
D 1 pushback
D 2 pushback
D peekback
```

```result
2
```

### Usage

```text
Deque peekback
```

### See also

peekfront, popback, pushback

## peekfront

Look at the first value of a deque
without removing it.

```rank
use algo
D = new deque
D 1 pushback
D 2 pushback
D peekfront
```

```result
1
```

### Usage

```text
Deque peekfront
```

### See also

peekback, popfront, pushfront

## permutations

Every possible order of the items.

```rank
use algo
P = (array 1 2 3) permutations
P array len
```

```result
6
```

### Usage

```text
Values permutations
```

n items have n × (n−1) × … × 1 orders,
which grows fast. The orders are made
one at a time as you read them, so stop
early with take or first where.

### See also

combinations, multicomb

## pop

Take the next value out of a queue,
stack or heap.

```rank
use algo
H = new heap
H 2 "later" enqueue
H 1 "first" enqueue
H pop
```

```result
first
```

### Usage

```text
Container pop
```

A queue gives the oldest value, a stack
the newest, a heap the smallest.

### Notes

Popping from an empty container is an
error.

### See also

push, peek, enqueue

## popback

Take the last value off a deque.

```rank
use algo
D = new deque
D 1 pushback
D 2 pushback
D popback
```

```result
2
```

### Usage

```text
Deque popback
```

### See also

popfront, pushback, peekback

## popfront

Take the first value off a deque.

```rank
use algo
D = new deque
D 1 pushback
D 2 pushback
D popfront
```

```result
1
```

### Usage

```text
Deque popfront
```

### See also

popback, pushfront, peekfront

## pushback

Add a value at the back of a deque.

```rank
use algo
D = new deque
D 1 pushback
D 2 pushback
D peekback
```

```result
2
```

### Usage

```text
Deque Value pushback
```

A deque is a line you can add to or take
from at both ends.

### See also

pushfront, popback, new

## pushfront

Add a value at the front of a deque.

```rank
use algo
D = new deque
D 1 pushback
D 2 pushfront
D peekfront
```

```result
2
```

### Usage

```text
Deque Value pushfront
```

### See also

pushback, popfront, new

## query

Combine a range of a segment tree, such
as the sum of positions 1 to 2.

```rank
use algo
S = (array 2 3 5) segment +
S 1 2 query
```

```result
8
```

### Usage

```text
Tree From To query
```

Both ends are included, and positions
start at zero.

### See also

segment, firstatleast

## remove

Take one copy of a value out of a set,
counter or multiset.

```rank
use algo
Bag = (array 2 5 5 9) multiset
Bag remove 5
Bag len
```

```result
3
```

### Usage

```text
Container remove Value
```

From a multiset, only one copy is
removed.

### See also

add, multiset

## segment

A list that can quickly combine any
range, even while values change.

Change position 1 to 10, then sum
everything.

```rank
use algo
S = (array 2 3 5) segment +
S 1 = 10
S 0 2 query
```

```result
17
```

### Usage

```text
Values segment Operator
Tree Position = Value
```

The operator combines two values, such
as +, max or min. It must give the same
answer however the values are grouped,
as + does.

### See also

query, firstatleast, maxsum, fenwick

## sumwithin

Add up the values in a range of
positions that also fall in a range of
sizes.

Among positions 0 to 3, the values from
2 to 4 are 3 and 2.

```rank
use algo
W = (array 3 1 2 5) wavelet
W 0 3 2 4 sumwithin
```

```result
5
```

### Usage

```text
Data From To Low High sumwithin
```

All four bounds are included.

### See also

within, wavelet

## upperbound

The smallest value in a multiset
strictly greater than a limit.

```rank
use algo
Bag = (array 2 5 5 9) multiset
Bag 5 upperbound
```

```result
9
```

### Usage

```text
Bag Limit upperbound
```

### Notes

If no value is greater, it is an error.
Add default for a fallback.

### See also

ceiling, lowerbound

## wavelet

Prepare a list for fast range questions,
such as how many values in positions 10
to 500 lie between 3 and 7.

```rank
use algo
W = (array 3 1 2 5) wavelet
W 0 3 2 4 within
```

```result
2
```

### Usage

```text
Values wavelet
```

The list cannot be changed afterwards.
Ask questions with within, sumwithin and
missing.

### See also

within, sumwithin, missing

## within

Count the values in a range of positions
that also fall in a range of sizes.

Among positions 0 to 3, two values lie
between 2 and 4.

```rank
use algo
W = (array 3 1 2 5) wavelet
W 0 3 2 4 within
```

```result
2
```

### Usage

```text
Data From To Low High within
```

All four bounds are included.

### See also

sumwithin, wavelet
