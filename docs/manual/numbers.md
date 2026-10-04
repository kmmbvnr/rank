# numbers manual

## abs

Distance from zero: drops the minus
sign.

```rank
use numbers
-7 abs
```

```result
7
```

### Usage

```text
Number abs
```

An integer stays an integer and a real
stays a real.

### See also

round, sqrt

## acos

Inverse cosine: the angle whose cosine
is the given number.

```rank
use numbers
0.5 acos
```

```result
1.0471975511965979
```

### Usage

```text
Number acos
```

Number must be between -1 and 1. The
angle comes back in radians.

### Notes

Rank has no `pi` constant; `-1 acos`
gives π.

### See also

cos, asin, atan

## acosh

Inverse hyperbolic cosine.

```rank
use numbers
2 acosh
```

```result
1.3169578969248166
```

### Usage

```text
Number acosh
```

Number must be 1 or more. The result is
a real.

### See also

cosh, asinh, atanh

## asin

Inverse sine: the angle whose sine is
the given number.

```rank
use numbers
0.5 asin
```

```result
0.5235987755982989
```

### Usage

```text
Number asin
```

Number must be between -1 and 1. The
angle comes back in radians.

### See also

sin, acos, atan

## asinh

Inverse hyperbolic sine.

```rank
use numbers
1 asinh
```

```result
0.881373587019543
```

### Usage

```text
Number asinh
```

Works on any number, or on every item of
an array. The result is real.

### See also

sinh, acosh, atanh

## atan

Inverse tangent: the angle whose tangent
is the given number.

```rank
use numbers
1 atan
```

```result
0.7853981633974483
```

### Usage

```text
Number atan
```

Works on any number. The angle comes
back in radians, between -π/2 and π/2.

### Notes

To find the angle of a point, use atan2
instead: it knows which quadrant the
point is in.

### See also

atan2, tan, asin, acos

## atan2

The angle of the point (X, Y), measured
from the positive x-axis.

The point x=1, y=1 lies at 45°, which is
π/4 radians.

```rank
use numbers
1 1 atan2
```

```result
0.7853981633974483
```

### Usage

```text
Y X atan2
```

Note the order: Y comes first. The angle
is in radians, from -π to π, and has the
right sign for every quadrant.

### See also

atan

## atanh

Inverse hyperbolic tangent.

```rank
use numbers
0.5 atanh
```

```result
0.5493061443340548
```

### Usage

```text
Number atanh
```

Number must be strictly between -1 and
1. The result is real.

### See also

tanh, asinh, acosh

## binomial

How many ways there are to choose K
items out of N.

Choose 2 people out of 5: there are 10
different pairs.

```rank
use numbers
5 2 binomial
```

```result
10
```

### Usage

```text
N K binomial
```

N and K are whole numbers with K between
0 and N. The answer is exact, however
large.

### See also

binomialmod, factors

## binomialmod

Count the ways to choose K of N, keeping
only the remainder after dividing by
Modulus.

There are 10 ways to choose 2 of 5, and
10 leaves 3 after dividing by 7.

```rank
use numbers
5 2 7 binomialmod
```

```result
3
```

### Usage

```text
N K Modulus binomialmod
```

All three are integers, and Modulus must
be a prime. Works directly with
remainders, so it stays fast when the
full count would be huge.

### See also

binomial, powmod

## cos

Cosine of an angle given in radians.

```rank
use numbers
0 cos
```

```result
1
```

### Usage

```text
Angle cos
```

The angle is in radians, not degrees. On
an array, works on every item.

### Notes

To convert degrees, multiply by π/180,
where π is `-1 acos`.

### See also

sin, tan, acos

## cosh

Hyperbolic cosine.

```rank
use numbers
1 cosh
```

```result
1.5430806348152437
```

### Usage

```text
Number cosh
```

Works on any number, or on every item of
an array. The result is real.

### See also

sinh, tanh, acosh

## divisors

Every positive number that divides N
evenly, smallest first.

```rank
use numbers
12 divisors
```

```result
1 2 3 4 6 12
```

### Usage

```text
N divisors
```

N must be a positive integer. The result
is a sequence, so items are found only
as you read them.

### See also

factors, gcd

## even

Check whether an integer is even.

```rank
use numbers
4 even
```

```result
true
```

### Usage

```text
Number even
```

Zero and negative even numbers count as
even. On an array, checks every item.

### See also

odd

## exp

e raised to the given power.

```rank
use numbers
1 exp
```

```result
2.718281828459045
```

### Usage

```text
Number exp
```

Works on any number, or on every item of
an array. The result is real.

### See also

log

## factors

Break N into primes. A prime that
divides N several times is listed
several times.

360 is 2 × 2 × 2 × 3 × 3 × 5.

```rank
use numbers
360 factors
```

```result
2 2 2 3 3 5
```

### Usage

```text
N factors
```

N must be a positive integer. The primes
come smallest first, as a sequence.

### See also

divisors, gcd

## gcd

The largest number that divides both A
and B.

```rank
use numbers
12 18 gcd
```

```result
6
```

### Usage

```text
A B gcd
```

A and B are integers. Zero is allowed:
`0 12 gcd` is 12. The result is never
negative.

### See also

lcm, divisors

## infinity

A real number larger than every other
number.

```rank
use numbers
infinity
```

```result
infinity
```

### Usage

```text
infinity
```

A constant; it takes no input. Handy as
a starting value when searching for a
minimum.

### See also

nan

## isnan

Check whether a value is nan, the "not a
number" value.

```rank
use numbers
nan isnan
```

```result
true
```

### Usage

```text
Value isnan
```

### Notes

nan is never equal to anything,
including itself, so `nan equal nan` is
false. Use isnan to test for it.

### See also

nan, infinity

## isqrt

Whole-number square root, rounded down.

17 lies between 4² = 16 and 5² = 25, so
the answer is 4.

```rank
use numbers
17 isqrt
```

```result
4
```

### Usage

```text
Number isqrt
```

Number must be a nonnegative integer.
The answer is exact even for very large
integers, because no decimal rounding is
involved.

### See also

sqrt

## lcm

The smallest number that both A and B
divide evenly.

```rank
use numbers
12 18 lcm
```

```result
36
```

### Usage

```text
A B lcm
Numbers lcm
```

The first form takes two integers. The
second takes an array and finds the
smallest number every item divides. If
any value is zero, the result is zero.

### See also

gcd

## log

Natural logarithm, the inverse of exp.

```rank
use numbers
1 log
```

```result
0
```

### Usage

```text
Number log
```

Number must be positive. The result is
real.

### See also

exp

## nan

"Not a number": a real value that marks
a missing or undefined result.

```rank
use numbers
nan
```

```result
nan
```

### Usage

```text
nan
```

A constant; it takes no input.

### Notes

nan is not equal to anything, not even
itself. Test for it with isnan.

### See also

isnan, infinity

## odd

Check whether an integer is odd.

```rank
use numbers
3 odd
```

```result
true
```

### Usage

```text
Number odd
```

Negative odd numbers count as odd. On an
array, checks every item.

### See also

even

## powmod

Raise Base to a power and keep only the
remainder after dividing by Modulus.

2¹⁰ is 1024, which leaves 24 after
dividing by 1000.

```rank
use numbers
2 10 1000 powmod
```

```result
24
```

### Usage

```text
Base Exponent Modulus powmod
```

All three are integers. Exponent cannot
be negative and Modulus must be
positive. The full power is never built,
so huge exponents stay fast.

### See also

binomialmod

## round

Round a number to a given number of
decimal places.

```rank
use numbers
3.14159 2 round
```

```result
3.14
```

### Usage

```text
Number Places round
```

Places 0 rounds to a whole number.
Negative places round to tens, hundreds
and so on: `1234 -2 round` is 1200.

### Notes

A value exactly halfway rounds to the
even neighbour: `2.5 0 round` is 2 and
`3.5 0 round` is 4.

### See also

abs

## sin

Sine of an angle given in radians.

```rank
use numbers
0 sin
```

```result
0
```

### Usage

```text
Angle sin
```

The angle is in radians, not degrees. On
an array, works on every item.

### See also

cos, tan, asin

## sinh

Hyperbolic sine.

```rank
use numbers
1 sinh
```

```result
1.1752011936438014
```

### Usage

```text
Number sinh
```

Works on any number, or on every item of
an array. The result is real.

### See also

cosh, tanh, asinh

## sqrt

Square root of a number.

```rank
use numbers
9 sqrt
```

```result
3
```

### Usage

```text
Number sqrt
```

Number must be zero or positive. On an
array, works on every item.

### Notes

For an exact whole-number root of a
large integer, use isqrt.

### See also

isqrt, abs

## tan

Tangent of an angle given in radians.

```rank
use numbers
0 tan
```

```result
0
```

### Usage

```text
Angle tan
```

The angle is in radians, not degrees. On
an array, works on every item.

### See also

sin, cos, atan

## tanh

Hyperbolic tangent.

```rank
use numbers
1 tanh
```

```result
0.7615941559557649
```

### Usage

```text
Number tanh
```

Works on any number, or on every item of
an array. The result is real, between -1
and 1.

### See also

sinh, cosh, atanh
