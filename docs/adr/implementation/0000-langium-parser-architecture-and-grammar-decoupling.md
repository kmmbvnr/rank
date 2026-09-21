# 0000. Langium Parser Architecture and Grammar Decoupling

* **Status:** Accepted
* **Date:** 2026-09-08
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Parser Memory Benchmark, Language Server Architecture

## Context

Designing the compiler frontend and parser for Rank presents distinct architectural constraints:
1. **Mobile-first editing and live LSP feedback:** Rank is designed to run on resource-constrained devices (phones, tablets, web REPLs) with instantaneous Language Server Protocol (LSP) feedback, requiring fast incremental parsing, error-tolerant CST construction, and immediate diagnostic recovery.
2. **Ambiguity in whitespace juxtaposition:** Rank uses whitespace for both function application (`30 sin`, `A B gcd`) and array/matrix indexing (`M i j`). The parser must resolve these ambiguous token streams deterministically without catastrophic backtracking.
3. **Decoupling parsing from module loading:** Extensible languages often allow modules to mutate the parser grammar at runtime (e.g. macro systems or custom operator definitions). However, runtime grammar mutation destroys tooling stability, breaks syntax highlighters, and prevents static analysis.

Rank requires a stable, high-performance compiler frontend that decouples parsing from module evaluation, recovers gracefully from incomplete mobile typing, and produces a clean AST from a single unified grammar.

## Decision

Rank establishes the **Langium Parser Architecture with Grammar Decoupling and CST Normalization**:

```mermaid
flowchart LR
    Source["Rank Source (.ra)"] --> Lexer["Chevrotain Lexer"]
    Lexer --> Parser["Langium LL(*) Parser"]
    Parser --> CST["Concrete Syntax Tree (CST)"]
    CST --> Normalizer["AST Normalizer (groupModifiers)"]
    Normalizer --> AST["Clean Abstract Syntax Tree"]
    AST --> Validator["Rank Validator & Binding Pass"]
```

### 1. Unified Stable Grammar Built on Langium / Chevrotain
- Rank's grammar is defined declaratively in `rank.langium` and compiled into an optimized Chevrotain LL(*) recursive descent parser.
- **No runtime grammar mutation:** In accordance with ADR-0003, standard library modules loaded via `use` cannot alter parser tables. All core constructs and domain keywords exist in one unified, stable grammar.
- `use` enables semantic handlers, validator rules, and execution plans *after* CST construction.

### 2. Resolution of Whitespace Juxtaposition
The grammar parses chains of primary expressions into a unified application representation:
- To avoid LL(*) lookahead combinatorial explosions across nested parentheses, recursive primaries are parsed once via `PrimaryApplicationExpression`.
- Intermediate nodes like `PrimaryTailExpression` capture adjacent operands uniformly.
- An AST normalization pass (`flattenApplication`, `groupModifiers`) resolves ambiguous boundaries, separating data arguments, modifiers (`rank`, `axis`, `outer`, `scan`, `reduce`), and method calls deterministically.

### 3. Error-Tolerant CST Construction
- The parser produces a full Concrete Syntax Tree (CST) that preserves comments (`rem`), whitespace tokens, and exact line/column offsets.
- When a user types incomplete statements on a touchscreen keyboard (e.g. unclosed `for` or `if` blocks), Langium recovers gracefully, providing partial CST nodes so syntax highlighting and autocomplete continue functioning.

### 4. Continuous Language Server (LSP) Integration
Because Langium implements the Language Server Protocol out-of-the-box, the same compiler frontend serves:
- The standalone CLI (`rank check`, `rank explain`, `rank run`);
- The WebAssembly in-browser REPL;
- VS Code and mobile editor language servers.

## Consequences

### Positive
* **Fast parsing:** Chevrotain-generated lexer/parser achieves sub-millisecond parsing times for typical ~40-column scripts.
* **Deterministic tooling:** Syntax highlighters, formatters, and static linters never depend on module resolution to parse source files.
* **Resilient mobile editing:** Instantaneous LSP diagnostics without editor crashes when typing incomplete expressions.
* **Clean AST decoupling:** Parser grammar rules stay focused on syntax structure, while semantic validators enforce domain rules.

### Negative / Trade-offs
* **Need for AST normalization:** Because whitespace juxtaposition parses broadly, a dedicated post-parsing normalization pass (`groupModifiers`) is required to structure complex higher-order modifier chains before execution.
