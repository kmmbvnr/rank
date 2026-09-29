# 0205. Contiguous Slicing with from ... to / until

* **Status:** Accepted
* **Date:** 2026-09-08
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Values and Addressing

## Context

Mainstream languages rely on colon-based bracket notation for slicing contiguous subarrays or substrings:
- Python/Go: `array[start:end]`, `string[1:4]`
- Rust: `&array[start..end]`
- Julia/MATLAB: `A[1:4, 2:5]`

Because Rank has eliminated square brackets and colons (ADR-0202), we need a readable, unambiguous syntax to slice sub-sequences, strings, and tensor axes without introducing punctuation noise or cognitive ambiguity between inclusive and exclusive slice boundaries.

## Decision

Rank introduces **`from ... to` and `from ... until`** as the canonical syntax for contiguous slicing:

```rank
Closed = Text from L to R      rem Inclusive end (contains index R)
Open = Text from L until R     rem Exclusive end (excludes index R)
```

1. **Contextual keyword `from`:** 
   `from` appears strictly after the value being sliced, unambiguous from function calls or variable definitions.
2. **Boundary semantics:** 
   - `to` includes the final position ($[L, R]$).
   - `until` excludes the final position ($[L, R)$).
   - Slice bounds are zero-based, non-negative, and ascending ($L \le R$). An exclusive end may equal the sequence length; an inclusive end must lie strictly within bounds. Equal exclusive bounds (`from X until X`) produce an empty slice.
3. **Multidimensional tensor axis slicing:** 
   Combined with `axis`, contiguous slices can target any specific dimension of a tensor while preserving the remaining axes:
   ```rank
   Rows = Matrix axis 0 from 1 until 4
   Columns = Matrix axis 1 from 2 to 5
   ```
4. **Strings (Unicode code points):** 
   Slicing text produces a contiguous string slice based on Unicode code points, preserving proper character boundaries.

### Common Task Applications
This slicing model is heavily utilized across the language ecosystem:
- **String Algorithms:** Substring extraction in LeetCode (`demos/leetcode/005_longestpal.ra`: `Best = Text from L to R`) and Euler puzzles (`demos/euler/035_circularprimes.ra`: string rotations).
- **Machine Learning & DeepML:** Mini-batch generation (`demos/deepml/030_batch.ra`: `yield X from First until Last`), mini-batch SGD updates (`demos/deepml/047_descent.ra`: `Xb = X axis 0 from I until J`), and k-fold cross-validation (`demos/deepml/018_crossval.ra`).
- **Linear Algebra:** Computing matrix minors for recursive determinants (`demos/deepml/013_det.ra`: `Minor = A axis 0 from 1 until N`).
- **Tabular Data / SQL Pushdown:** Slicing queries and database tables as an idiomatic replacement for SQL `LIMIT` / `OFFSET` (`demos/pgexercises/basic/009_unique.ra`: `Rows from 0 until 10`).

## Consequences

### Positive
* **Self-documenting boundaries:** Eliminates confusion over whether the right slice bound is included or excluded.
* **Touchscreen ergonomics:** Uses primary-layer words instead of brackets and colons.
* **Orthogonal composability:** Slicing works identically across text, 1D arrays, and multidimensional tensor axes.
* **Query engine pushdown:** Slices over SQLite views are pushed down directly to SQL `LIMIT` / `OFFSET` without materializing records into memory.

### Negative & Trade-offs
* **Keyword overhead:** `Text from 0 until 5` uses more characters than `text[:5]`, but avoids punctuation switching on touchscreens and makes bounds intention explicit.

## References
* Section "Slices and ranges" in [docs/language/values-addressing.md](../../language/values-addressing.md)
* ADR-0202: [Whitespace Juxtaposition for Addressing and Selection](0202-whitespace-juxtaposition-for-addressing.md)
* ADR-0103: [First-Class Numeric Ranges (to, until, by)](0103-first-class-numeric-ranges.md)
