# bits manual

## band

Bitwise and: keep the bits set in both
numbers.

6 is 110 and 3 is 011; only the middle
bit is in both, giving 010.

```rank
use bits
6 band 3
```

```result
2
```

### Usage

```text
A band B
```

Works on integers of any size. For true
and false, use and.

### See also

bor, bxor, bnot, and

## binary

Write an integer in binary.

```rank
use bits
6 binary 8
```

```result
00000110
```

### Usage

```text
Number binary
Number binary Width
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
6 bit 1
```

```result
true
```

### Usage

```text
Number bit Position
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
6 bor 3
```

```result
7
```

### Usage

```text
A bor B
```

### See also

band, bxor, or

## bxor

Bitwise exclusive or: keep the bits set
in exactly one number.

```rank
use bits
6 bxor 3
```

```result
5
```

### Usage

```text
A bxor B
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

Number cannot be negative. Zero has no
set bits. The result is an integer.
Work and temporary storage grow linearly
with the input's bit length.

### See also

binary, bit

## shl

Shift bits left, which multiplies by a
power of two.

Shifting 3 left by 2 multiplies it by 4.

```rank
use bits
3 shl 2
```

```result
12
```

### Usage

```text
Number shl Count
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
12 shr 2
```

```result
3
```

### Usage

```text
Number shr Count
```

Count cannot be negative. Negative
numbers round down too: `-8 shr 1` is
-4.

### See also

shl
