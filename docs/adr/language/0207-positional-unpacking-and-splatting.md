# 0207. Positional Unpacking and Argument Splatting (unpack)

* **Status:** Accepted
* **Date:** 2026-09-08
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Lexical Syntax Specification

## Context

In conventional languages, extracting elements from sequences and expanding arrays into function arguments relies on punctuation syntax:
- Destructuring assignment: `a, b, c = list` (Python) or `const [a, b, c] = arr` (JavaScript).
- Discarding unused values: `a, _, c = list`.
- Argument splatting / spreading: `func(*args)` (Python) or `func(...args)` (JS).

In Rank:
- Comma-separated variable lists (`A, B = ...`) are rejected to avoid punctuation on touchscreen keyboards.
- Whitespace assignment `A B = Values` would collide with addressed mutation (`A i j = Value`).
- Suffix functions (`A B gcd`) need a way to consume coordinates stored inside a vector without manual indexing (`P 0`, `P 1`).
- Passing a vector directly to a tensor (`A Coors`) acts as a gather along the leading axis (ADR-0202), meaning packed coordinate arrays cannot address multidimensional cells without explicit expansion.

Rank needs an explicit, unambiguous keyword to handle destructuring, argument expansion, and coordinate splatting without punctuation.

## Decision

Rank introduces the **`unpack` keyword** for destructuring assignment, argument expansion, and coordinate splatting:

### 1. Destructuring Assignment
`unpack` distributes the items of a rank-1 array across multiple target variables:
```rank
unpack Length Width Height = array 2 3 4
```
- **Exact length matching:** The number of variable names must match the array length exactly.
- **Discarding items with `#`:** Consistent with `for` loop bindings (ADR-0304) and tensor selectors (ADR-0204), `#` discards an element without binding a name:
  ```rank
  unpack From To # = Edge
  ```
- **Disambiguation:** The explicit `unpack` prefix unambiguously separates multiple assignment targets from addressed single-target assignment (`A i j = Value`).

### 2. Argument Splatting into Function Calls
Prefixing an expression with `unpack` expands a rank-1 array into adjacent function arguments:
```rank
Point = array 10 20
Distance = unpack Point distance    rem Calls 'distance' with arguments 10 and 20
```

### 3. Coordinate Expansion in Multidimensional Addressing
Because `A Coors` performs leading-axis gather (ADR-0202), `unpack` is the explicit mechanism to expand a coordinate array into separate axis selectors:
```rank
Coors = array 1 1 1
Value = A unpack Coors              rem Equivalent to: A 1 1 1
Grid unpack Coords = 1               rem Addressed assignment via coordinate vector
```

### 4. Safety Constraints
- Expanding a non-array raises `.TypeError`.
- Expanding an array whose rank is not 1 raises `.DimensionMismatch`.

## Consequences

### Positive
* **Zero punctuation destructuring:** Replaces commas, brackets, and `*`/`...` with a readable English keyword.
* **Grammatical clarity:** Solves lexical ambiguity between multi-variable assignment and multi-index coordinate assignment.
* **Unified concept:** The same word `unpack` handles destructuring LHS (`unpack A B = ...`), argument expansion RHS (`unpack Point distance`), and multidimensional coordinate addressing (`A unpack Coords`).
* **Safe position discarding:** Reuses `#` cleanly to ignore unwanted elements.

### Negative & Trade-offs
* **Strict length check:** Unlike Python (which allows `a, *rest = lst`), Rank requires an exact item-to-name count, avoiding hidden allocations for leftover sub-arrays.

## References
* Section "Unpacking assignment" in [docs/language/lexical-syntax.md](../../language/lexical-syntax.md)
* ADR-0202: [Whitespace Juxtaposition for Addressing and Selection](0202-whitespace-juxtaposition-for-addressing.md)
* ADR-0204: [Whole-Axis Tensor Selector (#)](0204-whole-axis-tensor-selector-hash.md)
* ADR-0301: [Data-First Calling Convention and Arity Resolution](0301-data-first-calling-convention.md)
* ADR-0304: [Unification of All Loops Under for](0304-unify-loops-under-for.md)
