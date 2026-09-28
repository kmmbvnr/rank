# 0003. Modular Vocabulary and Grammar Independence (use)

* **Status:** Accepted
* **Date:** 2026-09-08
* **Updated:** 2026-09-28 — protect available builtin names (#36); require unique standard-library names (#65)
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
Builtin function names are unique across the entire standard library. A module
controls whether a function is visible; it does not provide a separate namespace
for another builtin with the same name.

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

### 5. Available Builtin Names Cannot Be Redefined

Core names and names exported by opened standard modules cannot be used for
user functions, parameters or local bindings. Unopened module vocabulary is
still available for user declarations. Importing a module after a conflicting
declaration is also an error, including across REPL executions.

The shared rule is in `language/builtin-bindings.ts`. Runtime checks module
activation and user-function imports as well as declarations; static analysis
reports source conflicts without running the program. Aliased source imports
keep their own namespace. Builtin aliases such as `Op = matmul` remain legal
and retain their special application forms.

Receiver methods remain contextual. A DSU's `findroot` method takes precedence
when the receiver is a DSU; a different receiver uses ordinary function lookup.
This is separate from the ban on redefining available builtin names.

The host API may inject values directly. Optimizer identity guards needed for
host-injected values remain; the source-language ban does not remove that API.

## Consequences

### Positive
* **Fast and resilient tooling:** Editors and REPLs on mobile devices parse and format code instantly without loading heavy runtime dependencies.
* **Friendly developer ergonomics:** Beginners and developers get precise guidance on which `use` module is missing.
* **Clean 40-column code:** Functions from standard modules can be called directly without repetitive namespace prefixes (`sqrt`, not `numbers.sqrt`).

### Negative & Trade-offs
* **Compatibility:** Existing programs that redefine available builtin names must rename those functions. Adding `use` can expose a conflict; adding a builtin to an unopened module cannot.
* **Catalogue maintenance:** The compiler and language server must maintain an index of vocabulary across all standard modules to provide intelligent "did you forget `use X`?" suggestions.

## References
* Core Principle 7 in [docs/CURRENT_SPEC.md](../../CURRENT_SPEC.md)
* Section "Standard modules" in [docs/language/modules-programs.md](../../language/modules-programs.md)
* Commit `08408b8` ("Add program inputs and Rank test runner")
* Initial commit `f8ef89b` (2026-09-08)
