# 0003. Modular Vocabulary and Grammar Independence (use)

* **Status:** Accepted
* **Date:** 2026-09-08
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Modules and Programs Specification

## Context

Extensible languages (Lisp macros, Forth words, Scala custom operators) often allow imports and libraries to alter parser state and tokenizer rules:
- **Editor fragility:** Code cannot be parsed, syntax-highlighted, or formatted in lightweight editors (especially on mobile touchscreen environments or offline tools) without first loading and executing the full dependency tree.
- **Cascading parser errors:** A missing import or syntax error in a macro definition breaks AST construction for the entire file.

Conversely, mainstream languages that enforce namespace isolation force verbose prefixing (`math.sqrt(x)`, `np.linalg.det(m)`), which crowds the 40-column line budget on handheld devices.

Rank needs a way to extend the language's computational vocabulary across domains (numbers, sequences, linear algebra, tables) while ensuring the grammar remains robust and parseable in isolation.

## Decision

Rank establishes **strict parser grammar independence** paired with **semantic vocabulary gating via `use`** (Core Principle 7: "Libraries may add vocabulary through `use`"):

### 1. The Grammar is Self-Contained and Independent
Parsing **never** depends on which modules are imported:
- The grammar parses all valid Rank syntax (including blocks, options, and operations) identically, whether or not a `use` statement is present.
- Mobile editors, Language Server Protocol (LSP) tools, and syntax formatters can build complete, resilient ASTs immediately without loading runtime modules.

### 2. Post-Parse Semantic Vocabulary Gating
The `use` statement activates vocabulary, validators, and execution dispatch rules during semantic analysis:
```rank
use numbers
use sequences
use cli
```
Core operations (`len`, `sum`, `min`, `max`, `to`, `until`, `by`, `integer`, `real`, `text`) are built into `core` and require no `use`.

### 3. Actionable Compiler Diagnostics
When an unimported feature is encountered, the compiler provides helpful, actionable diagnostic messages rather than generic syntax failures:
- **Unknown identifier with a known provider:**
  ```text
  unknown name: sqrt; did you forget `use numbers`?
  ```
- **Grammar construct requiring a gating module:**
  ```text
  option requires: use cli
  test requires: use testing
  ```

### 4. Source Module Isolation
Quoted module paths (`use "my_module"`) import functions and schemas without executing top-level scripts or contaminating caller variable scopes.

## Consequences

### Positive
* **Fast and resilient tooling:** Editors and REPLs on mobile devices parse and format code instantly without loading heavy runtime dependencies.
* **Friendly developer ergonomics:** Beginners and developers get precise guidance on which `use` module is missing.
* **Clean 40-column code:** Functions from standard modules can be called directly without repetitive namespace prefixes (`sqrt`, not `numbers.sqrt`).

### Negative & Trade-offs
* **Catalogue maintenance:** The compiler and language server must maintain an index of vocabulary across all standard modules to provide intelligent "did you forget `use X`?" suggestions.

## References
* Core Principle 7 in [docs/CURRENT_SPEC.md](../../CURRENT_SPEC.md)
* Section "Standard modules" in [docs/language/modules-programs.md](../../language/modules-programs.md)
* Commit `08408b8` ("Add program inputs and Rank test runner")
* Initial commit `f8ef89b` (2026-09-08)
