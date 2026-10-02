# Rank manual

## rank-basics

### NAME

Rank: read and try the offline manual.

### SYNOPSIS

```text
Values function -> result
use Module
```

### DESCRIPTION

Rank puts data first: 9 sqrt calls sqrt
with the number 9. A capitalized name,
such as Values, stands for data you have
stored with =. Lowercase names are
functions or language words. Strings
use double quotes; spaces separate items
in an array. Dot-prefixed names such as
.integer are labels, not text.

An integer is a whole number; a real is
a decimal number; a boolean is true or
false. An array holds indexed cells;
indices begin at zero. A matrix is a
2-dimensional array. A sequence produces
items on demand; use take to bound an
infinite sequence. A record has named
fields; a table holds rows and columns.
In signatures, value means any supported
value, element means an item from the
input, and same means the original
input.

use opens a module's functions. Core
words need no import. Each manual page
states its required module, inputs,
result and important limits. Copy copies
only the example code. Close returns to
your unchanged notebook. All pages are
stored in the app and need no internet.

### EXAMPLES

Compute the sum of three stored numbers.
Here A is an array; sum is a core
function
and needs no use import. The result is
6.

```rank
A = array 1 2 3
A sum
```
