# numbers manual

## multiple by

### NAME

Test integer divisibility.

### SYNOPSIS

```text
Value multiple by Divisor
Result: boolean or boolean array
Value, Divisor: integers; Divisor != 0
```

### DESCRIPTION

Both inputs are integers. Tests whether
division leaves a zero remainder; a zero
divisor is invalid. Begin the program
with use numbers.

### EXAMPLES

12 is divisible by 3: true.

```rank
use numbers
12 multiple by 3
```

## abs

### NAME

Absolute value, keeping the integer or
real type.

### SYNOPSIS

```text
Value abs -> number
Value: integer or real
```

### DESCRIPTION

Returns the magnitude of the number; a
negative input becomes positive. Integer
input stays integer. Begin the program
with use numbers.

### EXAMPLES

Apply abs to 9.

```rank
use numbers
9 abs
```

## acos

### NAME

Inverse cosine in radians, for values
from -1 through 1.

### SYNOPSIS

```text
Value acos -> real
Value: integer or real
```

### DESCRIPTION

Accepts a number from -1 through 1. The
result is an angle in radians. Begin the
program with use numbers.

### EXAMPLES

Compute acos of 0.5.

```rank
use numbers
0.5 acos
```

## acosh

### NAME

Inverse hyperbolic cosine, for values at
least 1.

### SYNOPSIS

```text
Value acosh -> real
Value: integer or real
```

### DESCRIPTION

Computes the inverse hyperbolic cosine.
The input must be at least 1; the result
is real. Begin the program with use
numbers.

### EXAMPLES

Compute acosh for the supplied number.

```rank
use numbers
2 acosh
```

## asin

### NAME

Inverse sine in radians, for values from
-1 through 1.

### SYNOPSIS

```text
Value asin -> real
Value: integer or real
```

### DESCRIPTION

Accepts a number from -1 through 1. The
result is an angle in radians. Begin the
program with use numbers.

### EXAMPLES

Compute asin of 0.5.

```rank
use numbers
0.5 asin
```

## asinh

### NAME

Inverse hyperbolic sine.

### SYNOPSIS

```text
Value asinh -> real
Value: integer or real
```

### DESCRIPTION

Works on each numeric cell of an array
as well as on one number. The result is
real. Begin the program with use
numbers.

### EXAMPLES

Compute asinh for the supplied number.

```rank
use numbers
1 asinh
```

## atan

### NAME

Inverse tangent in radians.

### SYNOPSIS

```text
Value atan -> real
Value: integer or real
```

### DESCRIPTION

Works on each numeric cell of an array
as well as on one number. The result is
real. Begin the program with use
numbers.

### EXAMPLES

Compute atan for the supplied number.

```rank
use numbers
1 atan
```

## atan2

### NAME

Angle in radians from the coordinates,
keeping the quadrant.

### SYNOPSIS

```text
Y X atan2 -> real
Y, X: integer or real
```

### DESCRIPTION

Arguments are y followed by x. Returns
an angle in radians, preserving the
quadrant. Begin the program with use
numbers.

### EXAMPLES

The point x=1, y=1 has angle π/4.

```rank
use numbers
1 1 atan2
```

## atanh

### NAME

Inverse hyperbolic tangent, for values
strictly between -1 and 1.

### SYNOPSIS

```text
Value atanh -> real
Value: integer or real
```

### DESCRIPTION

Accepts a real input strictly between -1
and 1. The inverse hyperbolic tangent
returns a real. Begin the program with
use numbers.

### EXAMPLES

Compute atanh of 0.5.

```rank
use numbers
0.5 atanh
```

## binomial

### NAME

Exact binomial coefficient.

### SYNOPSIS

```text
N K binomial -> integer
N, K: nonnegative integers
```

### DESCRIPTION

N and K are nonnegative integers. Counts
combinations without enumerating them.
Begin the program with use numbers.

### EXAMPLES

Choose 2 of 5 items: 10 choices.

```rank
use numbers
5 2 binomial
```

## binomialmod

### NAME

Binomial coefficient calculated directly
modulo a prime.

### SYNOPSIS

```text
N K Modulus binomialmod -> integer
N, K, Modulus: integers
```

### DESCRIPTION

N, K and Modulus are integers. Computes
the combination count modulo a positive
modulus. Begin the program with use
numbers.

### EXAMPLES

Compute 10 modulo 7: 3.

```rank
use numbers
5 2 7 binomialmod
```

## cos

### NAME

Cosine of an angle in radians.

### SYNOPSIS

```text
Angle cos -> real
Value: integer or real
```

### DESCRIPTION

The input angle is measured in radians,
not degrees. Arrays are processed
element by element; results are real.
Begin the program with use numbers.

### EXAMPLES

Compute cos for the supplied number.

```rank
use numbers
1 cos
```

## cosh

### NAME

Hyperbolic cosine.

### SYNOPSIS

```text
Value cosh -> real
Value: integer or real
```

### DESCRIPTION

Works on each numeric cell of an array
as well as on one number. The result is
real. Begin the program with use
numbers.

### EXAMPLES

Compute cosh for the supplied number.

```rank
use numbers
1 cosh
```

## divisors

### NAME

Lazy ascending sequence of the positive
divisors.

### SYNOPSIS

```text
N divisors -> sequence
Value/N: integer
```

### DESCRIPTION

Input is a positive integer. Returns its
positive divisors in ascending order.
Values are produced on demand; storing
the result does not force every item.
Begin the program with use numbers.

### EXAMPLES

List the positive divisors of 12.

```rank
use numbers
12 divisors
```

## even

### NAME

True for an even integer.

### SYNOPSIS

```text
Value even -> boolean
Value/N: integer
```

### DESCRIPTION

Accepts integers. Returns true for
values divisible by two, including zero.
Begin the program with use numbers.

### EXAMPLES

Test whether 4 is even: true.

```rank
use numbers
4 even
```

## exp

### NAME

Natural exponential.

### SYNOPSIS

```text
Value exp -> real
Value: integer or real
```

### DESCRIPTION

Works on each numeric cell of an array
as well as on one number. The result is
real. Begin the program with use
numbers.

### EXAMPLES

Compute exp for the supplied number.

```rank
use numbers
1 exp
```

## factors

### NAME

Lazy ascending sequence of the prime
factors, repeated factors included.

### SYNOPSIS

```text
N factors -> sequence
Value/N: integer
```

### DESCRIPTION

Input is a positive integer. Repeated
prime factors are kept, so 12 yields 2,
2, 3. Values are produced on demand;
storing the result does not force every
item. Begin the program with use
numbers.

### EXAMPLES

Factor 12 into primes.

```rank
use numbers
12 factors
```

## gcd

### NAME

Greatest common divisor, always
nonnegative.

### SYNOPSIS

```text
A B gcd -> integer
A, B: integer
```

### DESCRIPTION

Both operands are integers. Zero is
allowed; the result is nonnegative.
Begin the program with use numbers.

### EXAMPLES

Find the largest shared divisor: 6.

```rank
use numbers
12 18 gcd
```

## infinity

### NAME

The positive infinite real value.

### SYNOPSIS

```text
infinity -> real
No operands; a builtin real value
```

### DESCRIPTION

A real value larger than every finite
number. It is useful as an initial bound
in minimum calculations. Begin the
program with use numbers.

### EXAMPLES

The real value for positive infinity.

```rank
use numbers
infinity
```

## isnan

### NAME

True for the real value nan; it does not
equal itself.

### SYNOPSIS

```text
Value isnan -> boolean
Value: numeric value
```

### DESCRIPTION

Returns true only for the real NaN
value. Use this instead of comparing
with nan. Begin the program with use
numbers.

### EXAMPLES

Recognize NaN: true.

```rank
use numbers
nan isnan
```

## isqrt

### NAME

Exact integer floor of the square root,
calculated without reals.

### SYNOPSIS

```text
Value isqrt -> integer
Value: nonnegative integer
```

### DESCRIPTION

Accepts a nonnegative integer and
returns the largest integer whose square
is at most the input. It does not use
floating-point rounding. Begin the
program with use numbers.

### EXAMPLES

Apply isqrt to 9.

```rank
use numbers
9 isqrt
```

## lcm

### NAME

Least common multiple, also a reduction
over one finite collection.

### SYNOPSIS

```text
A B lcm -> integer
A, B: integer
```

### DESCRIPTION

Both operands are integers. A zero
operand produces zero. Begin the program
with use numbers.

### EXAMPLES

Find the smallest shared multiple: 36.

```rank
use numbers
12 18 lcm
```

## log

### NAME

Natural logarithm of a positive finite
number.

### SYNOPSIS

```text
Value log -> real
Value: integer or real
```

### DESCRIPTION

Computes the natural logarithm (base e).
The input must be positive; log 1 is
zero. Begin the program with use
numbers.

### EXAMPLES

Compute log for the supplied number.

```rank
use numbers
2 log
```

## nan

### NAME

The real not-a-number value, for a
result or cell with no numeric value.

### SYNOPSIS

```text
nan -> real
No operands; a builtin real value
```

### DESCRIPTION

A real value representing an undefined
numeric result. Ordinary equality does
not recognize NaN; use isnan. Begin the
program with use numbers.

### EXAMPLES

The real not-a-number value.

```rank
use numbers
nan
```

## odd

### NAME

True for an odd integer.

### SYNOPSIS

```text
Value odd -> boolean
Value/N: integer
```

### DESCRIPTION

Accepts integers. Returns true for
values not divisible by two, including
negative odd values. Begin the program
with use numbers.

### EXAMPLES

Test whether 3 is odd: true.

```rank
use numbers
3 odd
```

## powmod

### NAME

Modular exponentiation by repeated
squaring, never building the full power.

### SYNOPSIS

```text
Base Exponent Modulus powmod -> integer
Base, Exponent, Modulus: integers
```

### DESCRIPTION

Base, Exponent and Modulus are integers.
Exponent must be nonnegative and modulus
positive. Begin the program with use
numbers.

### EXAMPLES

Compute 2 to power 10 modulo 1000: 24.

```rank
use numbers
2 10 1000 powmod
```

## round

### NAME

Rounds to a signed number of decimal
places, halfway values to even.

### SYNOPSIS

```text
Value Places round -> number
Value: number; Places: integer
```

### DESCRIPTION

Places is an integer; zero rounds to a
whole number. Negative places round to
powers of ten. Begin the program with
use numbers.

### EXAMPLES

Round to two decimal places.

```rank
use numbers
3.14159 2 round
```

## sin

### NAME

Sine of an angle in radians.

### SYNOPSIS

```text
Angle sin -> real
Value: integer or real
```

### DESCRIPTION

The input angle is measured in radians,
not degrees. Arrays are processed
element by element; results are real.
Begin the program with use numbers.

### EXAMPLES

Compute sin for the supplied number.

```rank
use numbers
1 sin
```

## sinh

### NAME

Hyperbolic sine.

### SYNOPSIS

```text
Value sinh -> real
Value: integer or real
```

### DESCRIPTION

Works on each numeric cell of an array
as well as on one number. The result is
real. Begin the program with use
numbers.

### EXAMPLES

Compute sinh for the supplied number.

```rank
use numbers
1 sinh
```

## sqrt

### NAME

Real square root of a nonnegative
number.

### SYNOPSIS

```text
Value sqrt -> real
Value: nonnegative integer or real
```

### DESCRIPTION

Accepts integer or real numeric input.
Negative inputs are invalid for square
roots. Begin the program with use
numbers.

### EXAMPLES

Apply sqrt to 9.

```rank
use numbers
9 sqrt
```

## tan

### NAME

Tangent of an angle in radians.

### SYNOPSIS

```text
Angle tan -> real
Value: integer or real
```

### DESCRIPTION

The input angle is measured in radians,
not degrees. Arrays are processed
element by element; results are real.
Begin the program with use numbers.

### EXAMPLES

Compute tan for the supplied number.

```rank
use numbers
1 tan
```

## tanh

### NAME

Hyperbolic tangent.

### SYNOPSIS

```text
Value tanh -> real
Value: integer or real
```

### DESCRIPTION

Works on each numeric cell of an array
as well as on one number. The result is
real. Begin the program with use
numbers.

### EXAMPLES

Compute tanh for the supplied number.

```rank
use numbers
1 tanh
```
