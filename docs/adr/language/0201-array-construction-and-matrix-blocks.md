# 0201. Array Construction and Multidimensional Block Syntax

* **Status:** Accepted
* **Date:** 2026-09-08
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Sequences and Arrays Specification

## Context

Most programming languages construct array literals using bracket-and-comma punctuation:
- 1D arrays: `[1, 2, 3]` (Python/JS/Rust)
- 2D matrices: `[[1, 2, 3], [4, 5, 6]]`

On mobile touchscreens and narrow 40-column screens:
1. **Bracket clutter:** Nested brackets `[[ ... ]]` and commas require constant layer switching on touch keyboards.
2. **Visual layout friction:** Nested bracket lists obscure the 2D tabular structure of matrices, making it difficult to verify alignment on narrow screens.
3. **Punctuation rejection:** Having eliminated brackets from addressing (ADR-0202), retaining brackets solely for array construction would create grammatical inconsistency.

## Decision

Rank introduces the **`array` keyword and dimensional block syntax** for array and tensor literals:

### 1. Inline Flat Arrays
An inline `array` consumes whitespace-separated values until the end of the line or expression:
```rank
A = array 1 2 3
Words = array "apple" "banana" "cherry"
```
No brackets or commas are required.

### 2. Multi-Line Matrix Blocks with `shape`
Multidimensional matrices are declared cleanly using `array shape [dimensions]` followed by visually aligned rows, terminating with `end`:
```rank
M = array shape 2 3
  1 2 3
  4 5 6
end
```
- Values are read in row-major order.
- The total element count must match the product of the declared dimensions exactly.
- The 2D grid renders cleanly on narrow screens without bracket clutter.

### 3. Pre-Allocated Arrays (`fill`)
Arrays initialized with a default fill value use `array shape ... fill`:
```rank
Buffer = array shape 1000 fill 0
Grid = array shape 10 10 fill .empty
```

## Consequences

### Positive
* **Punctuation-free construction:** Completely eliminates `[` and `]` from literal declarations.
* **Readable matrix layouts:** Multidimensional arrays read like clean ASCII tables rather than nested bracket soup.
* **Consistency:** Aligns array construction with the rest of Rank's whitespace-separated, keyword-closed (`end`) grammar.

### Negative & Trade-offs
* **Inline parsing scope:** Inline `array 1 2 3` eagerly consumes subsequent values on the line, requiring parentheses if used as a sub-expression in a larger statement (`Total = (array 1 2 3) sum`).

## References
* Section "Array construction" in [docs/language/sequences-arrays.md](../../language/sequences-arrays.md)
* ADR-0202: [Whitespace Juxtaposition for Addressing and Selection](0202-whitespace-juxtaposition-for-addressing.md)
* Commit `fb1f27e` ("Specify array construction syntax")
* Commit `7560ad9` ("Implement arrays and LeetCode Two Sum")
