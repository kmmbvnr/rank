# 0204. Whole-Axis Tensor Selector (#)

* **Status:** Accepted
* **Date:** 2026-09-09
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Product Decisions Section 7

## Context

Multidimensional tensor and matrix operations require extracting or modifying slices along specific axes (e.g. selecting an entire column from a 2D matrix or a 2D plane from a 3D tensor):
- MATLAB, NumPy, and Julia conventionally use a colon (`A[:, j]`).
- APL and q elide indices between separators (`A[; j]`).
- Wolfram Language uses the keyword `All` (`A[[All, j]]`).

Because Rank has eliminated brackets and commas (ADR-0202), there is no bracketed slot to leave empty or populate with a bare colon. Furthermore:
- On mobile touchscreens, typing a colon `:` requires switching to a secondary symbol keyboard layer.
- An empty whitespace gap (like `A  j`) is visually fragile and easily corrupted by code formatters.

## Decision

Rank introduces **`#` as the contextual whole-axis selector** in tensor addressing:

```rank
Row = A i
Column = A # j
Plane = T i
Line = T i # k
LastPlane = T # # k
```

1. **Positional axis mapping:** Selectors correspond to axes from left to right.
2. **Dimension preservation:** An integer selector consumes/drops its axis; `#` preserves its axis. For a tensor `T` with shape `2 3 4`, `T # 1` has shape `2 4`, while `T # # 1` has shape `2 3`.
3. **In-place updates and compound assignment (LHS):** `#` can be used on the left-hand side of assignments to update entire slices concisely:
   ```rank
   M # 1 += M # 0
   Result ci # = Group mean axis 0
   ```
4. **Touchscreen ergonomics:** On standard mobile software keyboards, `#` is accessible via a simple long-press on the period (`.`) key, keeping it directly accessible without switching keyboard layers.
5. **Contextual token:** `#` acts as an axis wild-card only within tensor addressing expressions (and as a discarded loop binding in `for # in 1 to N`). It is not a general operator.

## Consequences

### Positive
* **Seamless fit with whitespace addressing:** Provides an explicit, visible token to represent an entire dimension without requiring brackets or commas.
* **Mobile input friendly:** Readily available via long-press on touchscreens.
* **Compact multidimensional updates:** Slicing and mutating matrix columns fits comfortably within the 40-column budget.

### Negative & Trade-offs
* **Unconventional for NumPy/MATLAB users:** Developers accustomed to `:` must adapt to `#`.
* **Disambiguation:** The lexer and parser must treat `#` contextually depending on whether it appears as a selector or a loop binding token.

## References
* Section 7 ("The `#` whole-axis selector") in [docs/design/product-decisions.md](../design/product-decisions.md)
* Section "Whole-axis tensor addressing" in [docs/language/values-addressing.md](../../language/values-addressing.md)
* ADR-0202: [Whitespace Juxtaposition for Addressing and Selection](0202-whitespace-juxtaposition-for-addressing.md)
* Commit `5f81119` ("Add whole-axis tensor addressing")
