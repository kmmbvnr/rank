# 0002. Modern BASIC Lineage and Lexical Tone

* **Status:** Accepted
* **Date:** 2026-09-08
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification & Positioning

## Context

Array programming languages (APL, J, K, BQN) offer unmatched expressive power for mathematical and tabular data, but historically suffer from a high barrier to entry due to dense punctuation, ASCII glyphs, or custom symbol sets. Conversely, systems and mainstream languages (C, Java, Rust, JavaScript) introduce significant syntactical ceremony: curly braces (`{}`), semicolons (`;`), type boilerplate, and mandatory parentheses around conditions.

BASIC historically solved the readability and approachability problem: it was readable, conversational, and direct. However, traditional dialects carry historical baggage (line numbers, unstructured `GOTO`, global mutation).

Rank seeks to bridge this gap: **the conceptual power of an array language paired with the approachable, ceremony-free tone of a modern BASIC.**

## Decision

We adopt the lineage, tone, and lexical conventions of a modern BASIC:

1. **`rem` for comments:** Comments begin with the `rem` keyword (remark) rather than `#` or `//`. It may appear as a standalone line or as a trailing inline comment (`Answer = 42 rem The result`).
2. **Capitalized variables (PascalCase):** User-defined variables and bindings are capitalized (`Digits`, `Windows`, `Answer`, `RunningTotal`).
3. **Lowercase primitives and operations:** Built-in keywords, transformations, and reductions are lowercase (`for`, `if`, `end`, `sum`, `window`, `scan`, `min`). This provides immediate visual differentiation between data and operations.
4. **Keyword block delimiters (`end`):** Blocks are closed with `end` (`if ... end`, `for ... end`, `fun ... end`), eliminating curly braces (`{}`) and avoiding Python's significant indentation traps. Indentation is purely visual, never semantic.
5. **Newline-terminated statements:** Statements terminate at newlines without semicolons (`;`).
6. **No mandatory parentheses:** Parentheses are reserved solely for sub-expression grouping and multi-line continuation; condition headers do not require parentheses (`if Count greater 10`, not `if (Count > 10)`).

## Consequences

### Positive
* **Approachable and uncluttered:** Programs read cleanly without syntactic noise or bracket-matching cognitive load.
* **Instant visual parsing:** Capitalized identifiers immediately stand out as data values, while lowercase words indicate transformations and control flow.
* **Mobile screen friendliness:** Closing with `end` makes block scopes unambiguous on small screens where indentation might be obscured or truncated.
* **Friendly to beginners:** Avoids the steep visual cliff of traditional array languages while retaining their expressive vector operations.

### Negative & Trade-offs
* **Departure from Unix/C conventions:** Programmers from Python or C may be surprised by `rem` instead of `#`/`//`, and PascalCase variables instead of `snake_case` or `camelCase`.
* **Case sensitivity semantics:** The lexer enforces a semantic distinction based on capitalization, requiring discipline from the author.

## References
* "Why not lead with BASIC" in [docs/marketing/positioning.md](../../marketing/positioning.md)
* Section "Lexical syntax" in [docs/language/lexical-syntax.md](../../language/lexical-syntax.md)
* Core Principles 2, 3, 6 in [docs/CURRENT_SPEC.md](../../CURRENT_SPEC.md)
* Initial commit `f8ef89b` (2026-09-08)
