# sequences manual

## shape

### NAME

Axis lengths as a rank-1 array.

### SYNOPSIS

```text
Value shape -> integer array
array shape Dimensions fill Value
Value: array or collection
Dimensions: nonnegative integers
```

### DESCRIPTION

Postfix shape returns the axis lengths.
The constructor array shape specifies
axis lengths before the cells or fill
value.

### EXAMPLES

Read the two axis lengths: 2, 3.

```rank
use sequences
A = array shape 2 3 fill 0
A shape
```

## all

### NAME

True when every boolean cell is true;
empty collections are true.

### SYNOPSIS

```text
Mask all -> boolean
Mask: boolean collection
```

### DESCRIPTION

Requires boolean cells. Empty input
gives true; evaluation stops when a
false item is found.

### EXAMPLES

Every cell is true: true.

```rank
use sequences
(array true true) all
```

## any

### NAME

True when one boolean cell is true;
empty collections are false.

### SYNOPSIS

```text
Mask any -> boolean
Mask: boolean collection
```

### DESCRIPTION

Requires boolean cells. Empty input
gives false; evaluation stops when a
true item is found.

### EXAMPLES

At least one cell is true: true.

```rank
use sequences
(array false true) any
```

## argsort

### NAME

Stable zero-based positions that put the
values in order.

### SYNOPSIS

```text
Values argsort .descending -> array
Values: comparable vector
```

### DESCRIPTION

Returns source positions, not the sorted
values. Sorting is stable; equal items
keep their original order.

### EXAMPLES

Positions in sorted order are 1, 2, 0.

```rank
use sequences
(array 8 2 5) argsort
```

## choose

### NAME

Selects each cell by a boolean mask;
SQLite expressions become CASE.

### SYNOPSIS

```text
Mask TrueValues FalseValues choose ->
value
Mask: booleans; TrueValues, FalseValues:
values of compatible shapes
```

### DESCRIPTION

A boolean mask selects between
corresponding cells of two values. With
two operands, an integer index selects
from a collection of choices. Values are
produced on demand; storing the result
does not force every item.

### EXAMPLES

Select 2 from the first array and 8 from
the second.

```rank
use sequences
M = array true false
M (array 2 3) (array 7 8) choose
```

## copy

### NAME

Independent dense copy of an array or
finite sequence; equally shaped array or
sequence items stack.

### SYNOPSIS

```text
Values copy -> array
Values: finite array or sequence
```

### DESCRIPTION

Eagerly evaluates a finite array or
sequence. Later writes to the source do
not alter the copy.

### EXAMPLES

Create an independent dense copy.

```rank
use sequences
A = array 1 2 3
A copy
```

## stack

### NAME

Lazy array of equally shaped array or
sequence items; their axes follow the
frame of Items. copy is the eager form.

### SYNOPSIS

```text
Items stack -> array
Items: arrays of equal shape
```

### DESCRIPTION

All input arrays must have the same
shape. A new leading axis separates the
items.

### EXAMPLES

Stack two equal-shaped arrays.

```rank
use sequences
A = array 1 2
B = array 3 4
(array A B) stack
```

## count

### NAME

Number of true cells, or of source items
a lazy mask selects.

### SYNOPSIS

```text
Mask count -> integer
Mask: boolean collection or column
```

### DESCRIPTION

Counts true boolean cells. Table-column
reductions count present values; missing
cells are skipped.

### EXAMPLES

Count true cells: 2.

```rank
use sequences
(array true false true) count
```

## find

### NAME

First zero-based position equal to
Target in a vector or text; an array of
targets finds each.

### SYNOPSIS

```text
Values Target find -> integer
Values: vector or text; Target: item
```

### DESCRIPTION

Returns a zero-based position. No match
raises a missing-value error; use
default for a fallback.

### EXAMPLES

The first 2 occurs at position 1.

```rank
use sequences
(array 5 2 5) 2 find
```

## findall

### NAME

Every zero-based position equal to
Target in a vector or text; an array of
targets needs equal counts.

### SYNOPSIS

```text
Values Target findall -> array
Values: vector or text; Target: item(s)
```

### DESCRIPTION

Returns every matching position in
order. No matches give an empty array;
array targets require compatible match
counts.

### EXAMPLES

5 occurs at positions 0 and 2.

```rank
use sequences
(array 5 2 5) 5 findall
```

## flat

### NAME

Copies records into fixed-width storage;
Count State flat initializes a compact
array.

### SYNOPSIS

```text
Values flat -> array
Values: record array with one schema
```

### DESCRIPTION

Input records must share a fixed schema.
The first record establishes the field
layout; empty input cannot infer it.

### EXAMPLES

Store a record array in compact field
storage.

```rank
use sequences
R = record
  .x = 3
end
(array R) flat
```

## fibonacci

### NAME

Unbounded lazy Fibonacci numbers; bound
with to, till, from or after.

### SYNOPSIS

```text
fibonacci -> sequence
No operands; an infinite sequence value
```

### DESCRIPTION

The sequence is infinite and lazy. Bound
it with take, to or till before
converting it to a dense array. Values
are produced on demand; storing the
result does not force every item.

### EXAMPLES

Read only six terms: 1, 2, 3, 5, 8, 13.

```rank
use sequences
fibonacci take 6
```

## indices

### NAME

Zero-based positions of the true values
in a boolean vector.

### SYNOPSIS

```text
Mask indices -> array
Mask: boolean vector
```

### DESCRIPTION

Input is a one-dimensional boolean mask.
Returns zero-based positions in source
order.

### EXAMPLES

True cells are at positions 1 and 2.

```rank
use sequences
(array false true true) indices
```

## reverse

### NAME

Reverses text by code point, an array
along its leading axis, or a queue or
finite sequence into an array.

### SYNOPSIS

```text
Values reverse -> value
Values: text or finite collection
```

### DESCRIPTION

Arrays reverse their leading axis.
Queues and finite sequences are
collected into a reversed array.

### EXAMPLES

Reverse the code points: cba.

```rank
use sequences
"abc" reverse
```

## first

### NAME

First item of text, an array, a queue or
a sequence; missing when empty.

### SYNOPSIS

```text
Values first -> element
Values: text or collection
```

### DESCRIPTION

Text returns its first code point. Empty
input raises a missing-value error;
append default to supply a fallback.

### EXAMPLES

Read the first item: 7.

```rank
use sequences
(array 7 8) first
```

## last

### NAME

Last item of text, an array, a queue or
a finite sequence; missing when empty.

### SYNOPSIS

```text
Values last -> element
Values: text or finite collection
```

### DESCRIPTION

A sequence must be finite. Empty input
raises a missing-value error; append
default to supply a fallback.

### EXAMPLES

Read the last item: 8.

```rank
use sequences
(array 7 8) last
```

## primes

### NAME

Unbounded ascending primes, with planned
membership and positional seeking.

### SYNOPSIS

```text
primes -> sequence
No operands; an infinite sequence value
```

### DESCRIPTION

The ascending sequence is infinite and
lazy. Use take or a value bound before
materializing it. Values are produced on
demand; storing the result does not
force every item.

### EXAMPLES

Read the first five primes: 2, 3, 5, 7,
11.

```rank
use sequences
primes take 5
```

## reshape

### NAME

Dense array in row-major order, the
element count matching exactly; a matrix
of shapes reshapes once per row.

### SYNOPSIS

```text
Values Shape reshape -> array
Values: finite array; Shape: integers
```

### DESCRIPTION

Dimensions are nonnegative integers.
Their product must exactly equal the
number of source cells; values are
placed in row-major order.

### EXAMPLES

Arrange six items into a 2-by-3 matrix.

```rank
use sequences
A = 1 to 6
A (array 2 3) reshape
```

## sort

### NAME

Stable sort into a new rank-1 array,
ascending by default.

### SYNOPSIS

```text
Values sort .descending -> array
Values: comparable vector
```

### DESCRIPTION

Ascending order is the default. A
trailing .descending reverses the
direction; equal items keep their source
order.

### EXAMPLES

Return a new array ordered 2, 5, 8.

```rank
use sequences
(array 8 2 5) sort
```

## transpose

### NAME

Reverses the axes of an array.

### SYNOPSIS

```text
Matrix transpose -> array
Matrix: array
```

### DESCRIPTION

Reverses the order of axes. A scalar or
vector keeps its shape; an N-dimensional
array has its axis order reversed.

### EXAMPLES

Exchange rows and columns.

```rank
use sequences
A = array shape 2 2
  1 2
  3 4
end
A transpose
```

## unique

### NAME

Distinct values in first-appearance
order.

### SYNOPSIS

```text
Values unique -> same collection kind
Values: text or one-dimensional
collection
```

### DESCRIPTION

Keeps only the first occurrence of each
value, in source order. Text stays text;
arrays stay arrays, and sequences stay
lazy.

### EXAMPLES

Remove repeated equal values.

```rank
use sequences
(array 2 1 2 3) unique
```

## window

### NAME

Overlapping complete cells of that size,
with optional stride, padding and
padding value.

### SYNOPSIS

```text
Values Width window -> array
Values: array; Width: positive integer
```

### DESCRIPTION

Width is a positive integer. Complete
windows overlap along the leading axis;
oversized windows produce no complete
window. Values are produced on demand;
storing the result does not force every
item.

### EXAMPLES

Read adjacent pairs [1,2], [2,3], [3,4].

```rank
use sequences
(array 1 2 3 4) 2 window
```

## shift

### NAME

Moves items along an axis, keeping the
shape; vacated positions read zero or a
with value.

### SYNOPSIS

```text
Values Count shift -> array
Values: array; Count: signed integer
```

### DESCRIPTION

Count is a signed integer. Cells shifted
beyond an edge are replaced by the fill
value; this does not wrap like rotation.
Values are produced on demand; storing
the result does not force every item.

### EXAMPLES

Move cells with the default zero fill.

```rank
use sequences
(array 1 2 3) 1 shift
```
