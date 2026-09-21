# 0200. Rank Polymorphism and Leading-Frame Cell Application

* **Status:** Accepted
* **Date:** 2026-09-08 / 2026-09-09
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Tensor Model Specification

## Context

In mainstream numerical and data science ecosystems (Python/NumPy/Pandas, R, Julia), working with multi-dimensional data requires learning fragmented, inconsistent APIs:
1. **API fragmentation across dimensions:** Operating on 1D vectors uses one set of methods, 2D dataframes require row/column wrappers like `.apply(axis=1)`, and 3D+ tensors require specialized batching abstractions.
2. **Explicit vectorization boilerplate:** In languages without rank polymorphism, applying a scalar function to array elements or a vector function to matrix rows requires manual nested loops, list comprehensions, or high-overhead helper wrappers.
3. **Cryptic glyphs in classical array languages:** Array languages like APL and J introduced rank polymorphism, but expressed it through cryptic ASCII glyphs (e.g. `"` in J) and obscure monadic/dyadic rules that are impossible to type on mobile touchscreens and difficult to read.

Rank is named after **Rank Polymorphism**—the language was conceived to bring the mathematical elegance of multidimensional cell framing to general-purpose programming, expressed using clean, English words and primary-layer mobile ergonomics without glyphs.

## Decision

Rank establishes **Rank Polymorphism with Leading-Frame Cell Application (`rank`, `axis`)** as the core computational model for arrays, tensors, and tables:

### 1. Intrinsic Function Rank
Every function declares an intrinsic rank for each supported arity:
- **Rank 0 (scalar atoms):** Elementwise arithmetic (`+`, `-`, `*`, `/`), math functions (`abs`, `sqrt`, `exp`, `log`, `sin`, `cos`). Applied to higher-rank tensors, they automatically map over individual scalar atoms.
- **Rank 1 (vectors / 1D sequences):** Sequence reductions and transformations (`len`, `sum`, `sort`, `argsort`, `unique`, `reverse`, `distance`). `integer` parsing complete strings has intrinsic rank 1.
- **Rank 2 (matrices / 2D tables):** Linear algebra operations (`det`, `inverse`, `solve`, `eigh`).
- **Rank $\infty$ (whole tensor):** Structural operations (`transpose`, `reshape`).

### 2. Overriding Cell Rank with the `rank` Modifier
The `rank R` modifier overrides the unary cell rank:
```rank
rem Convert string into individual integer digits:
Digits = "1203" integer rank 0

rem Normalize each row vector in a 2D matrix:
Rows = Matrix normalize rank 1

rem Compute determinant of each 2D matrix plane in a 3D batch:
BatchDets = T det rank 2
```
- **Argument rank $> R$:** The function applies to every trailing rank-$R$ cell in row-major frame order.
- **Argument rank $\le R$:** The function receives the argument whole once.

### 3. Frame Selection via the `axis` Modifier
When targeting non-trailing or arbitrary dimensions, `axis` names the **frame axes** along which the operation iterates:
```rank
rem Compute distance per row in a geographic coordinate table:
Geo distance axis 0 rank 1

rem Normalize planes across axis 1 of a 3D tensor:
Planes = T normalize axis 1 rank 2
```
- **Fundamental Invariant:**
  $$\text{number of frame axes} + \text{cell rank} = \text{tensor rank}$$
- The written order of `axis` becomes the leading result-axis order; remaining axes form the cell in natural order. This completely eliminates manual tensor transpositions.

### 4. Tensor Reductions and Combinators (`reduce`, `scan`, `outer`)
Rank lifts scalar and vector operations across dimensions through higher-order combinators:
- **Rank-limited reduction (`reduce rank R`):**
  ```rank
  rem Sum every row of a matrix:
  RowTotals = M + reduce rank 1 with 0

  rem Multiply 2D blocks inside a 4D tensor:
  BlockProducts = Blocks * reduce rank 2
  ```
- **Prefix scan combinator (`scan`):**
  Computes running prefix reductions (cumulative sum, prefix product, running extrema):
  ```rank
  Prefix = Values + scan with 0
  RunningMin = Values min scan
  ```
  Evaluates lazily on sequences and dense arrays without extra intermediate allocations.
- **Outer product combinator (`outer`):**
  Applies an operator or binary function to every pair of cells across two operands:
  ```rank
  Sums = A B + outer
  Grid = Values Values bxor outer
  Smallest = A B min outer
  ```
  The result shape is the exact concatenation of the left frame shape and the right frame shape.

### 5. Unified Iteration over Cells
The `for` statement natively understands cell framing without helper functions:
```rank
rem Iterate over 1D rows:
for Row i in Matrix
  Row print
end

rem Iterate over atoms with 2D coordinate bindings:
for Value i j in Matrix rank 0
  Value print
end

rem Iterate over matrix columns:
for Column j in Matrix axis 1 rank 1
  Column print
end
```

## Consequences

### Positive
* **Eponymous identity:** Fulfills the core design promise that gives Rank its name.
* **Unified dimensional grammar:** The exact same concept handles string character parsing, matrix row operations, batch ML inferences, and dataframe column transformations.
* **Zero glyph noise:** Replaces J's cryptic rank conjunctions (`"`) with clean, readable keywords (`rank`, `axis`, `outer`) accessible on mobile keyboards.
* **No wrapper loops:** Replaces deeply nested `for` loops with clear, vectorized expressions.
* **Optimized execution planner:** The execution engine can fuse cell applications directly into contiguous SIMD or GPU kernels without materializing intermediate framed arrays.

### Negative & Trade-offs
* **Dimensional thinking curve:** Developers new to array programming must internalize the distinction between frame axes and cell rank.

## References
* Section "Rank-based application" and "Iterating by axis and cell rank" in [docs/language/tensors.md](../../language/tensors.md)
* Section "Outer" and "Axis reductions" in [docs/language/tensors.md](../../language/tensors.md)
* Section "Rank" in [docs/CURRENT_SPEC.md](../../CURRENT_SPEC.md)
* ADR-0202: [Whitespace Juxtaposition for Addressing and Selection](0202-whitespace-juxtaposition-for-addressing.md)
* ADR-0204: [Whole-Axis Tensor Selector (#)](0204-whole-axis-tensor-selector-hash.md)
* ADR-0300: [Intentional Intermediate Variables Over Vertical Pipelines](0300-intentional-intermediate-variables.md)
