# bits manual

## band

### NAME

Bitwise and.

### SYNOPSIS

```text
A B band -> integer
A, B: integer
```

### DESCRIPTION

Operates on integers, not boolean masks.
Integer precision is not limited to a
machine word.

### EXAMPLES

Keep shared bits: 2.

```rank
use bits
6 3 band
```

## binary

### NAME

Formats a nonnegative integer as binary
text, a width padding with zeroes.

### SYNOPSIS

```text
Value binary -> text
Value: integer
```

### DESCRIPTION

Operates on integers, not boolean masks.
Integer precision is not limited to a
machine word.

### EXAMPLES

Write 6 in binary: 110.

```rank
use bits
6 binary
```

## bit

### NAME

Tests a zero-based bit position.

### SYNOPSIS

```text
Value Position bit -> boolean
Value, Position: integer
```

### DESCRIPTION

Operands are arbitrary-precision
integers. Bit positions and shift counts
start at zero and must be nonnegative.

### EXAMPLES

Inspect bit position 1 of 6.

```rank
use bits
6 1 bit
```

## bnot

### NAME

Bitwise not in infinite two-complement
form, so the result is -Value - 1.

### SYNOPSIS

```text
Value bnot -> integer
Value: integer
```

### DESCRIPTION

Operates on integers, not boolean masks.
Integer precision is not limited to a
machine word.

### EXAMPLES

Invert the integer bits.

```rank
use bits
6 bnot
```

## bor

### NAME

Bitwise or.

### SYNOPSIS

```text
A B bor -> integer
A, B: integer
```

### DESCRIPTION

Operates on integers, not boolean masks.
Integer precision is not limited to a
machine word.

### EXAMPLES

Keep bits from either integer: 7.

```rank
use bits
6 3 bor
```

## bxor

### NAME

Bitwise exclusive or.

### SYNOPSIS

```text
A B bxor -> integer
A, B: integer
```

### DESCRIPTION

Operates on integers, not boolean masks.
Integer precision is not limited to a
machine word.

### EXAMPLES

Keep bits present in only one input: 5.

```rank
use bits
6 3 bxor
```

## popcount

### NAME

Number of set bits in a nonnegative
integer.

### SYNOPSIS

```text
Value popcount -> integer
Value: integer
```

### DESCRIPTION

Operates on integers, not boolean masks.
Integer precision is not limited to a
machine word.

### EXAMPLES

Count set bits in 6: two.

```rank
use bits
6 popcount
```

## shl

### NAME

Shifts left by a nonnegative bit count.

### SYNOPSIS

```text
Value Count shl -> integer
Value, Count: integer
```

### DESCRIPTION

Operands are arbitrary-precision
integers. Bit positions and shift counts
start at zero and must be nonnegative.

### EXAMPLES

Shift 3 left twice: 12.

```rank
use bits
3 2 shl
```

## shr

### NAME

Arithmetic shift right by a nonnegative
bit count.

### SYNOPSIS

```text
Value Count shr -> integer
Value, Count: integer
```

### DESCRIPTION

Operands are arbitrary-precision
integers. Bit positions and shift counts
start at zero and must be nonnegative.

### EXAMPLES

Shift 12 right twice: 3.

```rank
use bits
12 2 shr
```
