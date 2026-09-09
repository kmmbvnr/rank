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

Answer print
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

## 3. Largest prime factor

```rank
rem Project Euler 3
rem Largest prime factor of 600851475143

use numbers

Factors = 600851475143 factors
Answer = Factors max
```

`factors` produces a finite lazy sequence of prime factors. The general `max`
reduction consumes it without adding a puzzle-specific operation.

## 5. Smallest multiple

Euler 4 is deferred until the tensor and rank models are implemented.

```rank
rem Project Euler 5
rem Smallest number divisible by 1..20

use ranges
use numbers

Range = 1 to 20
Answer = Range lcm
```

The standard `lcm` reduction consumes the lazy range. For `1 to 10`, the same
program produces `2520`.

## 6. Sum square difference

```rank
rem Project Euler 6

use ranges
use numbers

Range = 1 to 100
Sum = Range sum
SquareOfSum = Sum * Sum
Squares = Range * Range
SumOfSquares = Squares sum
Answer = SquareOfSum - SumOfSquares
```

Elementwise multiplication preserves the lazy range shape, and each `sum`
consumes only its own plan. With an upper boundary of `10`, the result is
`2640`.

## 7. 10001st prime

```rank
rem Project Euler 7

use sequences

option Count integer = 10001

Index = Count - 1
Answer = primes Index
```

`Count` is one-based because that is how the task states the position. Rank
sequence addressing is zero-based, so the program names the conversion before
addressing the lazy `primes` source. With `Count = 6`, the result is `13`.

## 8. Largest product in a series

```rank
use text
use sequences
use numbers

option Width integer = 13

Digits = Number integer rank 0
Windows = Digits Width window
Products = Windows * reduce rank 1
Answer = Products max
```

Explicit `rank 0` converts the text atoms into a lazy digit sequence. The loops
are unnecessary: `window` exposes each adjacent rank-1 digit cell and the
ranked multiplication reduction produces one value per cell. The default width
13 produces `23514624000`; width 4 produces `5832`.

## 9. Special Pythagorean triplet

```rank
use ranges

option Target integer = 1000

Last = Target - 1
for a in 1 to Last
  for b in 1 to Last
    if b greater a
      C = Target - a - b
      if C greater b
        if a * a + b * b equal C * C
          Answer = a * b * C
        end
      end
    end
  end
end
```

This is deliberately the direct imperative version: it exercises nested blocks
and integer conditions without introducing a puzzle-specific operation. The
default target produces `31875000`; target 12 produces `60`.

## 10. Summation of primes

```rank
use sequences
use numbers

option Limit integer = 2000000

Primes = primes until Limit
Answer = Primes sum
```

The bound becomes part of the lazy prime-source plan, and `sum` consumes that
finite plan. The default limit produces `142913828922`; limit 10 produces `17`.
