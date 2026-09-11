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
rem https://projecteuler.net/problem=2

use sequences
use numbers

Fib = fibonacci to 4000000
Answer = Fib even sum
```

The bounded Fibonacci source stays lazy. The source-bound mask made by `even`
also acts as the selected sequence, so `sum` can consume it directly. The
planner pushes the predicate into the Fibonacci source, which can generate only
even terms.

## 3. Largest prime factor

```rank
rem Project Euler 3
rem Largest prime factor of 600851475143
rem https://projecteuler.net/problem=3

use numbers

Factors = 600851475143 factors
Answer = Factors max
```

`factors` produces a finite lazy sequence of prime factors. The general `max`
reduction consumes it without adding a puzzle-specific operation.

## 4. Largest palindrome product

```rank
rem Project Euler 4
rem Largest product of two N-digit numbers
rem https://projecteuler.net/problem=4

Lower = 10 ** (Digits - 1)
Upper = Lower * 10 - 1

Factors = Lower to Upper
Products = Factors Factors * outer
Mask = Products palindrome rank 0
Answer = Products Mask max
```

`outer` constructs the multiplication table lazily. Ranked `palindrome` checks
each scalar product, and its boolean tensor selects the candidates for `max`.
The helper converts each number to text and compares it with `reverse`.

## 5. Smallest multiple

```rank
rem Project Euler 5
rem Smallest number divisible by 1..20
rem https://projecteuler.net/problem=5

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
rem https://projecteuler.net/problem=6

use ranges
use numbers

Range = 1 to 100
SquareOfSum = (Range sum) ** 2
Squares = Range ** 2
SumOfSquares = Squares sum
Answer = SquareOfSum - SumOfSquares
```

Scalar extension applies `** 2` to every range value, while the parentheses
make the first power operate on the reduced sum. With an upper boundary of
`10`, the result is `2640`.

## 7. 10001st prime

```rank
rem Project Euler 7
rem https://projecteuler.net/problem=7

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
rem Project Euler 8
rem https://projecteuler.net/problem=8

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
rem Project Euler 9
rem https://projecteuler.net/problem=9

use ranges
use numbers

option Target integer = 1000

ALast = (Target - 1) // 3
BLast = (Target - 1) // 2
A = (1 to ALast) array
B = (2 to BLast) array
PairSums = A B + outer
C = Target - PairSums

Increasing = A B less outer
Increasing and= B less C

ASquares = A ** 2
BSquares = B ** 2
SquareSums = ASquares BSquares + outer
Valid = SquareSums equal C ** 2
Valid and= Increasing

PairProducts = A B * outer
Products = PairProducts * C
Candidates = Products Valid
Answer = Candidates max
```

The bounds follow from `a < Target / 3` and `b < Target / 2`. The `outer`
operations form pairwise sums and squared sums only inside that search space.
Trailing-axis broadcasting compares every `b` with the corresponding `c`, and
the combined boolean tensor keeps only increasing Pythagorean triples. The
default target produces `31875000`; target 12 produces `60`.

## 10. Summation of primes

```rank
rem Project Euler 10
rem https://projecteuler.net/problem=10

use sequences
use numbers

option Limit integer = 2000000

Primes = primes until Limit
Answer = Primes sum
```

The bound becomes part of the lazy prime-source plan, and `sum` consumes that
finite plan. The default limit produces `142913828922`; limit 10 produces `17`.

## 11. Largest product in a grid

```rank
rem Project Euler 11
rem https://projecteuler.net/problem=11

Directions = array shape 4 2
  0 1
  1 0
  1 1
  1 -1
end

Answer = Grid 4 greatest_product
```

The grid is one dense rank-2 array. The helper walks horizontal, vertical and
both downward diagonal directions, rejects endpoints outside the shape, and
keeps the largest fixed-width product. The full example produces `70600674`.

## 12. Highly divisible triangular number

```rank
rem Project Euler 12
rem https://projecteuler.net/problem=12

option Minimum integer = 500
Answer = Minimum first_triangle
```

`divisor_count` consumes the sorted lazy sequence from `factors`. If the prime
exponents are `e1, e2, ...`, it multiplies `(e1 + 1) * (e2 + 1) * ...` without
enumerating every divisor. The first triangle with over 500 divisors is
`76576500`.

## 13. Large sum

```rank
rem Project Euler 13
rem https://projecteuler.net/problem=13

Total = Numbers sum
Text = Total text
Prefix = Text from 0 until 10
Answer = Prefix integer
```

Rank integers keep all 50 decimal digits, so the program can sum the original
values directly. Text slicing then selects the requested leading digits. The
answer is `5537376230`.

## 14. Longest Collatz sequence

```rank
rem Project Euler 14
rem https://projecteuler.net/problem=14

Cache = new index
Cache 1 = 1
Answer = 1000000 longest_collatz
```

The implementation walks each unknown suffix into a stack, stops when it
reaches a cached value, and writes the lengths back in reverse order. The
shared sparse `index` avoids rebuilding overlapping chains. The answer is
`837799`.

## 15. Lattice paths

```rank
rem Project Euler 15
rem https://projecteuler.net/problem=15

Paths = 1
for I in 1 to Size
  Paths = Paths * (Size + I) // I
end
```

This evaluates the central binomial coefficient one exact integer step at a
time. A 20 by 20 grid has `137846528820` paths.

## 16. Power digit sum

```rank
rem Project Euler 16
rem https://projecteuler.net/problem=16

Digits = (2 ** 1000) text
Values = Digits integer rank 0
Answer = Values sum
```

Exponentiation remains exact. Explicit rank 0 parses each character as one
digit, and `sum` reduces the resulting sequence to `1366`.

## 17. Number letter counts

```rank
rem Project Euler 17
rem https://projecteuler.net/problem=17

Answer = 1000 number_letter_total
```

`number_letter_total` creates the small English length tables once and defines
a local `letters` helper that captures them. It implements British `and`
without constructing the spelled-out text. The total is `21124`.

## 18. Maximum path sum I

```rank
rem Project Euler 18
rem https://projecteuler.net/problem=18

Work = Triangle copy
for Row in (Rows - 2) to 0 by -1
  for Column in 0 to Row
    Parent = Row * (Row + 1) // 2 + Column
    Left = Parent + Row + 1
    Right = Left + 1
    LeftValue = Work Left
    RightValue = Work Right
    BestChild = LeftValue max RightValue
    Work Parent += BestChild
  end
end
```

The triangular input is stored densely in row-major triangular order. A
writable `copy` is folded upward in place, so the algorithm also scales to the
larger form of the problem. The first cell becomes `1074`.

## 19. Counting Sundays

```rank
rem Project Euler 19
rem https://projecteuler.net/problem=19

Answer = 1901 2000 count_sundays
```

The helper advances the weekday of each month start from the stated 1900
anchor. Leap years use ordinary divisibility masks and boolean composition.
The twentieth-century count is `171`.

## 20. Factorial digit sum

```rank
rem Project Euler 20
rem https://projecteuler.net/problem=20

Factorial = (1 to 100) * reduce
Digits = Factorial text
Values = Digits integer rank 0
Answer = Values sum
```

The symbolic product reduction computes the exact factorial; the same ranked
text conversion as problem 16 gives the digit sum `648`.

## 21. Amicable numbers

```rank
rem Project Euler 21
rem https://projecteuler.net/problem=21

B = A proper_divisor_sum
Partner = B proper_divisor_sum
if B not equal A and Partner equal A
  Total += A
end
```

`proper_divisor_sum` visits divisor pairs only through the square root. The
search adds each amicable value below 10000 and produces `31626`.

## 22. Names scores

```rank
rem Project Euler 22
rem https://projecteuler.net/problem=22

Text = Input read
Names = Text names_from_text
Answer = Names names_score
```

The program accepts the official names file as a path argument. It removes the
outer quotes, splits the CSV text, sorts the names, and derives letter values
from Unicode code points. The official input is embedded only in the test; the
program tree needs no fixture file. The answer is `871198282`.

## 23. Non-abundant sums

```rank
rem Project Euler 23
rem https://projecteuler.net/problem=23

Abundant = new queue
AbundantSet = new set
```

A divisor-sum sieve discovers abundant numbers. For every candidate, the
ordered queue supplies possible first terms and the set tests the complement
in expected constant time. The search stops after the first pair and produces
`4179871`.

## 24. Lexicographic permutations

```rank
rem Project Euler 24
rem https://projecteuler.net/problem=24

Choice = Remaining // Block
Digit = Available Choice
Available remove Digit
```

Factorial block sizes select each digit directly from an ordered multiset, so
the program does not enumerate the first million permutations. Text preserves
the possible leading zero. The answer is `"2783915460"`.

## 25. 1000-digit Fibonacci number

```rank
rem Project Euler 25
rem https://projecteuler.net/problem=25

for Length less Digits
  Next = Previous + Current
  Previous = Current
  Current = Next
  Index += 1
  Length = Current text len
end
```

The two latest arbitrary-precision integers are sufficient state. The first
Fibonacci value with 1000 decimal digits has index `4782`.

## 26. Reciprocal cycles

```rank
rem Project Euler 26
rem https://projecteuler.net/problem=26

Seen Remainder = Position
Remainder = Remainder * 10 % Denominator
```

Long division repeats exactly when a remainder repeats. A sparse `index`
records the first position of each remainder, giving denominator `983` below
1000.

## 27. Quadratic primes

```rank
rem Project Euler 27
rem https://projecteuler.net/problem=27

for A in (-Limit + 1) until Limit by 2
  for B in primes to Limit
    Length = A B quadratic_run
  end
end
```

The constant coefficient must be a positive prime, and the winning odd prime
allows only odd `a`, which narrows the search. The local `is_prime` helper uses
the existing `factors` sequence, so no puzzle-specific primitive is needed.
The coefficient product is `-59231`.

## 28. Number spiral diagonals

```rank
rem Project Euler 28
rem https://projecteuler.net/problem=28

Side = Layer * 2 + 1
Total += 4 * Side ** 2 - 6 * (Side - 1)
```

Each concentric layer contributes its four corners directly. The formula gives
`669171001` for a 1001 by 1001 spiral without constructing the matrix.

## 29. Distinct powers

```rank
rem Project Euler 29
rem https://projecteuler.net/problem=29

for A in 2 to Limit
  for B in 2 to Limit
    Values add A ** B
  end
end
```

Exact integer exponentiation and structural set equality remove duplicates
without canonicalizing prime exponents manually. The result is `9183`.

## 30. Digit fifth powers

```rank
rem Project Euler 30
rem https://projecteuler.net/problem=30

Text = N text
Digits = Text integer rank 0
Powers = Digits ** Power
Sum = Powers sum
```

Rank-0 conversion exposes decimal digits, scalar extension raises every digit,
and a reduction checks their sum. The fifth-power answer is `443839`; the same
function gives `19316` for fourth powers.
