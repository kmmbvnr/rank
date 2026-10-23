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
too: `12 18 gcd`.

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
`M F axis 0`; a loop can use
`for Column j in M axis 0`.

`rank 1` chooses the last axis instead
of naming it. On a matrix this means
rows; on a higher tensor it means the
last-axis vectors. See the tensor rules
for functions whose results change rank.

### See also

use, array, for, fun
