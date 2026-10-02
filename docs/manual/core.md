# core manual

## array

Make an array: a list of values you can
read by position.

```rank
A = array 2 7 11
A 0
```

```result
2
```

### Usage

```text
array Values
Sequence array
array shape Rows Columns
```

Separate the values with spaces.
Positions start at zero, so `A 0` is the
first item. Put array after a finite
sequence to collect its items. Use
`array shape` to build a matrix.

### See also

fill, len, unpack, rank-basics

## break

Leave a loop early.

The loop stops as soon as N reaches 3.

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

```result
3
```

### Usage

```text
for ...
  break
end
```

Only the innermost loop stops. The
program continues after that loop's end.

### See also

continue, for, return

## catch

Handle an error raised inside try.

```rank
Result = "ok"
try
  X = 1 // 0
catch Error
  Result = Error .Message
end
Result
```

```result
division by zero
```

### Usage

```text
try
  Statements
catch Error
  Statements
end
```

The name after catch holds the error.
Read `Error .Message` for the text and
`Error .Kind` for its type.

### Notes

Error exists only inside the catch
block. Copy anything you need into a
name set before try.

### See also

try, finally

## continue

Skip the rest of this pass and start the
next one.

Add 1 and 3, skipping 2.

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

```result
4
```

### Usage

```text
for Item in Values
  continue
end
```

### See also

break, for

## elif

Try another condition when the ones
above it were false.

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

```result
zero
```

### Usage

```text
if Condition
  Statements
elif Condition
  Statements
end
```

Conditions are checked from the top.
Only the first true branch runs. You can
chain as many elif as you need.

### See also

if, else, end

## else

Run this branch when no condition above
it was true.

```rank
N = -1
Kind = ""
if N greater 0
  Kind = "positive"
else
  Kind = "not positive"
end
Kind
```

```result
not positive
```

### Usage

```text
if Condition
  Statements
else
  Statements
end
```

else is optional and comes last, after
any elif.

### See also

if, elif, end

## end

Close a block such as if, for, fun or
record.

```rank
N = 0
if true
  N = 7
end
N
```

```result
7
```

### Usage

```text
if Condition
  Statements
end
```

Indentation is for reading; end is what
actually closes the block.

### See also

if, for, fun, record, rank-basics

## false

The boolean value false.

```rank
3 greater 5
```

```result
false
```

### Usage

```text
false
```

Comparisons give true or false, and if
and for test them. false is not the same
as the number 0.

### See also

true, not, and, or, rank-basics

## finally

Run cleanup code however try ends.

```rank
Done = false
try
  X = 1
finally
  Done = true
end
Done
```

```result
true
```

### Usage

```text
try
  Statements
finally
  Statements
end
```

The finally block runs whether try
finishes normally, hits an error or
returns. Use it to close files or
release other resources.

### Notes

finally does not stop the error. Add
catch to handle it.

### See also

try, catch

## for

Repeat a block, once for each value or
while a condition holds.

Add up 1, 2 and 3.

```rank
Total = 0
for i in 1 to 3
  Total += i
end
Total
```

```result
6
```

### Usage

```text
for Item in Values
  Statements
end

for Condition
  Statements
end

for
  Statements
end
```

The first form visits each value in
order. The second repeats while
Condition is true, checking before each
pass. A bare for repeats until break or
return.

### See also

break, continue, to, till, rank-basics

## fun

Define your own function.

```rank
fun twice X
  return X * 2
end
3 twice
```

```result
6
```

### Usage

```text
fun name Inputs
  Statements
  return Value
end
```

Inputs are listed after the name. When
calling, the data comes first and the
function name last, just like built-in
functions: `3 twice`.

### See also

return, memo, yield, use, rank-basics

## if

Run a block only when a condition is
true.

```rank
N = 3
Result = 0
if N greater 0
  Result = 1
end
Result
```

```result
1
```

### Usage

```text
if Condition
  Statements
end
```

### Notes

A name first assigned inside the block
does not exist after end. Assign it
before if, as Result is above, to use it
later.

### See also

elif, else, end, rank-basics

## memo

Define a function that remembers its
answers.

The second call returns the saved 9
without computing it again.

```rank
memo square N
  return N * N
end
3 square
3 square
```

```result
9
```

### Usage

```text
memo name Inputs
  Statements
  return Value
end
```

Works like fun, but each result is
stored by its inputs. Ideal for
recursive functions that call themselves
with the same values many times.

### Notes

Inputs and results must be single
values, such as numbers or text, not
arrays. Errors are not stored. If the
function reads a name that later
changes, the stored answers are not
refreshed.

### See also

fun, return

## not

Turn true into false and false into
true.

```rank
not false
```

```result
true
```

### Usage

```text
not Condition
```

not applies to the whole comparison
after it. On an array of booleans, flips
every item.

### See also

and, or, xor, not equal

## record

A value with named fields, such as a
person with a name and an age.

```rank
R = record
  .name = "Ada"
  .age = 36
end
R .name
```

```result
Ada
```

### Usage

```text
record
  .field = Value
end
```

Field names start with a dot. Read a
field with `R .name` and change it with
`R .age = 37`. You cannot add new fields
after the record is made.

### See also

end, select, rank-basics

## return

Finish a function and give back a value.

```rank
fun absolute X
  if X less 0
    return -X
  end
  return X
end
-3 absolute
```

```result
3
```

### Usage

```text
return Value
return
```

The function stops immediately. A bare
return gives back nothing. return leaves
the function, not the whole program.

### See also

fun, memo, break

## run

Run another Rank program file.

```rank
run "hello.ra"
```

```result
hello
hello
```

### Usage

```text
run "file.ra"
```

Every statement in the file runs, as if
typed here. The file must be available
to the app.

### Notes

To borrow functions from a file without
running its other statements, use use
instead.

### See also

use, as

## true

The boolean value true.

```rank
3 less 5
```

```result
true
```

### Usage

```text
true
```

Comparisons give true or false, and if
and for test them. true is not the same
as the number 1.

### See also

false, not, and, or, rank-basics

## try

Run code that might fail, and handle the
error instead of stopping.

```rank
Result = "ok"
try
  X = 1 // 0
catch Error
  Result = "caught"
end
Result
```

```result
caught
```

### Usage

```text
try
  Statements
catch Error
  Statements
finally
  Statements
end
```

If something inside try raises an error,
the program jumps to catch. finally, if
present, always runs last. You can use
catch, finally or both.

### See also

catch, finally

## unpack

Split an array or tuple into names.

```rank
unpack A B = array 2 3
A + B
```

```result
5
```

### Usage

```text
unpack Names = Values
unpack Values
```

The first form gives each item its own
name; the counts must match. The second
spreads the items out as separate inputs
to the next function.

### See also

array

## use

Load a module so its functions become
available.

```rank
use numbers
9 sqrt
```

```result
3
```

### Usage

```text
use Module
use "file.ra" as Name
```

Standard modules add their functions
directly. For your own file, quote its
path; its functions are loaded but its
other statements are not run.

### Notes

Picking a module from the keyboard's +
list adds the use line for you.

### See also

as, run, rank-basics

## yield

Produce one item of a sequence from
inside a function.

```rank
fun small
  yield 2
  yield 3
end
use sequences
small array
```

```result
2 3
```

### Usage

```text
fun name Inputs
  yield Value
end
```

A function with yield gives a sequence.
Each yield hands out one item and pauses
until the next item is asked for, so a
sequence can be endless.

### See also

fun, take, array

## and

True when both conditions are true.

```rank
true and false
```

```result
false
```

### Usage

```text
Left and Right
```

If Left is false, Right is not checked.
On arrays, combines item by item, and
both sides are always computed.

### See also

or, xor, not

## or

True when at least one condition is
true.

```rank
true or false
```

```result
true
```

### Usage

```text
Left or Right
```

If Left is true, Right is not checked.
On arrays, combines item by item, and
both sides are always computed.

### See also

and, xor, not

## xor

True when exactly one of two conditions
is true.

```rank
true xor false
```

```result
true
```

### Usage

```text
Left xor Right
```

False when both sides are the same. Both
sides are always computed.

### See also

and, or, not

## equal

Check whether two values are the same.

```rank
3 equal 3
```

```result
true
```

### Usage

```text
Left equal Right
```

On arrays, compares item by item and
gives an array of true and false.

### See also

not equal, less, greater, isnan

## not equal

Check whether two values differ.

```rank
3 not equal 4
```

```result
true
```

### Usage

```text
Left not equal Right
```

On arrays, compares item by item.

### See also

equal

## less

Check whether the left value is smaller.

```rank
3 less 4
```

```result
true
```

### Usage

```text
Left less Right
```

Equal values give false. Works on
numbers and on text, which compares
alphabetically. On arrays, compares item
by item.

### See also

at most, greater

## greater

Check whether the left value is larger.

```rank
4 greater 3
```

```result
true
```

### Usage

```text
Left greater Right
```

Equal values give false. On arrays,
compares item by item.

### See also

at least, less

## at least

Check whether the left value is larger
or equal.

```rank
3 at least 3
```

```result
true
```

### Usage

```text
Left at least Right
```

On arrays, compares item by item.

### See also

greater, at most

## at most

Check whether the left value is smaller
or equal.

```rank
3 at most 3
```

```result
true
```

### Usage

```text
Left at most Right
```

On arrays, compares item by item.

### See also

less, at least

## in

Check whether a value appears in a
collection.

```rank
3 in (array 1 3 5)
```

```result
true
```

### Usage

```text
Value in Collection
```

With an array on the left, checks each
item and gives an array of true and
false.

### See also

equal, filter

## is

Check what type a value is.

```rank
42 is .integer
```

```result
true
```

### Usage

```text
Value is .Type
```

The type name starts with a dot, for
example .integer, .real or .text. Inside
an if that uses is, Rank knows the value
has that type.

### See also

integer, real, text

## to

Count from one number to another,
including the last.

```rank
1 to 5
```

```result
1 2 3 4 5
```

### Usage

```text
Low to High
Values to High
```

Both ends are included. After a
collection instead of a number, keeps
the values up to High.

### See also

till, by, from, for

## till

Count from one number up to, but not
including, another.

```rank
1 till 5
```

```result
1 2 3 4
```

### Usage

```text
Low till High
Values till High
```

The end is left out, which suits
positions: `0 till N` gives N positions.
After a collection, keeps the values
below High.

### See also

to, by, after

## by

Count in steps other than one.

```rank
1 to 7 by 2
```

```result
1 3 5 7
```

### Usage

```text
Low to High by Step
```

A negative step counts down: `5 to 1 by
-1`. Step cannot be zero.

### See also

to, till

## default

Use a fallback value when a lookup finds
nothing.

There is no position 5, so the fallback
0 is used.

```rank
A = array 1 2
A 5 default 0
```

```result
0
```

### Usage

```text
Lookup default Fallback
```

The fallback is computed only when it is
needed.

### Notes

default covers missing values only.
Other errors, such as division by zero
or a wrong type, still stop the program.

### See also

present, leftjoin by

## fill

Give every cell of a new array the same
starting value.

A 2-by-3 matrix of zeros, read at row 1,
column 2.

```rank
A = array shape 2 3 fill 0
A 1 2
```

```result
0
```

### Usage

```text
array shape Sizes fill Value
```

Sizes are whole numbers, one per axis. A
size of zero makes an empty array.

### See also

array

## as

Give a loaded file a short name to call
its functions through.

```rank
use "helpers.ra" as H
3 H.twice
```

```result
6
```

### Usage

```text
use "file.ra" as Name
```

Call the file's functions as
`Name.function`. Name starts with a
capital letter.

### Notes

This example needs a file helpers.ra
that defines a function twice.

### See also

use

## axis

Apply a summary, such as sum, along one
direction of a matrix.

Summing down the rows gives one total
per column.

```rank
A = array shape 2 2
  1 2
  3 4
end
A sum axis 0
```

```result
4 6
```

### Usage

```text
Values Function axis N
```

Axes are numbered from zero: axis 0 runs
down the rows, axis 1 across the
columns. The chosen axis disappears from
the result; the others stay.

### See also

rank, sum, reduce

## rank

Apply a function to each row, or to
cells of another size.

Sum each row on its own.

```rank
use sequences
A = array shape 2 2
  1 2
  3 4
end
A sum rank 1
```

```result
3 7
```

### Usage

```text
Values Function rank N
Left Right Function rank M N
```

N is how many dimensions each piece has:
rank 0 means single numbers, rank 1
means rows. The results are collected
back into an array.

### See also

axis, outer

## reduce

Combine all items into one value with an
operator.

```rank
(array 2 3 4) reduce +
```

```result
9
```

### Usage

```text
Values reduce Operator
Values reduce Operator with Start
```

Works left to right: ((2 + 3) + 4). With
with, the combining begins from Start.

### Notes

The input must be finite; an endless
sequence never finishes.

### See also

scan, sum

## scan

Like reduce, but keep every step: a
running total.

```rank
(array 2 3 4) scan +
```

```result
2 5 9
```

### Usage

```text
Values scan Operator
Values scan Operator with Start
```

The result is a sequence, so it also
works on endless input when you take
only part of it.

### See also

reduce, take

## outer

Combine every item of one list with
every item of another.

A table of all sums.

```rank
A = array 1 2
B = array 10 20
A B outer +
```

```result
11 21 12 22
```

### Usage

```text
Left Right outer Operator
```

The result has one row per item of Left
and one column per item of Right.

### See also

rank, matmul

## sort by

Sort rows by a field or a computed key.

```rank
use json
use tables
use sequences
T = "[{\"id\":2},
  {\"id\":1}]" json table
S = T sort by .id
S .id
```

```result
1 2
```

### Usage

```text
Rows sort by .field
Rows sort by .field .descending
```

Give several keys to break ties. Rows
with equal keys keep their original
order.

### See also

argsort by, ascending, descending

## first where

Find the first item that matches a
condition.

```rank
(1 to 5) first where greater 3
```

```result
4
```

### Usage

```text
Values first where Condition
```

The condition is written as if the item
were on its left. The search stops at
the first match, so it is fine on
endless sequences.

### Notes

No match is an error. Add `default` to
give a fallback.

### See also

first index where, filter, default

## first index where

Find the position of the first item that
matches.

```rank
(1 to 5) first index where greater 3
```

```result
3
```

### Usage

```text
Values first index where Condition
```

Positions start at zero.

### Notes

No match is an error. Add `default` to
give a fallback.

### See also

first where, filter

## take

Keep the first N items.

```rank
"abcdef" take 3
```

```result
abc
```

### Usage

```text
Values take Count
```

Asking for more than there is just gives
everything. Use take to read the start
of an endless sequence.

### See also

drop, first where

## drop

Skip the first N items and keep the
rest.

```rank
"abcdef" drop 3
```

```result
def
```

### Usage

```text
Values drop Count
```

Skipping more than there is gives an
empty result.

### See also

take, after

## from

Keep the values that are at least a
lower bound.

```rank
use sequences
(1 to 5) from 3
```

```result
3 4 5
```

### Usage

```text
Values from Low
```

Low itself is kept. This compares
values; to skip by position, use drop.

### See also

after, to, drop

## after

Keep the values greater than a lower
bound.

```rank
(1 to 5) after 3
```

```result
4 5
```

### Usage

```text
Values after Low
```

Low itself is left out. This compares
values; to skip by position, use drop.

### See also

from, till, drop

## argsort by

The positions of rows in sorted order,
instead of the rows themselves.

```rank
use json
use tables
use sequences
T = "[{\"id\":2},
  {\"id\":1}]" json table
T argsort by .id
```

```result
1 0
```

### Usage

```text
Rows argsort by .field
```

Uses the same order as sort by.
Positions start at zero.

### See also

sort by

## group by

Put rows with the same value in a field
together.

Count how many rows share each id.

```rank
use json
use tables
use sequences
T = "[{\"id\":2},{\"id\":1},
  {\"id\":2}]" json table
G = T group by .id
C = G select
  .n = count
end
C .n
```

```result
2 1
```

### Usage

```text
Rows group by .field
```

Follow it with select to compute
something for each group, such as count
or sum.

### See also

select, count

## leftjoin by

Add matching fields from another table,
keeping every row of the first.

```rank
use json
use tables
L = "[{\"id\":1},
  {\"id\":2}]" json table
R = "[{\"id\":1,\"n\":7}]" json table
J = L R leftjoin by .id
J .n
```

```result
7 .NA
```

### Usage

```text
Left Right leftjoin by .field
```

Rows match when the field is equal; both
tables use the same field name. A left
row with no match keeps missing values,
which default can fill.

### See also

innerjoin by, leftjoin on, default

## innerjoin by

Pair up rows from two tables that share
a field value.

```rank
use json
use tables
L = "[{\"id\":1},
  {\"id\":2}]" json table
R = "[{\"id\":1,\"n\":7}]" json table
J = L R innerjoin by .id
J .n
```

```result
7
```

### Usage

```text
Left Right innerjoin by .field
```

Rows without a match are dropped. A row
matching several rows appears once for
each.

### See also

leftjoin by, innerjoin on

## leftjoin on

Join on a condition, keeping every row
of the first table.

```rank
use json
use tables
L = "[{\"id\":1},
  {\"id\":2}]" json table
R = "[{\"key\":1,\"n\":7}]" json table
J = L R leftjoin on .id equal .key
J .n
```

```result
7 .NA
```

### Usage

```text
Left Right leftjoin on Condition
```

Use on when the matching fields have
different names, or the match is not
simple equality.

### See also

leftjoin by, innerjoin on

## innerjoin on

Pair up rows from two tables that
satisfy a condition.

```rank
use json
use tables
L = "[{\"id\":1},
  {\"id\":2}]" json table
R = "[{\"key\":1,\"n\":7}]" json table
J = L R innerjoin on .id equal .key
J .n
```

```result
7
```

### Usage

```text
Left Right innerjoin on Condition
```

Use on when the matching fields have
different names. Rows without a match
are dropped.

### See also

innerjoin by, leftjoin on

## filter

Keep only the items that match a
condition.

```rank
(1 to 5) filter greater 3
```

```result
4 5
```

### Usage

```text
Values filter Condition
```

The condition is written as if the item
were on its left. Works on arrays,
sequences and table rows; on a sequence
it also works lazily.

### See also

first where, in, take

## select

Build a table with the columns you name.

```rank
use json
use tables
T = "[{\"id\":2},
  {\"id\":1}]" json table
D = T select
  .double = .id * 2
end
D .double
```

```result
4 2
```

### Usage

```text
Rows select .field .field
Rows select
  .new = Expression
end
```

The short form keeps some columns. In
the block form, each line makes a
column; inside it, `.id` reads that
row's id.

### See also

group by, record

## ascending

Sort from smallest to largest.

```rank
use sequences
(array 3 1 2) sort .ascending
```

```result
1 2 3
```

### Usage

```text
Values sort .ascending
```

This is already the default order. Equal
items keep their original order.

### See also

descending, sort by

## descending

Sort from largest to smallest.

```rank
use sequences
(array 3 1 2) sort .descending
```

```result
3 2 1
```

### Usage

```text
Values sort .descending
```

Equal items keep their original order.

### See also

ascending, sort by

## max

The larger of two numbers, or the
largest item of a collection.

```rank
3 5 max
```

```result
5
```

### Usage

```text
A B max
Values max
```

An empty collection has no largest item.

### See also

min, sum

## min

The smaller of two numbers, or the
smallest item of a collection.

```rank
3 5 min
```

```result
3
```

### Usage

```text
A B min
Values min
```

An empty collection has no smallest
item.

### See also

max, sum

## sum

Add up all the numbers.

```rank
(1 to 5) sum
```

```result
15
```

### Usage

```text
Values sum
```

Works on arrays, matrices and finite
sequences.

### See also

reduce, axis, max, min

## len

How long something is: characters in
text, or items in a collection.

```rank
"hello" len
```

```result
5
```

### Usage

```text
Value len
```

For a matrix, gives the number of rows.
Text is counted in characters, so
letters like é count once.

### See also

array, take

## present

Mark which cells have a value and which
are missing.

```rank
A = array 1 .NA 3
A present
```

```result
true false true
```

### Usage

```text
Values present
```

Gives false where a cell is .NA or
missing, and true elsewhere. The result
has the same shape as the input.

### See also

default, filter

## bytes

Convert text, or a list of numbers 0 to
255, to raw bytes.

```rank
"Rank" bytes
```

```result
0x52616e6b
```

### Usage

```text
Text bytes
Numbers bytes
```

Text is encoded as UTF-8. The result is
shown in hexadecimal.

### See also

text

## integer

Convert a value to a whole number.

```rank
"42" integer
```

```result
42
```

### Usage

```text
Value integer
```

Text must contain a whole number, such
as "42" or "-7". A real loses its
fraction, rounding toward zero: `-3.7
integer` is -3.

### Notes

Rank never converts types on its own;
call integer when you need one.

### See also

real, text, round

## real

Convert a value to a decimal number.

```rank
"3.5" real
```

```result
3.5
```

### Usage

```text
Value real
```

Accepts integers and text holding a
number.

### See also

integer, text

## text

Convert a value to text.

```rank
42 text
```

```result
42
```

### Usage

```text
Value text
```

Works on numbers, booleans and other
single values.

### See also

integer, real, join


## tuple

Keep values with different types in
fixed positions.

```rank
Pair = tuple 3 "three"
unpack Number Name = Pair
Number
```

```result
3
```

### Usage

```text
tuple A B
(tuple)
```

The number of positions and each one's
type and rank stay fixed. Use integer
indexing, len, equality or unpack.
Positions are immutable. Arrays inside
keep value semantics; records keep
references.

### See also

array, unpack, record
