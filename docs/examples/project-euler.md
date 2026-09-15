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
Products = Windows * reduce rank 1 with 1
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

Top = (Size + 1) to Size * 2
Bottom = 1 to Size
Numerator = Top * reduce with 1
Denominator = Bottom * reduce with 1
Answer = Numerator // Denominator
```

Two seeded products evaluate the numerator and denominator of the central
binomial coefficient with exact integers. Empty ranges retain the identity, so
a zero-sized grid has one path. A 20 by 20 grid has `137846528820` paths.

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

Numbers = 1 to Limit
Counts = Numbers letters rank 0
Answer = Counts + reduce with 0
```

`number_letter_total` creates the small English length tables once and defines
a local `letters` helper that captures them. Rank-0 application converts every
number to a letter count, and the seeded reduction adds the counts. The helper
implements British `and` without constructing the spelled-out text. The total
is `21124`.

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

Factorial = (1 to 100) * reduce with 1
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
Sorted = Names sort
Values = Sorted name_value rank 0
Count = Sorted len
Positions = (1 to Count) array
Scores = Values * Positions
Answer = Scores + reduce with 0
```

The program accepts the official names file as a path argument. It removes the
outer quotes and splits the CSV text. Rank-0 application derives every name's
letter value, array multiplication applies the one-based positions, and a
seeded reduction sums the scores. The official input is embedded only in the
test; the program tree needs no fixture file. The answer is `871198282`.

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
optimized membership in the existing `primes` source, so no separate predicate
word is needed.
The coefficient product is `-59231`.

## 28. Number spiral diagonals

```rank
rem Project Euler 28
rem https://projecteuler.net/problem=28

Layers = 1 to (Size - 1) // 2
Sides = Layers * 2 + 1
Corners = 4 * Sides ** 2 - 6 * (Sides - 1)
Answer = Corners + reduce with 1
```

Each concentric layer contributes its four corners. Array arithmetic evaluates
all layer contributions, and the seeded reduction includes the center cell even
when there are no outer layers. The formula gives `669171001` for a 1001 by
1001 spiral without constructing the matrix.

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

## 31. Coin sums

```rank
rem Project Euler 31
rem https://projecteuler.net/problem=31

Ways = array shape (Target + 1) fill 0
Ways 0 = 1
for Coin in Coins
  for Amount in Coin to Target
    Previous = Amount - Coin
    Ways Amount += Ways Previous
  end
end
```

Processing one coin at a time counts combinations without counting different
orders separately. The dynamic-programming array gives `73682` ways to make
200 pence.

## 32. Pandigital products

```rank
rem Project Euler 32
rem https://projecteuler.net/problem=32

Identity = A text + B text
Identity += Product text
if Identity Digits pandigital
  Products add Product
end
```

Only one-by-four and two-by-three digit factor shapes can fill a nine-digit
identity. A set removes products found through more than one factor pair; the
sum of distinct products is `45228`.

## 33. Digit cancelling fractions

```rank
rem Project Euler 33
rem https://projecteuler.net/problem=33

if Numerator Denominator curious
  NumeratorProduct *= Numerator
  DenominatorProduct *= Denominator
end
```

The helper checks all four possible locations of one common nonzero digit with
integer cross multiplication. `gcd` reduces the accumulated fraction to the
denominator `100`.

## 34. Digit factorials

```rank
rem Project Euler 34
rem https://projecteuler.net/problem=34

for Length in 2 to MaximumDigits
  0 Length "" 0 search
end
```

The local recursive function enumerates nondecreasing digit multisets rather
than every integer through seven times 9 factorial. It finds `145` and `40585`,
whose sum is `40730`.

## 35. Circular primes

```rank
rem Project Euler 35
rem https://projecteuler.net/problem=35

for Shift in 1 until Length
  Left = Text from Shift until Length
  Right = Text from 0 until Shift
  Number = (Left + Right) integer
end
```

Decimal slices form each rotation, and `Number in primes` performs optimized
primality testing without materializing the infinite source. There are `55`
circular primes below one million.

## 36. Double-base palindromes

```rank
rem Project Euler 36
rem https://projecteuler.net/problem=36

Decimal = Value text
Binary = Value binary
```

Text `reverse` performs the same palindrome check in both representations.
Even positive values cannot be binary palindromes without a leading zero, so
the odd-only search produces `872187`.

## 37. Truncatable primes

```rank
rem Project Euler 37
rem https://projecteuler.net/problem=37

LeftText = Text from Drop until Length
RightText = Text from 0 until Last
```

Every proper decimal prefix and suffix is parsed and tested with `in primes`.
The search stops after the stated eleven values and returns `748317`.

## 38. Pandigital multiples

```rank
rem Project Euler 38
rem https://projecteuler.net/problem=38

for Text len less 9
  Piece = Base * Multiplier
  Text += Piece text
  Multiplier += 1
end
```

Each base appends successive products until it reaches nine digits. Sorting
the text recognizes digits one through nine exactly once; the maximum is
`932718654`.

## 39. Integer right triangles

```rank
rem Project Euler 39
rem https://projecteuler.net/problem=39

Primitive = 2 * M * (M + N)
for P in Primitive to Limit by Primitive
  Counts P += 1
end
```

Euclid's formula generates each primitive triple from coprime parameters of
opposite parity. Marking all scaled perimeters identifies `840` as the most
productive perimeter through 1000.

## 40. Champernowne's constant

```rank
rem Project Euler 40
rem https://projecteuler.net/problem=40

Digits = Positions champernowne_digit rank 0
Answer = Digits * reduce with 1

for Remaining greater Digits * Count
  Remaining -= Digits * Count
  Digits += 1
  First *= 10
  Count *= 10
end
```

Rank-0 application finds all requested digits, and a seeded reduction multiplies
them. Inside one position, the loop retains the four related block-location
states; whole blocks of equal-width integers are skipped arithmetically, so the
program never constructs the million-character prefix. The product is `210`.

## 41. Pandigital prime

```rank
for CandidateText in Digits permutations
  Candidate = CandidateText integer
  if Candidate in primes
    return Candidate
  end
end
```

Descending digits make lazy permutations arrive from largest to smallest. The
first prime is `7652413`.

## 42. Coded triangle numbers

```rank
Values = Words word_value rank 0
Discriminants = 8 * Values + 1
Roots = Discriminants isqrt
Triangular = Roots ** 2 equal Discriminants
Answer = Triangular count
```

Inside `word_value`, rank-0 `codepoint` and a seeded sum reduce each word to its
alphabetic value. Another rank-0 application handles all words. Exact `isqrt`
builds a boolean mask of triangular values, and `count` returns `162` for the
official file.

## 43. Sub-string divisibility

```rank
for Digit in Digits
  if not (Digit in Prefix)
    Next = Prefix + Digit
    Valid = Next Divisors valid_suffix
  end
end
```

A local recursive search rejects invalid prefixes as soon as their newest
three-digit slice can be checked. The survivors sum to `16695334890`.

## 44. Pentagon numbers

```rank
if Difference in Pentagons
  if Sum in Pentagons
    Best = Difference
  end
end
```

An indexed array supplies pair values while a set provides membership tests.
The bounded search finds the minimum difference `5482660`.

## 45. Triangular, pentagonal, and hexagonal

```rank
for Hex not equal Pent
  if Hex less Pent
    HexIndex += 1
  else
    PentIndex += 1
  end
end
```

Every hexagonal number is triangular, so merging only two polygonal streams
reaches `1533776805` without storing either stream.

## 46. Goldbach's other conjecture

```rank
Remainder = Value - TwiceSquare
if Remainder in primes
  return true
end
```

Odd composites are tested against successive doubled squares. Optimized prime
membership identifies `5777` as the first counterexample.

## 47. Distinct prime factors

```rank
Factors = Value factors unique
if Factors len equal Count
  Run += 1
else
  Run = 0
end
```

The standard operations express the property directly. The first qualifying
run of four integers begins at `134043`.

## 48. Self powers

```rank
Numbers = 1 to Limit
Powers = Numbers modular_self_power rank 0
Total = Powers + reduce with 0
Answer = Total % Modulus
```

A local rank-0 operation computes each modular self power. The seeded reduction
adds them, and one final remainder keeps the requested decimal suffix. Modular
exponentiation avoids large intermediate powers. The final ten digits are
`9110846700`.

## 49. Prime permutations

```rank
Key = A text sort
if B text sort equal Key
  if C text sort equal Key
    ...
  end
end
```

Sorted decimal text gives digit permutations a common key. The requested
concatenation is `296962999629`.

## 50. Consecutive prime sum

```rank
Prefix = Primes + scan with 0
Below = Prefix less Limit
Length = (Prefix take while Below) len - 1

Total = Prefix End - Prefix Start
if Total in primes
  return Total
end
```

A seeded scan builds the zero-based prefix table. `take while` finds the longest
prefix whose sum stays below the limit without a mutable accumulator. Every
interval sum is then constant time, and lengths are tried from largest to
smallest. The result below one million is `997651`.

## 51. Prime digit replacements

```rank
Places = 0 until (Digits len - 1)
Same = (Digits Places equal Digit) indices

for Pick in Same 3 combinations
  Family = Prime Pick replacement_family
  if (Family in primes) count at least 8
    return true
  end
end
```

`indices` turns the equality mask into candidate positions, while fixing the
last digit avoids replacements that are necessarily even or divisible by 5.
Each family is formed by adding the combined decimal place weight, and planned
membership in `primes` checks the whole family. The smallest match is `121313`.

## 53. Combinatoric selections

```rank
Top = (N to 1 by -1) * scan with 1
Bottom = (1 to N) * scan with 1
Choices = Top // Bottom
```

The two seeded scans build the numerator and denominator products for every
binomial coefficient in a row, including the initial coefficient `1`. Applying
the row function with `rank 0` and reducing its counts with seed `0` gives
`4075` values above one million.
