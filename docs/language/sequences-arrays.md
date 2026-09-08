# Sequences and arrays

## Sequences

Ranges and algorithmic sources are sequences:

```rank
Range = 1 until 1000
Primes = primes
Fib = fibonacci to 4000000
```

Sequences may be lazy.

Boundary operations such as `from`, `to` and `until` may be pushed into the
source by the execution planner when the source can seek efficiently.

## Selection with boolean masks

Selection uses Rank's normal addressing model.

```rank
Mask = A greater 0
B = A Mask
```

The mask is an ordinary value. It can be named, reused and combined before it is
applied.

```rank
M3 = N % 3 equal 0
M5 = N % 5 equal 0

Selected = N (M3 or M5)
```

Addressing does not mutate `A` or `N`.

## Elementwise arithmetic

Arithmetic on compatible arrays is elementwise:

```rank
C = A + B
Squares = Range * Range
Pred = Pred - 1
```

Scalar broadcasting is allowed where shape rules make it unambiguous.

`%` and comparisons are also elementwise over compatible arrays:

```rank
M3 = N % 3 equal 0
```

## Each

`each` applies a scalar function to every atom while preserving shape:

```rank
Numbers = Text int each
Flags = Values prime each
```

It is the friendly rank-0 operation.

## Rank

General cell-wise application follows J-like trailing-cell semantics:

```rank
A F rank 0
A F rank 1
A F rank 2
```

Example:

```rank
Rows = Matrix normalize rank 1
```

## Reduce

A reduction collapses values:

```rank
Total = A + reduce
Product = A * reduce
```

Named reductions use the same data-first style:

```rank
Total = A sum
Largest = A max
Average = A mean
```

`max` remains a reduction. It is not overloaded as an elementwise clamp.

## Scan

Prefix accumulation:

```rank
Prefix = A + scan
```

## Outer

`outer` applies a binary operation to every pair while preserving the axes of
both arguments:

```rank
Sums = A B + outer
Products = A B * outer
```

If `A` has shape `2 3` and `B` has shape `4 5`, the result of `A B * outer`
has shape:

```text
2 3 4 5
```

`outer` combines axes. `matmul` contracts axes.
