# random manual

## choices

Pick random items, where the same item
may come up again.

```rank
use random
123 seed
(array 10 20 30) 3 choices
```

```result
30 10 20
```

### Usage

```text
Values Count choices
```

Each pick is independent, like rolling a
die. The collection cannot be empty. On
a matrix, picks whole rows.

### See also

shuffle, seed

## seed

Make the random results repeatable.

After the same seed, the same calls give
the same numbers.

```rank
use random
123 seed
(array 1 2 3 4) shuffle
```

```result
2 3 1 4
```

### Usage

```text
Number seed
```

Call it once at the start. Without it,
results differ every run.

### See also

shuffle, choices, uniform

## shuffle

Put items in a random order.

```rank
use random
123 seed
(array 1 2 3 4) shuffle
```

```result
2 3 1 4
```

### Usage

```text
Values shuffle
```

Gives a new array; the input is
unchanged. Every item appears exactly
once.

### See also

choices, seed, sort

## uniform

Random decimal numbers spread evenly
over a range.

```rank
use random
123 seed
(array 2) 0 10 uniform
```

```result
7.872516233474016 1.785435655619949
```

### Usage

```text
Shape Low High uniform
```

Shape is a list of sizes, for example
`(array 2 3)` for a 2-by-3 matrix.
Values can equal Low but never High.

### See also

choices, seed
