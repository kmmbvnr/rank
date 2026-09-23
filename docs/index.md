# Rank Wiki

**Current language snapshot — 2026-09-12**

Rank is a modern BASIC for small screens and big algorithms.

The language is designed for:
- phones, calculators, wearables and tiny computers;
- competitive programming and algorithms;
- tables and data analysis;
- arrays, tensors and ML;
- source code that remains readable on narrow screens.
- [LLM-aided Rust rewrite](design/llm-rust-rewrite.md): use readable Rank as an
  executable reference for a standalone Rust program.

Language sections describe the current design. Compiler experiments and future
implementation plans are recorded separately under development workflow.

## Core principles

1. Keep source narrow: target about 40 characters per line.
2. Prefer letters, digits, spaces and easy keyboard symbols.
3. Avoid punctuation-heavy syntax.
4. Reuse a small set of general concepts across domains.
5. Do not add primitives that exist only to solve one puzzle.
6. The editor may help with quotes and blocks, but source is plain text.
7. Libraries may add vocabulary through `use`.
8. Arrays, tables and keyed data should share one addressing model.
9. Selection should reuse Rank's general addressing model.
10. Boolean masks are ordinary first-class values.
11. Boolean addressing is the fundamental selection primitive.
12. The `filter ... end` clause is concise source/query syntax, not mutation.
13. User-facing syntax should stay simple even if implementations use macros,
    compiler extensions or optimized execution plans internally.
14. Combine compatible tensor operations internally; readable temporary names
    should not inherently require intermediate arrays.
15. Prefer whole-array transformations and predicates. Use loops for the outer
    search or for state that cannot be expressed more clearly as dataflow.

The conceptual selection model is:

```text
value + selector -> value
```

For example:

```rank
Mask = Data .Age greater 18
Adults = Data Mask
```

See [Tensor fusion architecture](design/tensor-fusion.md) for the accepted
execution direction and its semantic requirements.

---

## Language Architecture (The Four Acts)

The foundational architecture of the pure Rank language core is documented across four chronological and logical acts in the [Architecture Decision Records](adr/language/README.md).

### Act I: Philosophy, Ergonomics & Program Structure
*Line budget, primary-layer keyboard vocabulary, BASIC heritage, and modular grammar independence.*
- [Lexical syntax](language/lexical-syntax.md) — 40-column target, words over symbols, indentation, and `rem` comments.
- [Modules, programs and inputs](language/modules-programs.md) — Modular vocabulary via `use` without grammar mutability.
- [Testing](language/testing.md) — First-class test syntax and assertions.
- [ADR Index: Act I](adr/language/README.md#act-i-philosophy-ergonomics--program-structure) — ADR-0000 through ADR-0003.

### Act II: Value Model & Type System
*Memory semantics, invariant variable typing, numeric tower, and scalar primitives.*
- [Values and addressing](language/values-addressing.md) — Pure values, transparent copy-on-write, and universal `default`.
- [Lexical syntax: Scalars](language/lexical-syntax.md#scalars-and-arithmetic) — Exact integer arithmetic, IEEE-754 reals, ranges (`to`/`until`), code-point text, and `.symbols`.
- [Record types](language/lexical-syntax.md#record-types) — Closed typed structures with shared reference identity.
- [ADR Index: Act II](adr/language/README.md#act-ii-value-model--type-system) — ADR-0100 through ADR-0107 (Type Stability, CoW, Tower, Ranges, Text Blocks, Symbols, Records, Default).

### Act III: Arrays, Tensors & Unified Selection Engine
*Multidimensional data representation, whitespace addressing, gather, slicing, and rank polymorphism.*
- [Tensor model](language/tensors.md) — Rank polymorphism, cell frames, axis reductions, and outer product.
- [Sequences and arrays](language/sequences-arrays.md) — Punctuation-free array construction, boolean masks, slices, and permutation.
- [ADR Index: Act III](adr/language/README.md#act-iii-arrays-tensors--unified-selection-engine) — ADR-0200 through ADR-0207 (Rank Polymorphism, Array Blocks, Juxtaposition, Masks, `#`, Slicing, Gather, Unpack).

### Act IV: Computation, Control Flow & Dataflow
*Data-first execution order, intentional naming, and unified iteration.*
- [Control flow and functions](language/control-functions.md) — Data-first postfix calls, intermediate variables, `if` conditionals, `for ... end`, `fun` closures with TCO, `memo`, `yield` streams, structured `try/catch/raise`, and scope-bound resources.
- [ADR Index: Act IV](adr/language/README.md#act-iv-computation-control-flow--dataflow) — ADR-0300 through ADR-0308 (Intermediate Variables, Data-First Calls, Functions & TCO, Memoization, Unified `for`, Generators, Error Handling, Conditionals, Scoped Resources).

---

## Standard Library & Domain Extensions

Structures, modules, and query syntax that extend the core language via `use`:
- [Collections](language/collections.md) — High-performance algorithmic data structures (`index`, `queue`, `deque`, `heap`, `dsu`, `fenwick`).
- [Graphs](language/graphs.md) — First-class graph modeling and graph algorithms.
- [Tables](language/tables.md) — Tabular data manipulation, `select ... end` query blocks, and SQLite views.
- [Standard library overview](stdlib/modules.md) — Available standard library modules.
- [Standard library reference](stdlib/reference.md) — Comprehensive standard library function catalog.
- [ADR Index: Standard Library](adr/stdlib/README.md) — Architectural decisions for `cli`, `testing`, `tables`, `sqlite`, `algo`, `graph`, `sequences`, `dates`, `linalg`, and `stats`.

---

## Examples & Benchmarks

- [Project Euler examples](examples/project-euler.md)
- [LeetCode examples](examples/leetcode.md)
- [Kaggle examples](examples/kaggle.md)
- [SQL challenge roadmap](examples/sql-challenges.md)
- [TPC-H examples](examples/tpch.md)

---

## Design, Roadmaps & Product Decisions

- [Product decisions](design/product-decisions.md)
- [Open questions](design/open-questions.md)
- [Array element types and compact storage](design/array-element-types.md)
- [Numerical scripting roadmap](design/numerical-scripting-roadmap.md)
- [R data-analysis roadmap](design/r-data-analysis-roadmap.md)
- [Task corpora: numerical, R and contest problems](design/task-corpora.md)

---

## Development workflow

- [ADR Index: Implementation & Runtime](adr/implementation/README.md) — Architectural decisions for compiler internals, memory model, shape inference, and JIT kernel fusion.
- [LLM-aided Rust rewrite](design/llm-rust-rewrite.md)
- [Console, editor and the analysis core](design/editor-plan.md)
- [REPL input on a phone keyboard](design/repl-input.md)
- [Looking at a sequence without spending it](design/generator-previews.md)
- [Judge-scale performance checks](design/judge-scale-benchmarks.md)
- [Turning solution drafts into Rank programs](design/example-workflow.md)
- [SQLite query translation roadmap](design/sqlite-tables.md)
- [Simpler table programs: design decision](design/table-query-ergonomics.md)
- [Performance roadmap: remaining work](design/performance-roadmap.md)
- [Tensor fusion improvement plan](design/tensor-fusion-plan.md)
- [Abstract interpretation and symbolic shape inference](design/abstract-interpretation-shape-inference.md)
- [NPU and GPU tensor backends: research notes](design/npu-backends.md)
- [Mobile hardware and live shaders](design/mobile-graphics.md)
- [Parallel tensor worker results](design/tensor-workers-results.md)
- [Performance measurements and benchmark commands](design/performance-measurements.md)
- [Arrow table storage experiment](design/arrow-titanic-experiment.md)

---

## Marketing

- [Landscape](marketing/landscape.md)
- [Positioning](marketing/positioning.md)
- [Languages to learn from](marketing/inspirations.md)
- [Launch playbook](marketing/launch-playbook.md)

- [Fusion delivery and worker recheck](design/fusion-results.md)
