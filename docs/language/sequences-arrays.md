# Sequences and arrays

## Sequences

Ranges and algorithmic sources are sequences:

```rank
Range = 1 until 1000
Primes = primes
Fib = fibonacci to 4000000
```

Sequences are lazy by default. Constructing, transforming or filtering a
sequence builds a plan. A terminal operation such as `sum`, explicit
materialization, or iteration demands values from that plan. A terminal
operation that would consume an unbounded sequence is an error.

`fibonacci` starts with `1 2 3 5 8 ...`. Applied to an ordered algorithmic
source, `to` includes the boundary and `until` excludes it:

```rank
Fib = fibonacci to 100
```

Sequence sources may accept bounds, filters and reductions in their own plan.
For example, applying an `even` mask to `fibonacci` allows the source to produce
only `2 8 34 ...`. A source that has no specialized implementation uses the
general lazy operation with the same observable result.

Boundary operations such as `from`, `to` and `until` may be pushed into the
source by the execution planner when the source can seek efficiently.

## Selection with boolean masks

Selection uses Rank's normal addressing model.

```rank
Mask = A greater 0
B = A Mask
```

The mask is an ordinary first-class value. It can be named, reused and combined
before it is applied.

```rank
Mask = N multiple by 3
Mask or= N multiple by 5

Selected = N Mask
```

Masks are demand-driven by default. Creating a mask builds a deferred boolean
plan; it does not require an immediate boolean array. Combining masks with
`and`, `or`, `xor` or `not` also remains deferred.

Applying a mask is a demand point, but it does not by itself require full
materialization. An implementation may stream the selected values, fuse the
mask with a following operation, or push predicates into a source such as a
table scan. It may also materialize a mask eagerly when that produces the same
observable result.

Reusing a mask does not promise that its computed bits are cached. A mask
captures the logical values of its operands when it is created, rather than
looking up later assignments to their variable names. This snapshot rule does
not require copying the underlying storage.

Expressions deferred inside a mask must be pure. Operations with observable
side effects are not allowed there, so an implementation may change evaluation
order, fuse operations or recompute values without changing program meaning.

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
