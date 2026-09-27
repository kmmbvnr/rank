# Issue #1: baseline and semantic ownership

Status: working migration record, 2026-09-27. The behavior measurements below
were taken after fixing the missing `use numbers` in the houses demo (commit
`517fc2b`). Times are local samples, not performance promises.

## Decision from the issue review

The first comment's `tensor-helpers.ts` extraction would merely move unrelated
selection, comparison, argument, resource and application code into another
large file. The revised issue body correctly asks for semantic owners. The last
comment identifies the most useful first owner: application forms are recognized
in the interpreter, value analysis and modifier grouping. Work on forms and
analysis should precede broad mechanical extraction of the interpreter tail.

For this refactor, migrate existing behavior and remove duplicated recognition.
The bottom/top abstract domain, recursive fixed-point policy and specialization
caches are decisions for #5 and #4 when their consumers are built. Their absence
must not force a new framework into this extraction. The near-term target is
#3/#4: a return contract and call-site analysis should have clear places to
attach without adding spelling checks in multiple packages.

## Current owners and direction

| Concern | Current owner / boundary | Migration target |
| --- | --- | --- |
| Syntax and application grouping | `language/expressions.ts`, `modifier-grouping.ts` | One binding-aware form recognizer in `language`, used by grouping, runtime and analysis |
| Builtin identity and metadata | `language/operations.ts`; runtime implementations in `interpreter/modules/` | Reuse the operation entry; keep executable values in runtime |
| Names and scopes | `language/analysis/bindings.ts`, `block-scope.ts`; runtime `frame.ts` | Keep static scope facts separate from mutable runtime frames |
| Type/rank facts and diagnostics | `value-facts.ts` (1,229 lines), `value-diagnostics.ts` (1,749 lines) | Extract transfer, call and flow responsibilities as they gain actual consumers |
| Execution and compiler dispatch | `interpreter.ts` (7,335 lines), `execution.ts`, prepared-function and compiler modules | Preserve `Interpreter` as facade; move node handlers through narrow dependencies |
| Resources and host effects | `interpreter.ts`, `resource-summary.ts`, `host-effects.ts` | Keep lifetime and host policy visible at the execution boundary |
| REPL | `common` sessions and preview generation | Pass explicit preview origin to language analysis when replacing the name-prefix convention |

`language` cannot import interpreter values, callbacks, host I/O or UI state.
Runtime may consume language AST and semantic descriptions. `common` may adapt
source revisions and safe facts, but must not define competing type rules.
Neither an extracted runtime module nor an analysis module may import the
`Interpreter` facade to call private methods. Unsupported analysis remains
conservative and does not block ordinary execution.

The public runtime surface is `Interpreter` (`execute`, `evaluate`, `dispose`,
`variables`, `modules`, `testResults`), `InterpreterOptions` and the existing
exports from `interpreter/index.ts`. `analyzeValues`, `expressionFacts`,
`analyzeBindings` and `analyzeWithImports` are exported from `language/index.ts`.
These exports and observable evaluation order are compatibility boundaries.

Issue #2 is closed; `scopeBlock`, `frame.ts`, `block-scope.ts` and scope tests
already implement its core behavior. Issue #31 remains open and asks for a
collection element-contract decision; current collection checks and inferred
facts do not settle that policy. Neither issue should be reimplemented here.

## Baseline and repeatable checks

- `node --test --test-name-pattern='explain finds nothing' packages/cli/test/explain.test.mjs`: pass after `517fc2b`; it failed before that commit on `aoc/2015/003_houses.ra: even`. The demo test now passes too.
- `node benchmarks/analysis-coverage.mjs --conflicts`: 1,051 known results of 1,087 demo calls, zero reported expectation conflicts; 466 source files. This is an inference coverage check, not a runtime proof.
- `node benchmarks/refactor-analysis-latency.mjs`: short incomplete source median 0.10 ms, p95 0.17 ms; 200-assignment incomplete source median 5.22 ms, p95 6.42 ms. This measures parser plus `analyzeValues`, excluding UI and worker scheduling.
- `node benchmarks/cow-demos.mjs 256 5`: median warm execution 15.00 ms for gradient, 6.89 ms for k-means, 3.91 ms for Adam. CoW copies per run were 0, 1 and 0 respectively; copied cells were 0, 256 and 0. CoW counters are not total allocations.
- `node packages/cli/bin/cli.js test demos/euler`: 60 files, zero failures (82.37 s elapsed in this local run).
- `npm test` and `node packages/cli/bin/cli.js test demos/euler` are the broad integration gates. Focused tests must also compare affected compiled and interpreted paths, errors, output, mutation order, generators, resource cleanup and REPL invalidation.

Each coherent slice gets its own local commit after checks. At final integration,
compare correctness, inference coverage, copy counts, execution time and edit
latency separately. File count alone is not an acceptance metric. A pilot for
#24 or #26 should need one form recognizer, one runtime case and one analysis
case, with the new form visible to the compiler's exhaustive checks.
