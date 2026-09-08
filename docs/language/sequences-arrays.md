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

`primes` starts with `2 3 5 7 11 ...`. It is infinite until bounded with `to`
or `until`, and supports ordinary zero-based sequence addressing:

```rank
BelowTwenty = primes until 20
SixthPrime = primes 5
```

Sequence sources may accept bounds, filters and reductions in their own plan.
For example, applying an `even` mask to `fibonacci` allows the source to produce
only `2 8 34 ...`. A source that has no specialized implementation uses the
general lazy operation with the same observable result.

Boundary operations such as `from`, `to` and `until` may be pushed into the
source by the execution planner when the source can seek efficiently.

## Shape and size

An atom has shape `[]`. A finite sequence has shape `[Size]`. A tensor stores a
flat sequence of atoms together with its rectangular shape `[D1, D2, ...]`.

A lazy sequence carries one of three size states:

- `exact`: its length is known;
- `unknown`: it is finite, but finding its length may require iteration;
- `infinite`: it has no finite length.

Requesting the shape of an `unknown` finite sequence is a demand point and may
iterate it. Requesting a finite shape from an `infinite` sequence is an error.

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

## Operation modifiers

An operation may be followed by a word that changes how it is applied:

```rank
Total = A + reduce
Prefix = A + scan
Products = A B * outer
Cells = A F rank 0
```

The trailing modifier binds the operation and its operands as one expression.
In `A B * outer`, `A B` is not evaluated first as addressing.

## Each

`each` applies a scalar function to every atom while preserving shape:

```rank
Numbers = Text integer each
Flags = Values prime each
```

`each` is reserved as the friendly spelling of rank-0 application. Whether it
is an exact alias for `rank 0` in every value model, especially for text,
tables and nested values, remains open. The examples above are design sketches
until that equivalence is settled.

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

Every function declares an intrinsic rank for each supported arity. Without an
explicit modifier, that rank determines the cells it receives. `rank R`
overrides the unary rank: if the argument rank is greater than `R`, the function
is applied to each trailing `R`-cell and the leading frame is preserved. If the
argument rank is at most `R`, the function receives the whole argument once.
Rank values are currently nonnegative integers.

For example, `integer` has intrinsic unary rank 1. It converts a complete text
value by default, while an explicit rank 0 converts its character atoms:

```rank
Value = "1203" integer
Digits = "1203" integer rank 0
rem Value is 1203; Digits are 1 2 0 3
```

Rank-0 application over a lazy sequence remains lazy. Results must currently
have compatible rectangular shapes. Binary rank specifications and the policy
for incompatible result shapes remain deferred until the tensor model is
implemented.

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

The axes of the left operand come first and the right operand varies fastest.
Both operands must be finite and restartable. Construction is lazy: `outer`
does not require all result atoms to be materialized immediately.

Applying a same-shaped boolean mask to a tensor returns a rank-1 lazy sequence
of the selected atoms in iteration order. Tables retain their separate
row-selection rule.
