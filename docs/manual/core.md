# core manual

## array

### NAME

Construct an array or collect a
sequence.

### SYNOPSIS

```text
array Values
Sequence array
Result: array
Values: items or a finite sequence
```

### DESCRIPTION

Values are separated by spaces. Indices
start at zero. Postfix array
materializes a finite sequence; array
shape constructs a dense array.

### EXAMPLES

Create three items and read the first:
2.

```rank
A = array 2 7 11
A 0
```

## break

### NAME

Exit the nearest enclosing loop.

### SYNOPSIS

```text
for
  break
end
Capitalized words stand for your values.
```

### DESCRIPTION

Exits the nearest enclosing loop.
Execution continues with the statement
after its end.

### EXAMPLES

Leave the loop when N reaches 3.

```rank
N = 0
for
  N += 1
  if N equal 3
    break
  end
end
N
```

## catch

### NAME

Handle an error from a try block.

### SYNOPSIS

```text
try
  Statements
catch Error
  Statements
end
Capitalized words stand for your values.
```

### DESCRIPTION

The error record has fields such as
.Kind and .Message. The caught name
belongs to the catch block; ordinary
errors outside try still stop execution.

### EXAMPLES

Read the caught error message.

```rank
Result = "ok"
try
  X = 1 // 0
catch Error
  Result = Error .Message
end
Result
```

## continue

### NAME

Skip to the next loop iteration.

### SYNOPSIS

```text
for Item in Values
  continue
end
Capitalized words stand for your values.
```

### DESCRIPTION

Skips the rest of the current loop
iteration. The next iteration starts
normally.

### EXAMPLES

Skip 2 and add the other values: 4.

```rank
Total = 0
for i in 1 to 3
  if i equal 2
    continue
  end
  Total += i
end
Total
```

## elif

### NAME

Test another branch of an open if.

### SYNOPSIS

```text
if Condition
  Statements
elif Condition
  Statements
end
Capitalized words stand for your values.
```

### DESCRIPTION

Conditions are tested from top to
bottom. Only the first true branch runs;
elif must continue an open if block.

### EXAMPLES

Choose the second branch: zero.

```rank
N = 0
Kind = "negative"
if N greater 0
  Kind = "positive"
elif N equal 0
  Kind = "zero"
end
Kind
```

## else

### NAME

Run the fallback branch of an open if.

### SYNOPSIS

```text
if Condition
  Statements
else
  Statements
end
Capitalized words stand for your values.
```

### DESCRIPTION

Runs when no preceding if or elif
condition matched. It is optional and
must belong to the same open block.

### EXAMPLES

Use the fallback branch.

```rank
N = -1
Kind = "positive"
if N greater 0
  Kind = "positive"
else
  Kind = "nonpositive"
end
Kind
```

## end

### NAME

Close the nearest open block.

### SYNOPSIS

```text
Block
  Statements
end
Capitalized words stand for your values.
```

### DESCRIPTION

Closes the nearest open block, such as
if, for, fun or record. Indentation aids
reading; end determines the block
boundary.

### EXAMPLES

Close the if block, then read 7.

```rank
N = 0
if true
  N = 7
end
N
```

## false

### NAME

The false boolean value.

### SYNOPSIS

```text
false -> boolean
Capitalized words stand for your values.
```

### DESCRIPTION

A boolean is used by if, for and logical
operators. It is distinct from the
integer 0.

### EXAMPLES

The boolean false value.

```rank
false
```

## finally

### NAME

Run cleanup when leaving a try block.

### SYNOPSIS

```text
try
  Statements
finally
  Statements
end
Capitalized words stand for your values.
```

### DESCRIPTION

Runs when leaving try, including after
an error or return. Use it to release
resources; it does not catch an error by
itself.

### EXAMPLES

The cleanup block sets Done to true.

```rank
Done = false
try
  X = 1
finally
  Done = true
end
Done
```

## for

### NAME

Repeat statements over values or a
condition.

### SYNOPSIS

```text
for Item in Values
  Statements
end
Capitalized words stand for your values.
```

### DESCRIPTION

An iterable loop visits its values in
order. A condition form checks before
each iteration; bare for repeats until
break or return.

### EXAMPLES

Visit 1, 2, 3 and accumulate 6.

```rank
Total = 0
for i in 1 to 3
  Total += i
end
Total
```

## fun

### NAME

Define a reusable function.

### SYNOPSIS

```text
fun name Parameters
  return Value
end
Capitalized words stand for your values.
```

### DESCRIPTION

Parameters follow the function name in
its definition. Calls are data-first:
arguments precede the name. return ends
a value-returning function.

### EXAMPLES

Define a function and call it: 6.

```rank
fun twice X
  return X * 2
end
3 twice
```

## if

### NAME

Run statements when a condition is true.

### SYNOPSIS

```text
if Condition
  Statements
end
Capitalized words stand for your values.
```

### DESCRIPTION

Runs the body only when the condition is
true. New names inside a branch have
block scope; initialize a result outside
to use it after end.

### EXAMPLES

Execute the branch for a positive N.

```rank
N = 3
Result = 0
if N greater 0
  Result = 1
end
Result
```

## memo

### NAME

Define a function with cached results.

### SYNOPSIS

```text
memo name Parameters
  return Value
end
Capitalized words stand for your values.
```

### DESCRIPTION

Caches successful results by the
complete typed argument tuple. Only
scalar arguments and results are
supported. Errors are not cached;
captured-state changes do not invalidate
the cache.

### EXAMPLES

The second call reuses the cached 9.

```rank
memo square N
  return N * N
end
3 square
3 square
```

## not

### NAME

Reverse a boolean condition.

### SYNOPSIS

```text
not Value
Result: boolean or boolean array
Value: boolean value
```

### DESCRIPTION

Applies after function calls and
comparisons. It also negates each
boolean cell of an array.

### EXAMPLES

Reverse the boolean: true.

```rank
not false
```

## record

### NAME

Construct a value with named fields.

### SYNOPSIS

```text
record
  .field = Value
end
Capitalized words stand for your values.
```

### DESCRIPTION

Field names are dot-prefixed labels. A
record has a fixed set of fields; update
a field with R .age = 37.

### EXAMPLES

Create named fields and read Ada.

```rank
R = record
  .name = "Ada"
  .age = 36
end
R .name
```

## return

### NAME

End a function call with a result.

### SYNOPSIS

```text
return Value
Capitalized words stand for your values.
```

### DESCRIPTION

Ends the current function call
immediately. A bare return returns no
value; it does not exit the whole
program.

### EXAMPLES

Leave the function with a result: 3.

```rank
fun absolute X
  if X less 0
    return -X
  end
  return X
end
-3 absolute
```

## run

### NAME

Execute a source program's statements.

### SYNOPSIS

```text
run "program.ra"
Capitalized words stand for your values.
```

### DESCRIPTION

Unlike use, run executes ordinary
statements in the source file. This
example needs hello.ra in the program
host; file loading is host-dependent.

### EXAMPLES

Execute a program stored in a file.

```rank
run "hello.ra"
```

## true

### NAME

The true boolean value.

### SYNOPSIS

```text
true -> boolean
Capitalized words stand for your values.
```

### DESCRIPTION

A boolean is used by if, for and logical
operators. It is distinct from the
integer 1.

### EXAMPLES

The boolean true value.

```rank
true
```

## try

### NAME

Run statements with error handling.

### SYNOPSIS

```text
try
  Statements
catch Error
  Statements
end
Capitalized words stand for your values.
```

### DESCRIPTION

Runs the body and transfers control to
catch if an error is raised. finally,
when present, runs during cleanup.

### EXAMPLES

Catch the division error.

```rank
Result = "ok"
try
  X = 1 // 0
catch Error
  Result = "caught"
end
Result
```

## unpack

### NAME

Assign or expand items of an array or
tuple.

### SYNOPSIS

```text
unpack Names = Values
unpack Values
Capitalized words stand for your values.
```

### DESCRIPTION

The right side is a one-dimensional
array or a tuple. Before an expression,
unpack expands its items into adjacent
operands.

### EXAMPLES

Assign the two items to A and B: 5.

```rank
unpack A B = array 2 3
A + B
```

## use

### NAME

Import a module's functions or
definitions.

### SYNOPSIS

```text
use Module
use "module.ra" as Name
Capitalized words stand for your values.
```

### DESCRIPTION

Standard modules add their names to the
current program. A quoted source path
imports definitions without executing
the file's ordinary statements.

### EXAMPLES

Make sqrt available, then compute 3.0.

```rank
use numbers
9 sqrt
```

## yield

### NAME

Produce one item of a lazy sequence.

### SYNOPSIS

```text
yield Value
Capitalized words stand for your values.
```

### DESCRIPTION

A function containing yield produces a
lazy sequence. Each yield emits one item
and suspends; execution resumes when the
next item is requested.

### EXAMPLES

Collect a generator into an array: 2, 3.

```rank
fun small
  yield 2
  yield 3
end
use sequences
small array
```

## and

### NAME

Combine two conditions; both must hold.

### SYNOPSIS

```text
Left and Right
Result: boolean or boolean array
Left, Right: boolean values
```

### DESCRIPTION

For a scalar boolean, a false left side
skips the right side. Arrays combine
element by element and evaluate both
sides.

### EXAMPLES

Both must be true: the result is false.

```rank
true and false
```

## or

### NAME

Combine conditions; either may hold.

### SYNOPSIS

```text
Left or Right
Result: boolean or boolean array
Left, Right: boolean values
```

### DESCRIPTION

For a scalar boolean, a true left side
skips the right side. Arrays combine
element by element and evaluate both
sides.

### EXAMPLES

One true value is enough: true.

```rank
true or false
```

## xor

### NAME

Test whether exactly one condition
holds.

### SYNOPSIS

```text
Left xor Right
Result: boolean or boolean array
Left, Right: boolean values
```

### DESCRIPTION

Both operands are evaluated. The result
is false when both booleans are equal.

### EXAMPLES

Exactly one side is true: true.

```rank
true xor false
```

## equal

### NAME

Compare values for equality.

### SYNOPSIS

```text
Left equal Right
Result: boolean or boolean array
Left, Right: values
```

### DESCRIPTION

Compares array cells element by element.
For whole-array equality, use a test
block or reduce the resulting boolean
mask with all.

### EXAMPLES

Compare values: true.

```rank
3 equal 3
```

## not equal

### NAME

Compare values for inequality.

### SYNOPSIS

```text
Left not equal Right
Result: boolean or boolean array
Left, Right: values
```

### DESCRIPTION

This is the negation of equal. Arrays
produce a mask rather than one
whole-array boolean.

### EXAMPLES

Different values compare true.

```rank
3 not equal 4
```

## less

### NAME

Test a strict upper bound.

### SYNOPSIS

```text
Left less Right
Result: boolean or boolean array
Left, Right: comparable values
```

### DESCRIPTION

Compares numbers or ordered values.
Equality does not satisfy a strict
comparison.

### EXAMPLES

3 is strictly below 4: true.

```rank
3 less 4
```

## greater

### NAME

Test a strict lower bound.

### SYNOPSIS

```text
Left greater Right
Result: boolean or boolean array
Left, Right: comparable values
```

### DESCRIPTION

Compares numbers or ordered values.
Equality does not satisfy a strict
comparison.

### EXAMPLES

4 is strictly above 3: true.

```rank
4 greater 3
```

## at least

### NAME

Test an inclusive lower bound.

### SYNOPSIS

```text
Left at least Right
Result: boolean or boolean array
Left, Right: comparable values
```

### DESCRIPTION

Tests greater than or equal to the right
operand. Arrays compare cell by cell.

### EXAMPLES

The lower bound is inclusive: true.

```rank
3 at least 3
```

## at most

### NAME

Test an inclusive upper bound.

### SYNOPSIS

```text
Left at most Right
Result: boolean or boolean array
Left, Right: comparable values
```

### DESCRIPTION

Tests less than or equal to the right
operand. Arrays compare cell by cell.

### EXAMPLES

The upper bound is inclusive: true.

```rank
3 at most 3
```

## in

### NAME

Test collection membership.

### SYNOPSIS

```text
Value in Collection
Result: boolean or boolean array
Value: item or collection
Collection: collection of comparable
items
```

### DESCRIPTION

A scalar produces one boolean. A
collection on the left produces a
membership mask with the same shape.

### EXAMPLES

3 belongs to the collection: true.

```rank
3 in (array 1 3 5)
```

## is

### NAME

Test a value's runtime type.

### SYNOPSIS

```text
Value is .Type
Result: boolean
Value: any value; .Type: type label
```

### DESCRIPTION

The right operand is a type label,
beginning with a dot. Inside a branch
this test also narrows the known type.

### EXAMPLES

Check the runtime type: true.

```rank
42 is .integer
```

## to

### NAME

Make a range with an inclusive end.

### SYNOPSIS

```text
Low to High
Result: range or bounded values
Low, High: integers for a counting range
```

### DESCRIPTION

The upper bound is included. After a
collection, this word keeps values at
most the bound rather than counting
positions.

### EXAMPLES

The counting range is 1, 2, 3, 4, 5.

```rank
1 to 5
```

## till

### NAME

Make a range with an exclusive end.

### SYNOPSIS

```text
Low till High
Result: range or bounded values
Low, High: integers for a counting range
```

### DESCRIPTION

The upper bound is excluded. After a
collection it keeps values below the
bound; a predicate form stops at the
first matching value.

### EXAMPLES

The range stops before 5: 1, 2, 3, 4.

```rank
1 till 5
```

## by

### NAME

Set the step of a counting range.

### SYNOPSIS

```text
Low to High by Step
Result: counting range
Low, High, Step: integers; Step != 0
```

### DESCRIPTION

The step must be a nonzero integer. Its
sign controls direction; a step pointing
away from the end gives an empty range.

### EXAMPLES

Use a step of two: 1, 3, 5, 7.

```rank
1 to 7 by 2
```

## default

### NAME

Supply a fallback for a missing value.

### SYNOPSIS

```text
Address default Fallback
Result: value
Address: lookup that may be missing
Fallback: value or expression
```

### DESCRIPTION

The fallback is evaluated only when the
addressed value is missing. It does not
hide invalid negative indices, type
errors or division by zero.

### EXAMPLES

Use zero when index 5 is absent.

```rank
A = array 1 2
A 5 default 0
```

## fill

### NAME

Initialize all cells of a shaped array.

### SYNOPSIS

```text
array shape Dimensions fill Value
Result: array
Dimensions: nonnegative integers
Value: initial cell value
```

### DESCRIPTION

Dimensions are nonnegative integers.
Every cell starts with the fill value; a
zero dimension makes an empty array.

### EXAMPLES

Create a 2-by-3 matrix of zeros.

```rank
A = array shape 2 3 fill 0
A 1 2
```

## as

### NAME

Give an imported source module a
namespace.

### SYNOPSIS

```text
use "module.ra" as Name
Capitalized words stand for your values.
```

### DESCRIPTION

Use a capitalized namespace name after a
quoted source-module path. This example
requires helpers.ra to define fun twice
X returning X * 2.

### EXAMPLES

Call twice from an imported namespace.

```rank
use "helpers.ra" as H
3 H.twice
```

## axis

### NAME

Choose axes for a reduction.

### SYNOPSIS

```text
Values Function axis N
Result: array or reduction result
N: zero-based integer axis
```

### DESCRIPTION

Axes are numbered from zero. An
axis-qualified reduction combines cells
along the named axes while preserving
the other axes.

### EXAMPLES

Reduce the row axis to get column sums
4, 6.

```rank
A = array shape 2 2
  1 2
  3 4
end
A sum axis 0
```

## rank

### NAME

Apply a function to cells of a given
rank.

### SYNOPSIS

```text
Values Function rank N
Left Right Function rank M N
Result: array of function results
N, M: nonnegative integer cell ranks
```

### DESCRIPTION

Rank is the number of trailing axes
passed to each function call. Rank 0
means a scalar cell; rank 1 means a
vector. Leading axes are preserved.

### EXAMPLES

Sum each row separately: 3, 7.

```rank
use sequences
A = array shape 2 2
  1 2
  3 4
end
A sum rank 1
```

## reduce

### NAME

Combine items into one accumulator.

### SYNOPSIS

```text
Values reduce Operator
Result: accumulator value
Values: finite collection
Operator: binary combining function
```

### DESCRIPTION

Combines values from left to right. An
optional with Seed supplies the initial
accumulator. Infinite sequences cannot
be reduced completely.

### EXAMPLES

Combine the values into their sum: 9.

```rank
(array 2 3 4) reduce +
```

## scan

### NAME

Return successive accumulator values.

### SYNOPSIS

```text
Values scan Operator
Result: sequence of accumulators
Values: collection
Operator: binary combining function
```

### DESCRIPTION

Unlike reduce, scan returns each
intermediate accumulator. The result is
lazy; with Seed supplies an initial
value.

### EXAMPLES

Keep each running sum: 2, 5, 9.

```rank
(array 2 3 4) scan +
```

## outer

### NAME

Apply a function to all pairs of items.

### SYNOPSIS

```text
Left Right outer Operator
Result: array of pairwise results
Left, Right: arrays or finite
collections
Operator: pure binary function
```

### DESCRIPTION

Produces all pairwise combinations,
adding axes to the result. This is
different from matrix multiplication,
which contracts an axis.

### EXAMPLES

Add every item of A to every item of B.

```rank
A = array 1 2
B = array 10 20
A B outer +
```

## sort by

### NAME

Sort items stably by one or more keys.

### SYNOPSIS

```text
Values sort by Key
Result: sorted values
Values: finite collection
Key: field label or key function
```

### DESCRIPTION

A dot-prefixed key names a field.
Multiple keys are compared in order;
equal keys keep source order.

### EXAMPLES

Order the rows by their id field.

```rank
use json
use tables
use sequences
T = "[{\"id\":2},
  {\"id\":1}]" json
T sort by .id
```

## first where

### NAME

Find the first item satisfying a
condition.

### SYNOPSIS

```text
Values first where Condition
Result: element
Values: text, array or sequence
Condition: boolean expression per item
```

### DESCRIPTION

Searches in source order and stops after
the first match. No match raises a
missing-value error; default can supply
a fallback.

### EXAMPLES

Stop at the first match: 4.

```rank
(1 to 5) first where greater 3
```

## first index where

### NAME

Find the position of the first match.

### SYNOPSIS

```text
Values first index where Condition
Result: integer
Values: text, array or sequence
Condition: boolean expression per item
```

### DESCRIPTION

Searches in source order but returns the
position, not the value. No match raises
a missing-value error.

### EXAMPLES

The first match has zero-based position
3.

```rank
(1 to 5) first index where greater 3
```

## take

### NAME

Keep a given number of leading items.

### SYNOPSIS

```text
Values take Count
Result: text, array view or sequence
Values: text, array or sequence
Count: nonnegative integer
```

### DESCRIPTION

Count is a nonnegative integer. A count
beyond the source length is clamped;
take 0 reads nothing. A sequence remains
lazy.

### EXAMPLES

Keep the first three characters: abc.

```rank
"abcdef" take 3
```

## drop

### NAME

Skip a given number of leading items.

### SYNOPSIS

```text
Values drop Count
Result: text, array view or sequence
Values: text, array or sequence
Count: nonnegative integer
```

### DESCRIPTION

Count is a nonnegative integer. A count
beyond the source length gives an empty
result; drop 0 keeps everything.

### EXAMPLES

Skip three characters: def.

```rank
"abcdef" drop 3
```

## from

### NAME

Keep values at or above a lower bound.

### SYNOPSIS

```text
Values from Low
Result: bounded values
Values: text, array or sequence
Low: comparable lower bound
```

### DESCRIPTION

The lower bound is included. This
filters by value, not by position; use
drop to skip a number of leading items.

### EXAMPLES

Keep values starting at 3: 3, 4, 5.

```rank
use sequences
(1 to 5) from 3
```

## after

### NAME

Keep values above a strict lower bound.

### SYNOPSIS

```text
Values after Low
Result: bounded values
Values: text, array or sequence
Low: comparable lower bound
```

### DESCRIPTION

The lower bound is excluded. This
filters by value, not by position; use
drop for a positional tail.

### EXAMPLES

Keep values strictly above 3: 4, 5.

```rank
(1 to 5) after 3
```

## argsort by

### NAME

Return source positions in key order.

### SYNOPSIS

```text
Values argsort by Key
Result: integer array
Values: finite collection
Key: field label or key function
```

### DESCRIPTION

Uses the same stable key order as sort
by but returns zero-based source
positions, not rows.

### EXAMPLES

Return row positions ordered by id.

```rank
use json
use tables
use sequences
T = "[{\"id\":2},
  {\"id\":1}]" json
T argsort by .id
```

## group by

### NAME

Group rows with equal field values.

### SYNOPSIS

```text
Rows group by .field
Result: grouped table view
Rows: table; .field: column label
```

### DESCRIPTION

Creates a grouped view. Follow it with a
select block containing aggregate
calculations, such as count or sum.

### EXAMPLES

Group equal ids and count each group.

```rank
use json
use tables
use sequences
T = "[{\"id\":2},
  {\"id\":1}]" json
G = T group by .id
G select
  .n = count
end
```

## leftjoin by

### NAME

Match rows on shared keys, keeping left
rows.

### SYNOPSIS

```text
Left Right leftjoin by .field
Result: table
Left, Right: tables; .field: shared key
```

### DESCRIPTION

Keeps every left row, adding matching
right fields. An unmatched right field
is missing; default supplies a value. by
uses the same field names on both sides.

### EXAMPLES

Match rows on equal key values.

```rank
use json
use tables
L = "[{\"id\":1}]" json
R = "[{\"id\":1,\"n\":7}]" json
L R leftjoin by .id
```

## innerjoin by

### NAME

Keep row pairs matching shared keys.

### SYNOPSIS

```text
Left Right innerjoin by .field
Result: table
Left, Right: tables; .field: shared key
```

### DESCRIPTION

Keeps only left/right row pairs that
match. Multiple right matches repeat the
corresponding left row. by uses the same
field names on both sides.

### EXAMPLES

Match rows on equal key values.

```rank
use json
use tables
L = "[{\"id\":1}]" json
R = "[{\"id\":1,\"n\":7}]" json
L R innerjoin by .id
```

## leftjoin on

### NAME

Join on a condition, keeping left rows.

### SYNOPSIS

```text
L R leftjoin on .left equal .right
Result: table
L, R: tables; .left, .right: field
labels
```

### DESCRIPTION

Keeps every left row, adding matching
right fields. An unmatched right field
is missing; default supplies a value. on
takes a boolean condition; field names
on the two sides can differ.

### EXAMPLES

Match rows on equal key values.

```rank
use json
use tables
L = "[{\"id\":1}]" json
R = "[{\"key\":1}]" json
J = L R leftjoin on .id equal .key
J
```

## innerjoin on

### NAME

Keep row pairs satisfying a join
condition.

### SYNOPSIS

```text
L R innerjoin on .left equal .right
Result: table
L, R: tables; .left, .right: field
labels
```

### DESCRIPTION

Keeps only left/right row pairs that
match. Multiple right matches repeat the
corresponding left row. on takes a
boolean condition; field names on the
two sides can differ.

### EXAMPLES

Match rows on equal key values.

```rank
use json
use tables
L = "[{\"id\":1}]" json
R = "[{\"key\":1}]" json
J = L R innerjoin on .id equal .key
J
```

## filter

### NAME

Keep items satisfying a condition.

### SYNOPSIS

```text
Values filter Condition
Result: filtered values
Values: text, array, sequence or table
Condition: boolean expression per item
```

### DESCRIPTION

The current item is the implicit left
operand of the condition. Sequences
remain lazy; text keeps matching code
points.

### EXAMPLES

Keep only values 4 and 5.

```rank
(1 to 5) filter greater 3
```

## select

### NAME

Produce named table columns.

### SYNOPSIS

```text
Rows select .fields
Rows select
  .field = Expression
end
Result: table
Rows: table; .fields: column labels
```

### DESCRIPTION

Dot-prefixed assignments name result
columns. Within the block a field name
reads the corresponding input column;
ordinary local variables can hold
intermediate calculations.

### EXAMPLES

Compute a named output column.

```rank
use json
use tables
use sequences
T = "[{\"id\":2},
  {\"id\":1}]" json
T select
  .double = .id * 2
end
```

## ascending

### NAME

Select increasing sort order.

### SYNOPSIS

```text
Values sort .ascending
Capitalized words stand for your values.
```

### DESCRIPTION

This direction label follows sort or a
sort key. Increasing order is also the
default; equal items preserve their
original order.

### EXAMPLES

Sort in increasing order: 1, 2, 3.

```rank
use sequences
(array 3 1 2) sort .ascending
```

## descending

### NAME

Select decreasing sort order.

### SYNOPSIS

```text
Values sort .descending
Capitalized words stand for your values.
```

### DESCRIPTION

This direction label follows sort or a
sort key. Equal items preserve their
original order.

### EXAMPLES

Sort in decreasing order: 3, 2, 1.

```rank
use sequences
(array 3 1 2) sort .descending
```

## max

### NAME

Larger of two numbers, or the largest of
one collection.

### SYNOPSIS

```text
Left Right max -> number
Left, Right: numbers or one collection
```

### DESCRIPTION

One collection operand finds its
greatest numeric cell; two operands
compare numbers. Empty reductions have
no selected value.

### EXAMPLES

The larger of two numbers is 5.

```rank
3 5 max
```

## min

### NAME

Smaller of two numbers, or the smallest
of one collection.

### SYNOPSIS

```text
Left Right min -> number
Left, Right: numbers or one collection
```

### DESCRIPTION

One collection operand finds its least
numeric cell; two operands compare
numbers. Empty reductions have no
selected value.

### EXAMPLES

The smaller of two numbers is 3.

```rank
3 5 min
```

## sum

### NAME

Adds every numeric cell of an array,
collection or finite sequence.

### SYNOPSIS

```text
Values sum -> number
Values: finite numeric collection
```

### DESCRIPTION

Consumes all numeric cells. An infinite
sequence cannot be summed to completion.

### EXAMPLES

Add 1+2+3+4+5: 15.

```rank
(1 to 5) sum
```

## len

### NAME

Code points of text, leading axis of an
array, or size of a collection.

### SYNOPSIS

```text
Value len -> integer
Value: text, array or collection
```

### DESCRIPTION

Counts text code points or collection
items. An array length counts its
leading axis; use shape for all axis
lengths.

### EXAMPLES

The text contains five Unicode code
points.

```rank
"hello" len
```

## present

### NAME

Mask of the cells that have a value:
false for .NA and for cells that read as
.Missing.

### SYNOPSIS

```text
Values present -> boolean
Values: array or table column
```

### DESCRIPTION

Returns a boolean mask, with false for
missing cells. The result keeps the
shape of an array input.

### EXAMPLES

Identify cells that have values.

```rank
A = array 1 .NA 3
A present
```

## bytes

### NAME

Converts UTF-8 text or a rank-1 array of
integers in 0..255 to compact bytes.

### SYNOPSIS

```text
Value bytes -> bytes
Value: text, bytes or integer vector
```

### DESCRIPTION

Also accepts a one-dimensional integer
array with cells in 0..255. Invalid
cells raise an error.

### EXAMPLES

Encode the text as UTF-8 bytes.

```rank
"Rank" bytes
```

## integer

### NAME

Truncates a finite real toward zero,
preserves an integer, or parses signed
decimal integer text.

### SYNOPSIS

```text
Value integer -> integer
Value: integer, finite real or text
```

### DESCRIPTION

Finite real input is truncated toward
zero. Invalid integer text raises an
error; assignment does not convert types
automatically.

### EXAMPLES

Parse decimal text into integer 42.

```rank
"42" integer
```

## real

### NAME

Converts an integer or decimal text to a
real, or preserves a real.

### SYNOPSIS

```text
Value real -> real
Value: integer, real or decimal text
```

### DESCRIPTION

Converts integers or decimal text to
binary64 real numbers. Invalid decimal
text raises an error.

### EXAMPLES

Parse text into a real number.

```rank
"3.5" real
```

## text

### NAME

Formats one scalar as text; a .Nf
literal after it selects fixed decimals.

### SYNOPSIS

```text
Value text -> text
Value: scalar value
```

### DESCRIPTION

Formats a scalar. A following .Nf label
requests N digits after the decimal
point, as in 3.5 text .2f.

### EXAMPLES

Format an integer as text.

```rank
42 text
```

## tuple

### NAME

Fixed positional values with
individual types.

### SYNOPSIS

```text
tuple A B
(tuple)
```

### DESCRIPTION

Each position keeps its type and rank.
The number of positions is fixed.
Tuples support integer indexing, len,
equality and unpack. Positions are
immutable. Arrays in positions keep
value semantics; records keep
references.

### EXAMPLES

Return and unpack two different types.

```rank
Pair = tuple 3 "three"
unpack Number Name = Pair
Number
```
