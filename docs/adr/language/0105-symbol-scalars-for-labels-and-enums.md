# 0105. Symbol Scalars for Labels, Enums, Fields, and Type Tags

* **Status:** Accepted
* **Date:** 2026-09-08
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Lexical Syntax Specification

## Context

Mainstream languages require multiple separate language constructs to represent discrete names, states, and record keys:
1. **Enum declarations:** `enum Mode { Fast, Safe }` or TypeScript union types `'fast' | 'safe'`.
2. **Field identifiers:** Separate syntax for declared struct fields versus dynamic dictionary string keys.
3. **Strings for options:** Passing strings like `"descending"` incurs quote typing (`"`) and allocation overhead.
4. **Type reflection:** Complex reflection systems or string-based `typeof` operators.

On narrow 40-column screens and touchscreen keyboards:
- Formal `enum` declarations require multi-line boilerplate that crowds narrow screens.
- Typing quotes (`"`) requires keyboard shifts on mobile keyboards.
- Strings used as keys lack immediate visual distinction from data text.

Rank needs a lightweight, ceremony-free way to represent discrete identifiers, options, and record keys (Core Principle 4: "Reuse a small set of general concepts across domains").

## Decision

Rank establishes the **Symbol scalar** (syntactically written as `.identifier`) as an interned, first-class primitive value:

### 1. Unified Uses Across Domains
A symbol serves four foundational roles without requiring type declarations:

- **Ad-hoc Enumerations and Options:**
  ```rank
  Order = .descending
  if Status equal .ready
    ...
  end
  ```
  No `enum` type definition is required; developers use symbols directly.

- **Record Field Identifiers:**
  ```rank
  Node = record .data = 2 .grad = 0 .op = .leaf
  ```

- **Table Column Selectors:**
  ```rank
  Adults = Users (Users .Age at least 18)
  ```

- **Type Guards and Introspection:**
  ```rank
  if Value is .integer
    Value print
  end
  CurrentKind = Value type    rem Returns .integer, .text, .array, .record, etc.
  ```

### 2. Interned, Immutable Value Semantics
- Symbols are immutable scalar values.
- Equality comparison (`Sym1 equal Sym2`) is an $O(1)$ identity check.
- Printing a record or symbol preserves its dot prefix:
  ```rank
  Node print
  rem Outputs: {.data = 2, .grad = 0, .op = .leaf}
  ```

### 3. Touchscreen Ergonomics
The period (`.`) is permanently situated on the primary layer of virtually all mobile and handheld keyboards next to the spacebar, making `.name` fast to type without layer shifts.

## Consequences

### Positive
* **Zero enum ceremony:** Completely eliminates `enum` declarations, saving vertical space.
* **Unified conceptual model:** A single concept handles struct fields, table columns, type tags, and configuration flags.
* **High performance:** Backed by interned tokens with instant $O(1)$ equality comparison.
* **Touch typing friendly:** Fast to type on mobile keyboards without quote marks (`"`).

### Negative & Trade-offs
* **Open vocabulary trade-off:** Because symbols do not require prior declaration, typos (e.g. typing `.desending` instead of `.descending`) are not caught at declaration time and must be detected by static flow analysis or runtime assertions.

## References
* Section "Lexical syntax" and "Record types" in [docs/language/lexical-syntax.md](../../language/lexical-syntax.md)
* Core Principle 4 in [docs/CURRENT_SPEC.md](../../CURRENT_SPEC.md)
* Initial commit `f8ef89b` (2026-09-08)
