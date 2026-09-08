# Tensors

Rank's array model is intended to scale from ordinary vectors to dense tensors
used in numerical computing and ML.

An atom has shape `[]`. A tensor stores a flat sequence of atoms with a
rectangular shape `[D1, D2, ...]`. Lazy dimensions may have an exact, unknown
finite, or infinite size; asking for an unknown finite shape is a demand point.

## Core operations

Current direction includes:

```rank
matmul
reshape
transpose
sum
mean
max
exp
log
sqrt
softmax
gelu
layernorm
```

The exact module split is still evolving.

## Rank-based application

The same `rank` mechanism used for arrays applies to tensor cells:

```rank
X normalize rank 1
```

For a row-wise table calculation:

```rank
Geo distance rank 1
```

This avoids a separate dataframe-specific row API.

## Outer

```rank
Products = A B * outer
Sums = A B + outer
```

`outer` preserves the axes of both inputs.

The result shape is the concatenation of the operand shapes. Left axes come
first and the right operand varies fastest. Operands must be finite and
restartable, and the result may remain lazy.

## Matrix multiplication

`matmul` is distinct from `outer`.

- `outer` adds combination axes.
- `matmul` contracts compatible axes.

## ML direction

High-level names such as `logistic`, `linear` and `cnn` have been useful as
temporary examples while stress-testing Kaggle workflows.

They are **not** treated as magical core primitives.

A current project goal is to implement logistic regression itself in Rank
using the tensor/array layer, and later use the same approach for more advanced
models.
