# 0001. Words Over Symbols for Comparisons and Logic

* **Status:** Accepted
* **Date:** 2026-09-08
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification & Ergonomics Review

## Context

Conventional programming languages rely on punctuation symbols for comparisons and boolean logic (`==`, `!=`, `<`, `>`, `<=`, `>=`, `&&`, `||`, `!`).

On desktop keyboards, these symbols have dedicated physical keys or require a single Shift press. However, on touchscreen keyboards (smartphones, tablets, handheld terminals):
1. **Letters reside on the primary layer:** They are immediately accessible and support continuous thumb-typing, swipe gestures, and system predictive auto-complete.
2. **Punctuation requires multi-layer shifts:** Typing an operator like `<=` typically requires tapping `?123`, locating `<`, tapping `#+=` for `=`, and switching back to the alphabet layer. This creates high cognitive friction and disrupts typing rhythm.

We need a syntax for relational and boolean operations that is fast to type on mobile devices and easy to read on narrow displays.

## Decision

Rank adopts **English words exclusively** for relational and boolean operations, and **deliberately rejects symbolic aliases**:

| Operation | Rank Keyword | Conventional Symbol |
|---|---|---|
| Equality | `equal` | `==` |
| Inequality | `not equal` | `!=` |
| Less than | `less` | `<` |
| Greater than | `greater` | `>` |
| Less than or equal | `at most` | `<=` |
| Greater than or equal | `at least` | `>=` |
| Boolean conjunction | `and` | `&&` |
| Boolean disjunction | `or` | `||` |
| Boolean negation | `not` | `!` |

### Rejection of Dual Syntax / Symbolic Aliases
We deliberately reject supporting both words and symbols (e.g., allowing both `equal` and `==`). Permitting dual syntax leads to dialect fragmentation, inconsistent community codebases, and undermines the mobile-first ergonomics of the language.

## Consequences

### Positive
* **Seamless touch typing:** All comparison and boolean operations can be typed continuously on the primary mobile keyboard layer without switching to numeric or symbol sub-layouts.
* **Swipe and autocomplete support:** Mobile keyboard engines can easily predict and swipe words like `greater`, `equal`, or `least`.
* **Prose readability:** Expressions read naturally as plain English sentences (`if Value at least 10 and Value less 100`).
* **Unambiguous parsing:** Eliminates lexical ambiguities between relational symbols, brackets, and assignment operators.

### Negative & Trade-offs
* **Muscle memory friction:** Programmers accustomed to C-style or Python syntax may initially type `==`, `!=`, or `<=`. The compiler must provide clear, friendly diagnostic messages suggesting the word equivalent.
* **Character count per operator:** A word like `at least` uses 8 characters compared to 2 for `>=`. However, in practice, this is offset by the lack of parentheses and the brevity of Rank's array-wide operations.

## References
* Core Principle 2 & 3 in [docs/CURRENT_SPEC.md](../../CURRENT_SPEC.md)
* Section 1 ("Words over symbols for comparisons and logic") in [docs/design/product-decisions.md](../design/product-decisions.md)
* Initial commit `f8ef89b` (2026-09-08) and `bd1f560` (2026-09-09)
