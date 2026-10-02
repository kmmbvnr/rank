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

### See also

use, array, for, fun
