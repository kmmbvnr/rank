# Issue #1: baseline and semantic ownership

Status: working migration record, 2026-09-28. The baseline measurements below
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

The later typing and interpreter walkthrough comments add a useful review test:
for each user-visible typing rule and execution stage, a contributor should be
able to find its owner. They are an ownership map, not an instruction to create
every suggested file. In particular, static rejection needs proof that *all*
possible types conflict, while runtime checks a concrete value; sharing a
binding rule must retain that difference. Existing `frame.ts`, `execution.ts`,
storage and compiler modules remain owners where they already have a clear job.

## Semantic owners after the migration

| Concern | Owner / boundary | Where a new rule goes |
| --- | --- | --- |
| Syntax and application forms | `language/application-forms.ts`, `expressions.ts`, `modifier-grouping.ts` | Recognize the syntax in language; consume the form in runtime and analysis |
| Builtin identity and metadata | `language/operations.ts`; runtime implementations in `interpreter/modules/` | Extend the operation entry and its module implementation |
| Names and scopes | `language/analysis/bindings.ts`, `block-scope.ts`; runtime `frame.ts` | Keep static scope facts separate from mutable runtime frames |
| Binding type and rank | `language/binding-rule.ts`, `type-names.ts`; runtime classification in `interpreter/value.ts` | Change the shared rule or name once, then classify concrete values at runtime |
| Abstract facts and transfer | `analysis/value-domain.ts`, `binary-facts.ts`, `application-facts.ts`, `value-facts.ts` | Add abstract transfer without evaluating user code or lazy cells |
| Flow and safety proofs | `analysis/control-flow.ts`, `value-safety.ts`, `operation-proofs.ts` | Prove conflicts conservatively; keep storage and effect guards separate |
| Function yields | `analysis/function-yields.ts` | Summarize generator cells from safe parameter and local facts without executing the body |
| Bounded recursion proof | `analysis/numeric-recursion.ts` | Keep eligibility and input widening separate from call-site execution paths |
| Call analysis and diagnostics | `analysis/function-calls.ts`, `analysis/value-diagnostics.ts` | Keep call-site budgets, recursive probes and call diagnostics in call analysis; join return paths and project remaining diagnostics in value analysis |
| Table expression evaluation | `interpreter/keyed-table-expression.ts` | Add a keyed table case there with only module and expression-evaluation capabilities |
| Table queries and writes | `interpreter/table-query-expression.ts` | Keep `filter`, `select` and SQLite write semantics behind table-specific evaluation, frame and builtin-identity capabilities |
| Selectors and rank application | `interpreter/selectors.ts`, `tensor-index.ts`, `rank-application.ts`, `reduction.ts` | Change concrete indexing, cell/frame assembly or reduction here; keep AST form recognition in language |
| Value comparison and CLI inputs | `interpreter/value-comparison.ts`, `cli-args.ts` | Keep concrete runtime rules separate from abstract facts |
| Execution and compiler dispatch | `interpreter.ts`, `statement-control.ts`, `execution.ts`, prepared-function and compiler modules | Keep `try`/`if` suspension and error precedence in statement control; preserve fallback timing and compiled/interpreted parity |
| Resources and host effects | `interpreter/resource-ownership.ts`, `resource-summary.ts`, `host-effects.ts` | Keep closing and host policy visible at the execution boundary |
| REPL | `common/live-preview.ts`, `repl-session.ts` | Pass explicit synthetic names; ordinary user names have ordinary block scope |

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
`execute` also accepts an optional set of synthetic names for isolated live
previews; ordinary execution passes none. This set is not inferred from spelling.

The executable boundary check is `npm run check:semantic-boundaries`. It rejects
language imports of the interpreter, runtime imports back into the facade and
cycles among the migrated semantic owners. Existing cycles outside these owners
are not silently claimed to be removed by this check.

The remaining large `prepareStatement`, `compileExpression` and value-analysis
dispatches stay in their current owner when extraction would expose the entire
interpreter or create a generic state container. Their feature-specific policies
(return contracts in #3, specialization in #4, bottom/widening in #5) must be
decided with a real consumer. In #24, a proposed trailing combiner would change
`modifier-grouping.ts` and `symbolicApplicationForm`; `binary-facts.ts` and the
runtime expression case already consume that form. The syntax choice and
migration policy in #24 are still open. In #26, intrinsic ranks start in
`operations.ts`, execute in `rank-application.ts`, and require an abstract
transfer in `application-facts.ts`. Non-scalar cell stacking depends on the
separate #23 contract, so this refactor does not choose it by accident.

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

## Integration result, 2026-09-28

The final `npm test` passed: language 461, interpreter 1,644, common 68, CLI 478
and compile 10 tests. `node packages/cli/bin/cli.js test demos` passed all 392
test files. Three pre-existing AoC demos used queue materialization or unpacked
a rank-2 combination; their source was corrected and their seven cases passed
before the full demo rerun. The earlier CLI nested-loop preview failure exposed
a missing synthetic-name origin for generated iteration flags and was fixed;
the clean full-suite run includes that case.

The final analysis corpus has 1,051 known results out of 1,087 example calls
and zero expectation conflicts. Isolated incomplete-source analysis times were
0.11 ms median / 0.22 ms p95 for the short source and 5.16 ms median /
6.47 ms p95 for the large source. The three 256-cell CoW demo medians were
15.19 ms (gradient), 6.73 ms (k-means) and 3.21 ms (Adam), with copy counts
0, 1 and 0 and copied-cell counts 0, 256 and 0. These are local samples, not
speed claims; CoW counters do not measure all allocations.
