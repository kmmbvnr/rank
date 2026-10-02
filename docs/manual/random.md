# random manual

## choices

### NAME

Draws Count values with replacement,
complete cells for a tensor.

### SYNOPSIS

```text
Values Count choices -> array
Values: collection; Count: integer
```

### DESCRIPTION

Count is a nonnegative integer. The same
source item may be chosen more than
once; the source must not be empty when
count is positive. Begin the program
with use random.

### EXAMPLES

Draw three values with replacement.

```rank
use random
123 seed
(array 10 20 30) 3 choices
```

## seed

### NAME

Restarts the pseudorandom stream of the
session and returns the seed.

### SYNOPSIS

```text
Seed seed -> integer
Seed: integer
```

### DESCRIPTION

The seed is an integer. The same seed
and sequence of random operations
reproduce the same results. Begin the
program with use random.

### EXAMPLES

Set a repeatable random state.

```rank
use random
123 seed
```

## shuffle

### NAME

New array in random order; a seed makes
the order repeatable.

### SYNOPSIS

```text
Values shuffle -> array
Values: array or finite sequence
```

### DESCRIPTION

Produces a shuffled collection. Seed
first when results must be reproducible.
Begin the program with use random.

### EXAMPLES

Return the items in random order.

```rank
use random
123 seed
(array 1 2 3 4) shuffle
```

## uniform

### NAME

Real tensor drawn from the half-open
interval between the bounds.

### SYNOPSIS

```text
Shape Low High uniform -> array
Shape: integer array; Low, High: number
```

### DESCRIPTION

Shape gives nonnegative axis lengths.
Low and High give the sampling interval;
the result contains real values. Begin
the program with use random.

### EXAMPLES

Create a 2-by-3 array of random reals.

```rank
use random
123 seed
(array 2 3) 0 1 uniform
```
