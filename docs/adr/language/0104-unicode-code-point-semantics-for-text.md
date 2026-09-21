# 0104. Unicode Code Point Semantics for Text Strings

* **Status:** Accepted
* **Date:** 2026-09-08
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Values and Addressing Specification

## Context

Different programming languages model string internals in conflicting and error-prone ways:
1. **UTF-16 code units (JavaScript, Java, C#):** Emojis, mathematical symbols, and historic scripts require two 16-bit code units (surrogate pairs). In JavaScript, `"😀".length` is `2`, and indexing `"😀"[0]` extracts an invalid broken surrogate character (`"\uD83D"`), silently corrupting strings when sliced.
2. **Byte buffers (C, Go):** Indexing strings by byte offset can split multi-byte UTF-8 sequences in the middle of a character, producing malformed encoding errors.
3. **Character type complexity:** Some languages introduce a separate primitive character type (`char`), requiring explicit conversions between strings and characters.
4. **Multiline text on narrow screens:** Algorithmic puzzles (mazes, grids, keypads) require defining 2D text layouts. Escaped newlines (`"line1\nline2"`) destroy visual layout, while heredocs introduce fragile indentation stripping rules.

Rank needs a string model that is intuitive, mathematically clean, immune to surrogate fragmentation, and visual on narrow ~40-column screens.

## Decision

Rank establishes **Unicode code points (scalar values)** as the universal coordinate system for all string operations:

### 1. Code Point Addressing and Length
All length checks, indexing, and iteration operate on complete Unicode code points:
```rank
Letter = "A😀Б" 1
rem Letter evaluates to "😀"

Count = "A😀Б" len
rem Count evaluates to 3 (not 4)
```

### 2. Surrogate-Safe Slicing
Slicing through `from ... to / until` operates strictly on code point boundaries:
```rank
Prefix = "A😀Б" from 0 until 2
rem Produces "A😀" without splitting the surrogate pair
```
It is syntactically and semantically impossible to cleave a surrogate pair or extract an orphaned surrogate.

### 3. Strings as Immutable Scalar Values
- Text is an immutable scalar value obeying Rank's value semantics.
- Slicing or selecting elements from text returns another `text` value, rather than an array of boxed single-character types or ASCII byte numbers. Rank does not have a separate `char` type.

### 4. Rank Polymorphism on Text
Text behaves as a rank-1 sequence of characters:
- `"1203" integer` parses the string as a single number ($1203$).
- `"1203" integer rank 0` applies `integer` to individual character atoms, producing the vector `1 2 0 3`.
- `Text reverse` reverses the sequence of code points without corrupting multi-byte or surrogate characters.

### 5. Multiline Text Blocks for 40-Column Grids (`text` and `text lines`)
Writing multi-line ASCII maps, maze grids, lookup tables, or messages on narrow mobile screens (~40 columns) uses dedicated multiline text blocks where **every line is an ordinary quoted literal**:

- `text ... end` glues lines into one text with **no separator**. The resulting text is a 1D rank-1 sequence of code points, addressed with 2D row-major coordinates (`Y * Width + X`):
  ```rank
  Pad = text
    "....."
    ".123."
    ".456."
    ".789."
    "....."
  end
  Key = Pad 6  rem Evaluates to "1"
  ```
- `text lines ... end` joins lines using newline (`\n`), with no trailing line break:
  ```rank
  Message = text lines
    "First line"
    "Second line"
  end
  ```
- **Explicit quotes eliminate whitespace ambiguity:** Quoting each line (`"  #  "`) ensures leading and trailing spaces are preserved with 100% precision without complex heredoc indent-stripping heuristics.
- **Interleaved comments:** `rem` lines and blank lines between quoted lines are ignored.
- **Syntactic placement:** A text block occupies the whole right-hand side of an assignment (`Pad = text ... end`), with nothing allowed after `end`.

## Consequences

### Positive
* **Unicode correctness by default:** International text, emojis, mathematical symbols, and non-Latin alphabets behave predictably with 1:1 character mapping.
* **No `char` vs `string` fragmentation:** Eliminates the mental overhead of distinguishing single characters from strings.
* **Safe slicing and indexing:** Algorithmic puzzles (LeetCode, Euler) involving string manipulations are free from encoding traps.
* **Readable 2D grids on mobile:** Mazes and keypads are visual, clean, and fit neatly on narrow displays without fragile heredoc whitespace stripping.

### Negative & Trade-offs
* **Runtime scanning overhead:** In variable-width encodings (UTF-8/UTF-16), finding the $N$-th code point naively requires an $O(N)$ scan. The runtime/compiler must use rope or tree structures, or cache code point offsets for large text buffers.

## References
* Section "Sequence indexing" and "Multiline text" in [docs/language/values-addressing.md](../../language/values-addressing.md)
* Section "Text" and "Multiline text" in [docs/language/lexical-syntax.md](../../language/lexical-syntax.md)
* ADR-0000: [Narrow Screen Target and Mobile-First Ergonomics](0000-narrow-screen-and-mobile-first-ergonomics.md)
* ADR-0101: [Value Semantics with Copy-on-Write for Arrays and Tensors](0101-value-semantics-and-copy-on-write.md)
