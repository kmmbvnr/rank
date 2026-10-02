# bits manual

## band

Bitwise and: keep the bits set in both
numbers.

6 is 110 and 3 is 011; only the middle
bit is in both, giving 010.

```rank
use bits
6 3 band
```

```result
2
```

### Usage

```text
A B band
```

Works on integers of any size. For true
and false, use and.

### See also

bor, bxor, bnot, and

## binary

Write an integer in binary.

```rank
use bits
6 8 binary
```

```result
00000110
```

### Usage

```text
Number binary
Number Width binary
```

With Width, pads with zeros on the left.
Number cannot be negative.

### See also

hex, bit, popcount

## bit

Check whether a single bit is set.

6 is 110 in binary: bit 0 is off and bit
1 is on.

```rank
use bits
6 1 bit
```

```result
true
```

### Usage

```text
Number Position bit
```

Bit 0 is the rightmost one.

### See also

binary, shl

## bnot

Flip every bit. The result is always
-Number - 1.

```rank
use bits
6 bnot
```

```result
-7
```

### Usage

```text
Number bnot
```

Integers have no fixed width, so the
bits are flipped as if there were
endless leading ones or zeros. That is
why the answer is negative.

### See also

band, bor

## bor

Bitwise or: keep the bits set in either
number.

```rank
use bits
6 3 bor
```

```result
7
```

### Usage

```text
A B bor
```

### See also

band, bxor, or

## bxor

Bitwise exclusive or: keep the bits set
in exactly one number.

```rank
use bits
6 3 bxor
```

```result
5
```

### Usage

```text
A B bxor
```

### See also

band, bor, xor

## popcount

How many bits are set.

6 is 110 in binary: two bits are on.

```rank
use bits
6 popcount
```

```result
2
```

### Usage

```text
Number popcount
```

Number cannot be negative.

### See also

binary, bit

## shl

Shift bits left, which multiplies by a
power of two.

Shifting 3 left by 2 multiplies it by 4.

```rank
use bits
3 2 shl
```

```result
12
```

### Usage

```text
Number Count shl
```

Count cannot be negative. Integers never
overflow.

### See also

shr

## shr

Shift bits right, which divides by a
power of two, rounding down.

```rank
use bits
12 2 shr
```

```result
3
```

### Usage

```text
Number Count shr
```

Count cannot be negative. Negative
numbers round down too: `-8 1 shr` is
-4.

### See also

shl
