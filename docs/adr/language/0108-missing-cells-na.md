# 0108. Missing Cells as the `.NA` Value

* **Status:** Accepted
* **Date:** 2026-10-01
* **Deciders:** @kmmbvnr
* **Consulted:** ADR-0107, ADR-0105, ADR-0309, issue #27

## Context

A numeric array sometimes has cells with no value: a CSV column, sensor data, a join, the unknown parameter in Dyalog 2010 task 4 (#15). Rank had missing cells only as a side effect: a lazy cell whose read raises `.Missing`. There was no way to write such a cell, test for it or find its position, and the only handler was an exception caught per cell by `default`. An exception per cell cannot run in a vectorised, compiled or GPU kernel.

## Decision

### 1. `.NA` is a value

`.NA` is a scalar literal of type `.missing`. It can be bound, passed and stored in an array cell like any value. It is not an error and not a `null` of the element type: an array with `.NA` cells keeps its numeric element type.

```rank
Params = array 150000.0 5000.0 .NA 3.0
Unknown = Params present false find     rem position of .NA
```

`.NA` is reserved as a value literal. `nan` stays an IEEE number, separate from `.NA`; `isnan` is false for `.NA`.

### 2. Propagation

Arithmetic and comparison with `.NA` give `.NA`, including `equal`: `.NA equal .NA` is `.NA`, so `find` cannot locate a missing cell by value. Use `present` for that.

`and` and `or` follow three-valued logic: `false and .NA` is false, `true or .NA` is true, otherwise `.NA`. `not .NA` and `xor` with `.NA` give `.NA`.

### 3. Handling

- `Values present` is a boolean mask over the cells that have a value (`.NA` and cells that read as `.Missing` are false). It composes with `find`, `where` and `filter`.
- `default` replaces `.NA` as it replaces a missing read.
- Reductions skip `.NA`: `sum`, `min`, `max`, `mean`, `median`, `std` and the other statistics.

### 4. Where a definite value is needed

`.NA` reaching a place that needs one value (an `if` or `while` condition, an index, a key) raises `.Missing`, as `NA` does in R when a condition is needed. `default` handles that too, so the two mechanisms meet in one place.

### 5. Relationship to the `.Missing` error

ADR-0107 stays in force for addressing: reading one absent cell, key or element raises `.Missing`, and `default` catches it. `.NA` is the value a *whole array* holds for data that has no value, so the vector path never uses exceptions:

- A **soft** miss is data with no value: a `lookup` key with no match, an absent table cell, a field some object rows lack. Reading all the cells of an array (printing it, `present`, a reduction, a table column) gives `.NA` for them. Reading one such lookup cell by itself still raises. A table column stores `.NA` in the array, so reading one of its cells returns `.NA`.
- A **strict** miss is not data: an index outside the choices of `choose`, a floor with no answer, a key `find` cannot locate, a table field that does not exist, a field no row has. It raises `.Missing` for the whole array as before, and `default` supplies a value per cell.

A mask with `.NA` selects no row or element where it has no value (`filter`, `X (Mask)`), as SQL's `WHERE` does. Functions that do not know `.NA` raise `.Missing` ("missing value where a number is needed"); math functions, `abs`, `sqrt` and binary numeric functions propagate it.

### 6. Representation

An array with `.NA` cells is a values buffer plus an optional validity bitmap (1 bit per cell, set means present, as in Arrow). An array without `.NA` has no bitmap and runs the existing path unchanged. Kernels combine validity with a bitwise AND and compute the values unconditionally, so they stay branch-free and map to SIMD and GPU. The layout matches the validity bitmap planned for Arrow table columns (#6).

## Consequences

* A scalar `.NA` is a real value. ADR-0107's "no silent nulls" holds for addressing, because absent reads still raise; `.NA` is explicit data that the program or its input wrote.
* Existing programs are unchanged except that the symbol `.NA` is now a value, not a symbol, and that whole-array reads of soft misses give `.NA` instead of raising.

## References
* Issue #27, #15, #6
* ADR-0107: [Universal Missing-Value Fallback via default Keyword](0107-universal-missing-value-fallback-default.md)
* Tests: `packages/interpreter/test/missing-cells.test.ts`
