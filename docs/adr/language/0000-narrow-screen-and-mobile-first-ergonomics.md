# 0000. Narrow Screen Target and Mobile-First Ergonomics

* **Status:** Accepted
* **Date:** 2026-09-08
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification & Positioning

## Context

Virtually all modern programming languages (C, Python, Rust, JavaScript, APL) are designed with two implicit hardware assumptions:
1. **Desktop-width displays:** Code is expected to wrap comfortably across 80 to 120+ columns.
2. **Physical mechanical keyboards:** Punctuation keys (`<`, `>`, `!`, `=`, `&`, `{`, `}`) are readily accessible directly or via single-key Shift chords.

However, programming on handheld devices (smartphones, pocket terminals, graphing calculators, wearables):
- Forces horizontal scrolling or awkward line wrapping when viewing standard source code, breaking visual flow and comprehension.
- Imposes heavy input friction on touchscreen keyboards, where symbols and relational operators require repeatedly switching keyboard layers (`?123` / `#+=`).

Rank aims to be a computational array language that is enjoyable and productive to read and write directly on handheld devices.

## Decision

We establish **a strict ~40-column line width budget** and **mobile-first input ergonomics** as the primary design constraint for the language syntax, standard library, and canonical idioms:

1. **Target ~40 characters per line:** All standard library functions, examples, and idiomatic idioms must fit within approximately 40 columns without horizontal scrolling.
2. **Compact two-space indentation:** Each nesting level adds exactly two spaces. Four-space or tab indentations are rejected because they consume 10–20% of the screen width per indentation level.
3. **Parenthesized line continuation:** A newline normally ends an expression. When an expression must exceed 40 columns, it may be wrapped in parentheses to continue across multiple lines without escape characters:
   ```rank
   Ready = (
     Count greater 0
     and Count at most Limit
   )
   ```
4. **Vertical dataflow over horizontal density:** The language explicitly rejects multi-variable comprehensions, dense one-liners, and horizontal call chaining that crowd the line width.
5. **Primary-layer typing:** Syntax must favor standard alphanumeric words and basic whitespace over multi-layer punctuation symbols.

## Consequences

### Positive
* **Readability on handhelds:** Code renders naturally on smartphones, pocket terminals, split-screen mobile editors, and calculator displays without horizontal wrapping.
* **Ergonomic touchscreen input:** Programs can be drafted and edited using standard thumb typing, touch swipe gestures, and system auto-complete.
* **Clean visual structure:** Short, focused lines encourage clear dataflow and make step-by-step algorithms easy to reason about.

### Negative & Trade-offs
* **Rejection of common desktop paradigms:** Syntax features common in desktop-first languages—such as multi-generator comprehensions (`for a in 1..N, b in a..N`), long vertical pipe-chains (`|>`), and nested bracket-comma indexing—are deliberately rejected or restricted.
* **Increased vertical line count:** Algorithms may require more vertical lines of code, broken down into named intermediate variables.

## References
* Core Principles 1, 2, 3 in [docs/CURRENT_SPEC.md](../../CURRENT_SPEC.md)
* Section 1 & Section 3 in [docs/design/product-decisions.md](../design/product-decisions.md)
* Initial commit `f8ef89b` (2026-09-08)
