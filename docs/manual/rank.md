# Rank manual

## rank-basics

How to read Rank code and these pages.

In Rank, the data comes first and the
function last.

```rank
A = array 1 2 3
A sum
```

```result
6
```

### Reading code

`9 sqrt` means "take 9 and apply sqrt".
Several inputs come before the function
too: `12 gcd 18`.

Names with a capital letter, such as A
or Total, hold your data; store them
with =. On these pages, capitalized
words in Usage stand for your own
values. Lowercase words are functions
and keywords. Text goes in double
quotes. Words starting with a dot, such
as .name or .integer, are labels: field
names, column names or options.

### Kinds of values

An integer is a whole number and a real
has a decimal point. A boolean is true
or false. An array is a list of values;
positions start at 0. A matrix is an
array with rows and columns. A sequence
makes its items only when you read them,
so it can be endless: cut it with take.
A record has named fields and a table
has named columns.

### Rows and columns

`axis` names the dimensions used by an
operation. In a matrix, axis 0 runs
down each column and axis 1 runs across
each row:

```rank
M = (1 to 6) reshape 2 3
M sum axis 0
```

```result
5 7 9
```

`M reverse axis 1` reverses each row
and keeps the matrix layout. A function
can receive a whole column with
`M F axis 0`. Loops visit rows along
axis 0. To visit columns, use
`for j in 0 till (M len axis 1)` and
select `Column = M # j` in the body.

`rank 1` chooses the last axis instead
of naming it. On a matrix this means
rows; on a higher tensor it means the
last-axis vectors. See the tensor rules
for functions whose results change rank.

For `reduce` and `scan`, `rank R`
selects input cells after removing
the traversal axes. An explicit `rank`
always requires an explicit `axis`,
including `rank 0`.
`M reduce + rank 1 axis 0` combines
whole rows. `M sum rank 1` sums each
row.
Without either modifier, `reduce` folds
all elements, while `scan` requires a
rank-1 input. Omit `rank` for scalar
folds over lazy sequences and text.

### What axis means

`axis` always names axes, but its job
depends on the operation.

One input, as in `sum`, `sort` or
`inverse`: `axis` names the axes the
function works inside. The other axes
repeat it, like a batch.

`reduce` and `scan`: `axis` is the axis
the running value steps along, and
`rank` is the size of each step.

Two inputs, as in `matmul` or `equal`:
`axis L R` joins axis L of the left
input with axis R of the right one.

### See also

use, array, for, fun
