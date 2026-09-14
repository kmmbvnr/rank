# Rank Wiki

**Current language snapshot — 2026-09-12**

Rank is a modern BASIC for small screens and big algorithms.

The language is designed for:
- phones, calculators, wearables and tiny computers;
- competitive programming and algorithms;
- tables and data analysis;
- arrays, tensors and ML;
- source code that remains readable on narrow screens.

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

## Current sections

- [Lexical syntax](language/lexical-syntax.md)
- [Modules, programs and inputs](language/modules-programs.md)
- [Testing](language/testing.md)
- [Values and addressing](language/values-addressing.md)
- [Control flow and functions](language/control-functions.md)
- [Sequences and arrays](language/sequences-arrays.md)
- [Collections](language/collections.md)
- [Graphs](language/graphs.md)
- [Tables](language/tables.md)
- [Tensor model](language/tensors.md)
- [Standard library](stdlib/modules.md)
- [Standard library reference](stdlib/reference.md)
- [Project Euler examples](examples/project-euler.md)
- [LeetCode examples](examples/leetcode.md)
- [Kaggle examples](examples/kaggle.md)
- [SQL challenge roadmap](examples/sql-challenges.md)
- [TPC-H examples](examples/tpch.md)
- [Product decisions](design/product-decisions.md)
- [Open questions](design/open-questions.md)
- [Array element types and compact storage](design/array-element-types.md)

## Development workflow

- [Console, editor and the analysis core](design/editor-plan.md)
- [REPL input on a phone keyboard](design/repl-input.md)
- [Looking at a sequence without spending it](design/generator-previews.md)
- [Judge-scale performance checks](design/judge-scale-benchmarks.md)
- [Turning solution drafts into Rank programs](design/example-workflow.md)
- [SQLite query translation roadmap](design/sqlite-tables.md)
- [Simpler table programs: design decision](design/table-query-ergonomics.md)
- [Performance roadmap: remaining work](design/performance-roadmap.md)
- [Tensor fusion improvement plan](design/tensor-fusion-plan.md)
- [NPU and GPU tensor backends: research notes](design/npu-backends.md)
- [Mobile hardware and live shaders](design/mobile-graphics.md)
- [Parallel tensor worker results](design/tensor-workers-results.md)
- [Performance measurements and benchmark commands](design/performance-measurements.md)

## Marketing

- [Landscape](marketing/landscape.md)
- [Positioning](marketing/positioning.md)
- [Languages to learn from](marketing/inspirations.md)
- [Launch playbook](marketing/launch-playbook.md)

- [Fusion delivery and worker recheck](design/fusion-results.md)
