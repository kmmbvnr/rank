# sequences manual

## shape

The size of an array along each axis.

A matrix with 2 rows and 3 columns.

```rank
use sequences
A = array shape 2 3 fill 0
A shape
```

```result
2 3
```

### Usage

```text
Values shape
```

Gives one number per axis. For a simple
list that is just its length.

### See also

len, reshape, fill

## all

True when every item is true.

```rank
use sequences
(array true true) all
```

```result
true
```

### Usage

```text
Booleans all
```

Stops at the first false. An empty
collection gives true.

### See also

any, count

## any

True when at least one item is true.

```rank
use sequences
(array false true) any
```

```result
true
```

### Usage

```text
Booleans any
```

Stops at the first true. An empty
collection gives false.

### See also

all, count

## argsort

The positions that would put the values
in order.

The smallest value, 2, is at position 1;
then 5 at position 2; then 8 at position
0.

```rank
use sequences
(array 8 2 5) argsort
```

```result
1 2 0
```

### Usage

```text
Values argsort
Values argsort .descending
```

Gives positions, not values. Use them to
reorder another array the same way.
Equal values keep their original order.

### See also

sort, argsort by

## choose

Pick between two values cell by cell,
using true or false.

Where the mask is true, take from the
first array; where false, from the
second.

```rank
M = array true false
M choose (array 2 3) (array 7 8)
```

```result
2 8
```

### Usage

```text
Mask choose IfTrue IfFalse
Positions choose Options
```

The second form picks items by position:
`(array 2 0) choose (array "a" "b" "c")`
gives c a.

`choose` needs no `use` statement.
The earlier postfix forms still work.
Group a multi-step condition, such as
`(Grid I J)`, in parentheses.

### See also

filter, indices

## copy

Make an independent copy of an array.

```rank
use sequences
A = array 1 2 3
B = A copy
B 0 = 9
A
```

```result
1 2 3
```

### Usage

```text
Values copy
```

Changing the copy leaves the original
alone. Also turns a finite sequence into
an array right away.

### See also

stack, array

## stack

Put arrays of the same shape together as
rows of a bigger array.

Two lists of 2 make a 2-by-2 matrix.

```rank
use sequences
A = array 1 2
B = array 3 4
S = stack A B
S shape
```

```result
2 2
```

### Usage

```text
Arrays stack
```

All arrays must have the same shape.
Items are computed only when read; use
copy to compute them all at once.

### See also

copy, reshape

## count

How many items are true.

```rank
use sequences
(array true false true) count
```

```result
2
```

### Usage

```text
Booleans count
```

Inside a grouped select, counts the rows
of each group. On a table column, counts
the cells that have a value.

### See also

sum, filter, group by

## find

The position of the first item equal to
a value.

```rank
use sequences
"banana" "a" find
```

```result
1
```

### Usage

```text
Values Target find
```

Works on arrays and text. Positions
start at zero. With an array of targets,
finds each one.

### Notes

Not found is an error. Add default for a
fallback.

### See also

findall, first index where, default

## findall

The positions of every item equal to a
value.

```rank
use sequences
"banana" "a" findall
```

```result
1 3 5
```

### Usage

```text
Values Target findall
```

Works on arrays and text. No match gives
an empty array.

### See also

find, indices

## flat

Store an array of records compactly,
field by field.

```rank
use sequences
R = record
  .x = 3
end
F = (array R) flat
F 0 .x
```

```result
3
```

### Usage

```text
Records flat
```

All records must have the same fields.
Useful for large arrays of records,
which then take less memory.

### See also

record

## fibonacci

The Fibonacci numbers, one after
another, forever.

```rank
use sequences
fibonacci take 6
```

```result
1 2 3 5 8 13
```

### Usage

```text
fibonacci
```

The sequence never ends, so cut it with
take, to or till before using it:
`fibonacci to 100` keeps the numbers up
to 100.

### See also

primes, take, to

## indices

The positions of the true items.

```rank
use sequences
(array false true true) indices
```

```result
1 2
```

### Usage

```text
Booleans indices
```

Positions start at zero. Pair it with a
comparison: `A greater 3 indices`.

### See also

findall, filter

## reverse

Put the items in the opposite order.

```rank
use sequences
"abc" reverse
```

```result
cba
```

### Usage

```text
Values reverse
```

Works on text, arrays and finite
sequences. A matrix reverses the order
of its rows.

### See also

sort, transpose

## first

The first item.

```rank
use sequences
(array 7 8) first
```

```result
7
```

### Usage

```text
Values first
```

Works on text, arrays and sequences,
including endless ones.

### Notes

An empty input is an error. Add default
for a fallback.

### See also

last, take, first where

## last

The last item.

```rank
use sequences
(array 7 8) last
```

```result
8
```

### Usage

```text
Values last
```

Works on text, arrays and finite
sequences.

### Notes

An empty input is an error. Add default
for a fallback.

### See also

first, drop

## primes

The prime numbers, smallest first,
forever.

```rank
use sequences
primes till 20
```

```result
2 3 5 7 11 13 17 19
```

### Usage

```text
primes
```

The sequence never ends, so cut it with
take, to or till. `7 in primes` checks
whether 7 is prime.

### See also

fibonacci, factors, take

## reshape

Arrange items into a new shape, row by
row.

```rank
use sequences
A = 1 to 6
B = A reshape 2 3
B 1
```

```result
4 5 6
```

### Usage

```text
Values reshape Dim...
Values reshape unpack Shape
```

Dimensions follow `reshape`. Expand an
existing shape vector with `unpack`.
The new shape must hold exactly as many
items as the input: 2 × 3 = 6.

### See also

shape, transpose, stack

## sort

Put items in order, smallest first.

```rank
use sequences
(array 8 2 5) sort
```

```result
2 5 8
```

### Usage

```text
Values sort
Values sort .descending
```

Gives a new array; the input is
unchanged. Equal items keep their
original order. Text sorts
alphabetically.

### See also

sort by, argsort, reverse

## merge

Read sorted streams as one sequence.

```rank
use sequences
(array 1 3 5) (array 2 4 6) merge array
```

```result
1 2 3 4 5 6
```

### Usage

```text
A B merge
Streams merge
Matrix merge .descending
Streams merge by .field
```

`merge` also accepts sorted matrix rows.
Inputs must follow the chosen direction.
A key function may replace `.field`.
Only requested values are read.

### See also

sort, transpose, first

## transpose

Swap rows and columns.

```rank
use sequences
A = array shape 2 2
  1 2
  3 4
end
A transpose
```

```result
1 3 2 4
```

### Usage

```text
Matrix transpose
```

A list stays as it is. For more than two
axes, the order of all axes is reversed.

### See also

reshape, reverse

## unique

Remove repeats, keeping the first of
each.

```rank
use sequences
(array 2 1 2 3) unique
```

```result
2 1 3
```

### Usage

```text
Values unique
```

The original order is kept. Text stays
text: `"hello" unique` is helo.

### See also

sort, count

## window

Every run of N neighbouring items.

Pairs of neighbours: 1 2, then 2 3, then
3 4.

```rank
use sequences
W = (array 1 2 3 4) window 2
W 1
```

```result
2 3
```

### Usage

```text
Values window Width
```

Each window is one row of the result.
Windows overlap and are all complete, so
a list shorter than Width gives none.

### See also

shift, scan

## shift

Slide items left or right, filling the
gap.

```rank
use sequences
(array 1 2 3) 1 shift
```

```result
0 1 2
```

### Usage

```text
Values Count shift
Values Count shift with Fill
```

A positive Count moves items right, a
negative one left. Items pushed past the
end are lost; the gap is filled with 0,
or with Fill.

### See also

window, reverse
