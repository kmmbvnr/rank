# 0202. Whitespace Juxtaposition for Addressing and Selection

* **Status:** Accepted
* **Date:** 2026-09-08
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification

## Context

Most programming languages use bracket-and-comma notation for element access and multidimensional indexing (`array[i]`, `matrix[i, j]`, `table["col"]`).

On mobile touchscreens:
- Square brackets (`[` and `]`) and commas (`,`) are relegated to secondary keyboard layers, requiring multiple mode shifts per access expression.
- Comma-separated index lists introduce syntactic clutter on 40-column displays.

Additionally, desktop stacks use entirely different syntax for indexing lists (`a[i]`), querying tables (`SELECT ... WHERE`), and looking up dictionaries (`d[k]`).

## Decision

Rank adopts **whitespace juxtaposition** as the universal syntax for addressing and selection across all data types (arrays, tensors, tables, and records):

$$\text{value} + \text{selector} \rightarrow \text{value}$$

- `A i` selects an element by index.
- `M i j` selects a matrix cell by coordinates.
- `Data .Age` selects a column or record field.
- **Bracket-and-comma syntax (`A[i, j]`) is completely eliminated.**

### Integer Array Selectors (Leading-Axis Gather vs. Coordinates)
When an integer array is used as a selector (`A Indices`), it acts as an **index gather along the leading axis (axis 0)**:
```rank
Rows = array 0 2
Selected = Matrix Rows        rem Selects row 0 and row 2 along axis 0
```
- The selected axis preserves its dimension and takes the selector's length.
- An integer array selector does **not** represent multidimensional coordinate tuples: `A (array 1 1 1)` extracts slice 1 three times along axis 0, rather than the scalar coordinate $(1, 1, 1)$.
- To address a single cell using packed coordinates, the array must be expanded across all axes using `unpack` (see ADR-0207: `A unpack Coords`), or passed as separate scalar arguments (`A 1 1 1`).

### Non-Negative Indices Only
Indices must be non-negative integers ($\ge 0$). Rank explicitly **rejects negative index addressing** (such as Python's `a[-1]`):
- **Syntactic collision with subtraction:** In a whitespace-delimited language, `A -1` is visually and lexically ambiguous with `A - 1` (subtracting 1 from array `A`).
- **Bug prevention:** Negative index wrap-around often masks off-by-one errors in numeric code.
- Accessing the tail of a sequence requires explicit coordinate calculation (e.g. `A (Length - 1)`). Supplying a negative index is an error.

## Consequences

### Positive
* **Typing speed on mobile:** Uses only primary-layer space characters and alphanumeric identifiers.
* **Unified mental model:** Tables, arrays, and dictionaries share identical selection mechanics.
* **Clean visual aesthetics:** Eliminates bracket nesting on narrow displays.
* **Arithmetic safety:** Eliminates lexical ambiguity between indexing and subtraction (`A - 1`).

### Negative & Trade-offs
* **Parser arity sensitivity:** The parser must strictly resolve function arity and precedence to differentiate addressing (`A B`) from binary function calls (`A B gcd`).
* **Explicit tail calculations:** Without negative indexing or implicit tail wrapping, accessing end elements requires computing the target index explicitly.

## References
* Core Principles 8, 9, 11 in [docs/CURRENT_SPEC.md](../../CURRENT_SPEC.md)
* [docs/language/values-addressing.md](../../language/values-addressing.md)
* ADR-0207: [Positional Unpacking and Argument Splatting (unpack)](0207-positional-unpacking-and-splatting.md)
* ADR-0206: [Index Array Selection and Permutation (Gather Addressing)](0206-index-array-selection-and-permutation.md)
