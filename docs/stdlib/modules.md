# Standard library

Rank starts with a small core. Vocabulary is introduced through `use` modules.

Current module directions:

```rank
use numbers
use ranges
use collections
use graph
use tensor
use tables
use stats
use text
use dates
use io
use ml
use algo
use sequences
```

These names are organizational and may still be consolidated.

Each module owns its vocabulary, semantic handlers, validators and execution
planner rules. Common operations normally fit the stable application grammar
and do not add parser productions. Syntax extensions are combined before parser
construction and are then enabled semantically by the corresponding `use`.

## Numbers

Candidate reusable operations:

```rank
odd
even
prime
gcd
lcm
factor
multiple by
```

`multiple by` is an elementwise divisibility test and returns a boolean value
or mask:

```rank
Mask = N multiple by 3
```

It is the readable shortcut for `N % 3 equal 0`.

## Sequences

Examples:

```rank
primes
fibonacci
```

## Tables

Includes concepts such as:

```rank
csv
group
join
labels
```

## Stats

Examples:

```rank
mean
median
```

## Text

Examples:

```rank
split
reverse
text
int
```

## Dates

Examples:

```rank
hour
weekday
month
year
```

## Algorithm profile

`use algo` may act as a contest-oriented umbrella module rather than introducing
new semantics.

## Rule for adding library vocabulary

A word belongs in the standard library when it represents a broad, reusable
concept with established meaning.

Do not add a word merely because it makes one LeetCode, Euler or Kaggle task
shorter.
