# 0206. Index Array Selection and Permutation (Gather Addressing)

* **Status:** Accepted
* **Date:** 2026-09-08
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Values and Addressing Specification

## Context

Array manipulation frequently requires selecting non-contiguous elements, reordering items by an index permutation vector, or duplicating slices (e.g. for ML data shuffling, sorting by external keys, or sub-matrix extraction).

In conventional languages:
- Python/NumPy calls this "fancy indexing", but suffers from confusing ambiguities between tuple coordinate indexing (`M[(1, 2)]`) and 1D axis indexing (`M[[1, 2]]`).
- Other languages lack native gather indexing, forcing developers to write imperative loops with memory allocations (`[arr[i] for i in indices]`).

Rank needs a declarative, zero-copy gather primitive that integrates cleanly with its whitespace addressing model without syntax confusion between coordinates and axis selections.

## Decision

Rank establishes **integer arrays as first-class axis-gather selectors**:

### 1. Leading-Axis Gather by Default
When an integer array is applied to a tensor (`A Indices`), it selects items along the **leading axis (axis 0)**:
```rank
Order = array 2 0 1
Permuted = Values Order
```
- Elements are extracted in the exact order specified by the selector.
- Indices may repeat: `A (array 1 1 1)` extracts slice 1 three times.
- Out-of-bounds indices trigger immediate runtime errors.

### 2. Dimension Preservation Rule
Unlike a scalar integer selector (which collapses/removes its axis), an integer array selector **preserves the axis**:
- The target axis takes the exact length of the selector array.
- For a 3D tensor `A` of shape `[2, 2, 2]`:
  - `A 1` (scalar) produces a 2D matrix of shape `[2, 2]`.
  - `A (array 1 1 1)` produces a 3D tensor of shape `[3, 2, 2]`.

### 3. Explicit Axis Targeting (`axis`)
To gather elements along a dimension other than the leading axis, the `axis` keyword is used:
```rank
Cols = Matrix axis 1 (array 0 2 0)
```

### 4. Multidimensional Cartesian Sub-Blocks
Supplying multiple collection selectors across axes performs a **Cartesian product selection**, producing a sub-block at the intersections of those coordinates:
```rank
Rows = array 0 2
Cols = array 1 3
Block = Matrix Rows Cols
rem Result has shape [2, 2], containing Matrix[r, c] for all combinations
```

### 5. Clear Distinction from Coordinate Lookup (ADR-0207)
An integer array is **never** implicitly interpreted as a multidimensional coordinate vector:
- `A (array 1 1 1)` $\implies$ Extracts slice 1 three times along axis 0.
- `A unpack (array 1 1 1)` $\implies$ Unpacks the vector into scalar coordinate arguments `A 1 1 1`, returning the single scalar cell at $(1, 1, 1)$.

## Consequences

### Positive
* **Expressive data permutation:** Shuffling, reordering, and sorting (`Array Order`) are expressed as simple juxtaposition without helper methods.
* **Declarative sub-matrices:** Extracting Cartesian sub-grids (`Matrix Rows Cols`) eliminates nested index comprehension loops.
* **Consistent geometry:** Clear, predictable rule: scalars reduce rank by 1; index arrays preserve rank and set axis length.
* **Zero ambiguity:** `unpack` explicitly differentiates coordinate lookup from axis gathering.

### Negative & Trade-offs
* **Initial intuition trap:** Programmers from non-array backgrounds may initially expect `A (array 1 2)` to act as coordinate $(1, 2)$ rather than selecting rows 1 and 2, requiring documentation emphasis on `unpack`.

## References
* Section "Arrays of indices" in [docs/language/values-addressing.md](../../language/values-addressing.md)
* ADR-0202: [Whitespace Juxtaposition for Addressing and Selection](0202-whitespace-juxtaposition-for-addressing.md)
* ADR-0207: [Positional Unpacking and Argument Splatting (unpack)](0207-positional-unpacking-and-splatting.md)
