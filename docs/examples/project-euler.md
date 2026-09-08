# Project Euler examples

Project Euler stress-tests Rank's numerical, sequence and array semantics.

## 1. Multiples of 3 or 5

```rank
rem Project Euler 1
rem Multiples of 3 or 5
rem https://projecteuler.net/problem=1

N = 1 until 1000

Mask = N multiple by 3
Mask or= N multiple by 5

Answer = N Mask sum

print Answer
```

This example demonstrates:
- the ordinary/lazy sequence `1 until 1000`;
- the `multiple by` divisibility operation from `numbers`;
- boolean masks as first-class values;
- incremental mask composition with `or=`;
- boolean addressing;
- the `sum` reduction.

This example intentionally uses mask composition rather than the table-oriented
source clause syntax.

## 2. Even Fibonacci numbers

```rank
rem Project Euler 2
rem Sum even Fibonacci terms <= 4e6

use sequences
use numbers

Fib = fibonacci to 4000000
Mask = Fib even
Answer = Fib Mask sum
```

The bounded Fibonacci source stays lazy. Applying the mask pushes the standard
`even` predicate into the source plan, which can generate only even Fibonacci
terms before `sum` consumes them.
