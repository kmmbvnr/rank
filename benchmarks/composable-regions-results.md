# Composition of private numeric regions

Status: implementation in progress. The main tables identify the older
range-guarded snapshot. Later investigations below cover cold, post-GC and
steady execution. Latest source validation and benchmark refresh are pending.

Baseline: `19ab2fe93429d33609291630ebb4f34887ff75d2`.
Worktree branch: `perf/composable-regions`. No demo sources change.

## Changes and supported combinations

Private-state summaries now compose through scalar helper chains and read-only
rank-one integer array arguments. Current helper and native identities remain
checked at entry. A callback-free native signature is required; captured reads,
container effects and unknown operations do not inherit safety from a scalar
result type. Raw private buffers only enter the compatible Number call ABI.

Private array permutations and ordinary aliases can coexist with these helpers,
exact scalar outputs, and vector stages. The vector pool reads current register
owners before reusing storage; it also sees aliases created before the first
vector stage. All scalar registers, array bindings and cell stores keep the
existing transaction, error-publication and exact-replay boundaries.

Direct indexed stores in a range loop can detach once when the body cannot
rebind their target or create aliases. The evaluated range bounds guard this
preparation, including negative strides and inclusive/exclusive endpoints.
Empty ranges do not copy. Other stores retain the ownership check at each write.
No last-use analysis or removal of still-live aliases is claimed.

Finite named plans can coexist with independent local array writes and container
operations in compiled functions. Protected plan sources cannot be written.
Unused recipes stay lazy; separate consumers remain separate demands.

A source proof can select the exact-output mixed tier before trying all-Number
execution. It combines additive intervals across branches and statically counted
loops, and requires growth beyond the full safe-integer input interval. Unknown
counts, resets, cancelling growth and escaping control keep the previous order.
Observable demand budgets also keep the previous order. This avoids a guaranteed
failed attempt without relying on an observed array value or a previous run.

## Workloads and measurement

`benchmarks/composable-regions.mjs` runs identical programs on both revisions.
The array workloads use 32,768 cells and 24 passes; an independent BigInt
recurrence checks the final sum, exact output and retained outside alias.

| Case | Operations combined |
| --- | --- |
| inline | Scalar cell arithmetic and parallel buffer permutation; existing fast-path control |
| helper | Scalar helper call and parallel permutation |
| array-helper | Read-only array helper and parallel permutation |
| mixed | Cell arithmetic, parallel permutation and exact scalar output |
| combined | Scalar helper, sequential alias-based permutation and exact output |
| vector | Whole-vector arithmetic and sequential alias-based permutation |
| plans | Named factor/unique recipe, repeated consumers, local array and set; 5,000 calls |

Node v24.15.0, Apple M5 and Intel i7-10750H. Compiled series use five fresh
processes per revision and case, alternating version order. Reference controls
use three samples. Parsing and startup are excluded from elapsed execution;
preparation and initial compilation are included. Tests finish before each
host's timing series. Other machine load is not controlled.

Each series has a separate diagnostics-on observation, excluded from timing
medians. RSS is the whole-process peak, including parsing and startup. Retained
heap and ArrayBuffers are measured after GC with the interpreter reachable.
Copy counters measure cumulative payload, not retained memory. None of these
measurements is interchangeable with the others.

## Range-guarded snapshot measurements

| Host | Case | Baseline ms | Candidate ms | Speedup | Peak RSS MiB, before → after |
| --- | --- | ---: | ---: | ---: | ---: |
| mac | inline | 25.38 | 25.64 | 0.99× | 161.2 → 160.3 |
| mac | helper | 34.26 | 31.16 | 1.10× | 164.2 → 159.6 |
| mac | array-helper | 33.39 | 30.75 | 1.09× | 161.7 → 159.4 |
| mac | mixed | 28.83 | 23.58 | 1.22× | 166.2 → 162.3 |
| mac | combined | 30.28 | 31.18 | 0.97× | 162.9 → 160.2 |
| mac | vector | 22.70 | 23.20 | 0.98× | 162.2 → 162.0 |
| mac | plans | 291.44 | 58.23 | 5.01× | 312.2 → 186.8 |
| intel | inline | 47.59 | 48.10 | 0.99× | 146.3 → 131.0 |
| intel | helper | 66.41 | 57.78 | 1.15× | 148.3 → 131.4 |
| intel | array-helper | 70.34 | 65.54 | 1.07× | 147.3 → 143.9 |
| intel | mixed | 67.56 | 51.67 | 1.31× | 152.6 → 147.7 |
| intel | combined | 70.74 | 66.86 | 1.06× | 148.2 → 145.6 |
| intel | vector | 46.38 | 45.49 | 1.02× | 147.8 → 148.1 |
| intel | plans | 1137.04 | 176.15 | 6.45× | 286.5 → 168.3 |

The plan/container case improves on both hosts. Array helpers and mixed outputs
also improve in this series. The combined case remains near the baseline;
admitting its outer region does not imply that its cell loop gets faster.
The small inline/vector controls and cold preparation costs vary by a few
percent. These results do not establish a universal speedup or memory reduction.

Checks for the range-guarded snapshot: 579 tests in 15 focused files pass on each host. The TypeScript
source/test build, 11 semantic-boundary tests (65 owners), both application-form
checks, and whitespace checks pass. Exhaustive audits were not run.

Runtime source SHA-256 (sorted repository-relative `.ts` paths under
`packages/interpreter/src`, each followed by NUL and contents):

- Baseline: `e1cf750b79d41442f2d41ea34cddbb66ecaec4bae5f4ea278dedb78cda0c65af`.
- Candidate on both hosts: `db9c6369162e1860a5eec901bfbad6df0f91c3e156525958db1db9e82745c27f`.

Raw compiled series: [Mac](baselines/2026-11-04-composable-regions-mac-final.json),
[Intel](baselines/2026-11-04-composable-regions-intel-final.json).
[Manifest](baselines/2026-11-04-composable-regions-manifest.json) records hashes and verification scope.

## Reference controls

| Host | Case | Baseline ms | Candidate ms |
| --- | --- | ---: | ---: |
| mac | inline | 580.70 | 582.47 |
| mac | combined | 1881.49 | 1896.08 |
| mac | plans | 235.73 | 235.82 |
| intel | inline | 1623.62 | 1638.27 |
| intel | combined | 6459.80 | 6402.28 |
| intel | plans | 926.27 | 960.73 |

No reference speedup is claimed. Raw controls:
[Mac](baselines/2026-11-04-composable-regions-mac-reference.json),
[Intel](baselines/2026-11-04-composable-regions-intel-reference.json).

## Verification

The ordinary interpreter selection excluded `types.test.ts`,
`differential.test.ts` and `nurikabe.test.ts`, with four audit-config workers.
It ran 11,971 tests: 11,970 passed and one expected-overflow counter failed.
The new growth proof had correctly bypassed that overflow. The replay test now
uses an input trip count, retaining actual overflow and rollback coverage;
separate growth tests cover constant counts. This broad run preceded the final
range-guarded ownership preparation. Final focused results are recorded below.

Tests cover scalar and array helpers, transitive effects and warmed helper
replacement, aliases preceding the first vector, exact replay after partial
writes and moves, helper errors before and after moves, custom polling and
bounded demand. Plan tests cover repeated and unused recipes, independent
writes and protected sources. Ownership tests cover empty and nonempty forward
and reverse ranges. Growth tests cover positive/negative updates, branches,
nesting, resets, cancellation of growth and unknown trip counts.

The reference interpreter remains a control. No reference dispatch or frame
optimization is part of this change. Captured observers, escaping array results,
unsupported representations, shared slice stores and escaping control retain
their existing fallbacks. The change does not promise identical demand-budget
units between engines or a speedup for every admitted program.

## Reproduction

Build baseline and candidate with their locked dependencies, generated language
and `tsc -b tsconfig.build.json`. From the candidate:

```sh
node benchmarks/composable-regions.mjs \
  --baseline=/path/to/baseline --samples=5
node benchmarks/composable-regions.mjs \
  --baseline=/path/to/baseline --cases=inline,combined,plans \
  --engines=reference --samples=3
```

Early exploratory reports retain the initial regression, per-store variant and
unconditional ownership-hoisting experiment. They are not final measurements.
The per-store confirmation reproduced a Mac regression in `combined`
(31.25 → 34.11 ms, nine samples). Range-guarded preparation removed it in the
next confirmation (29.15 → 28.35 ms); the inline control was 21.08 → 21.44 ms.
These are comparisons within each series, not absolute comparisons across
machine-load conditions.

## Remaining vector composition regression

The `vector` control above uses the existing tensor path in both revisions;
it does not enter a numeric outer region. The additional `vector-mixed` case
combines whole-vector arithmetic, an indexed helper call, sequential aliases
and a wide output. An independent recurrence checks its modified first cell.

| Host | Baseline ms | Candidate ms |
| --- | ---: | ---: |
| mac | 22.84 | 27.97 |
| intel | 56.39 | 56.41 |

The candidate enters one mixed region; the baseline retains the tensor path.
Mac diagnostics record about 8.6 ms of initial loop preparation and 9.9 ms of
execution, plus lazy mixed preparation. Avoiding unused Number code generation
alone did not remove the cold regression (26.01 → 31.54 ms in a later series).
That latest refinement passes 250 focused tests; it is not the snapshot used
in the main tables. Backend preparation and vector execution costs still need
to be separated before selecting the final implementation.

## Outlining investigation

Additional controls execute the same parsed program repeatedly, checking every
warmup result. `COMPOSABLE_WARMUPS` selects warmups and `COMPOSABLE_ROUNDS`
selects recurrence passes (defaults 0 and 24). These controls exposed a warm
`combined` regression that cold timings concealed: after 40 warmups, baseline
5.87 ms versus candidate 10.39 ms. A 256-pass cold vector case improved from
59.04 to 39.12 ms, so cold preparation and steady execution need separate checks.

V8 traces showed repeated `exit from OSR'd inner loop` deoptimizations. Outlining
vector traversals into immediately invoked functions preserves lexical state
and lets the host JIT optimize each traversal separately. The vector composition
improved from 24.07 to 21.29 ms cold and 4.97 to 3.00 ms after 40 warmups on Mac.
The vector/ownership/polling selection passed 147 tests.

Outlining control-free nested scalar loops also improved cold combined execution
(29.96 to 25.23 ms), and the inline control stayed near 21.26 ms. However warm
combined execution still regressed (5.99 to 10.11 ms), while warm inline improved
(7.98 to 6.52 ms). The seven-file selection passed 449 tests. Escaping control
remains in its original function; lexical register updates and errors remain in
the parent transaction.

Two further experiments were rejected: scope-local bounds checks made the warm
case slower, and copying registers through outlined-function parameters/finally
callbacks did not remove the regression. Their measurements are retained, but
those source changes were reverted. Four added tests still check bounds and
partial error state when arrays are resized inside or outside an inner traversal.

Current remaining work: identify the warm scalar-helper composition cost, verify
outlining on Intel and broader ordinary tests, and repeat final measurements on
the resulting source. No completion or universal speedup is claimed.

## Stable helper bindings investigation

The persistent traversal version still regressed on warm scalar compositions.
A CPU profile of 300 warmups placed about 788 ms in `traversal0`, 34 ms in GC,
and 31 ms in private-array detachment. Repeated compiler configuration getters
were no longer a dominant cost after capturing the immutable hook object.

The numeric region boundary now retains its non-diagnostic leaf wrapper for the
lifetime of the prepared helper. Entry still checks depth, inspection, polling,
budgets, hooks and storage capabilities. Diagnostic wrappers remain scoped to
the current observation. This avoids replacing the host-JIT call target on every
entry without retaining a previous diagnostic collector. A regression test
alternates ordinary execution and two independent collectors on the same AST.
The four-file selection passes 272 tests.

Mac, 40 warmups, five fresh-process measurements per version, medians in ms:

| Case | Baseline | Stable wrapper | Baseline (next series) | Bound local call |
| --- | ---: | ---: | ---: | ---: |
| combined | 6.05 | 6.94 | 7.73 | 8.22 |
| helper | 6.00 | 6.42 | 7.24 | 7.35 |
| array-helper | 9.34 | 6.21 | 11.48 | 7.80 |
| inline | 8.42 | 5.92 | 10.07 | 7.64 |

The second experiment also loads each guarded callable into a local at region
entry, carrying it into outlined traversals. Overall host timings changed across
series, so compare each candidate only with its paired baseline. The remaining
combined regression is not resolved. These are investigative Mac observations,
not final cross-platform results. Raw reports have suffixes `stable-call-hot`
and `bound-call-hot`; neither is the older range-guarded snapshot in the tables.

## Compact snapshot investigation

Unboxing integer storage now starts with Int32 cells and widens at the first
out-of-range safe integer. This preserves compact storage across private array
permutations, rather than committing every nonpacked input to Float64. Existing
checked stores still widen when necessary. Five focused files pass 364 tests,
including late input widening and exact replay beyond the safe Number range.
The two-detachment fixture now copies 32 bytes instead of 64.

Five paired observations, medians in ms; hot runs have 40 warmups:

| Case | Mac cold base/new | Mac hot base/new | Intel hot base/new |
| --- | ---: | ---: | ---: |
| combined | 32.19 / 25.41 | 7.07 / 7.82 | 14.52 / 15.21 |
| helper | 31.81 / 23.59 | 7.41 / 6.47 | 14.49 / 13.77 |
| array-helper | 35.48 / 24.06 | 11.14 / 7.13 | 20.07 / 13.42 |
| inline | 24.04 / 21.84 | 10.17 / 7.10 | 18.14 / 12.96 |
| vector-mixed | 26.44 / 24.11 | 5.38 / 3.12 | 12.95 / 8.58 |

Raw reports end in `compact-cold` and `compact-hot`. Warm combined remains
slower on both hosts (about 11% Mac, 5% Intel); this is not a completed result.
The Intel candidate was synchronized from the same source and built output as
the Mac candidate. Broader final verification remains outstanding.

## Traversal frame and preparation boundaries

`COMPOSABLE_PRE_GC=0` adds a steady-execution control without the full GC between
warmup and timing. The default remains `1`; both modes still collect after timing
for retained-memory observations. Forty warmups followed by full GC measure
recovery as well as warm execution, and are not interchangeable with steady runs.

V8's deoptimization trace marked the persistent traversal as invalid after GC
(`embedded weak objects cleared`). Retaining the function identity alone was not
sufficient. Passing state as indexed slots instead of a shaped object reduced
post-GC times for helper, array-helper and inline traversals, but combined still
regressed. Moving range evaluation and ownership preparation before the outlined
traversal then removed that regression on both hosts. Input bounds and prepared
address guards cross the explicit frame boundary; errors still return partial
private state before ordered publication. No frame or user buffer is retained
between invocations.

Five paired observations, 40 warmups, medians in ms for the split-setup snapshot:

| Case | Mac post-GC base/new | Intel post-GC base/new | Mac steady base/new | Intel steady base/new |
| --- | ---: | ---: | ---: | ---: |
| combined | 6.23 / 3.28 | 12.70 / 7.36 | 6.19 / 2.93 | 14.09 / 6.83 |
| helper | 6.83 / 3.28 | 12.69 / 7.13 | 5.97 / 2.70 | 12.50 / 6.71 |
| array-helper | 9.77 / 3.29 | 18.63 / 7.10 | 9.17 / 2.67 | 18.28 / 6.51 |
| inline | 8.21 / 3.23 | 17.13 / 8.99 | 1.94 / 2.88 | 5.78 / 8.21 |
| vector-mixed | 6.00 / 3.56 | 12.37 / 8.77 | 3.54 / 1.93 | 8.82 / 5.34 |

The inline control exposed a steady-execution regression from outlining ordinary
arithmetic. Outlining now applies only when a nested traversal composes helper
calls or ownership preparation. Pure arithmetic retains its previous body.
Mac selective measurements: inline 8.54/8.56 ms post-GC and 2.13/2.25 ms steady;
combined 6.67/3.44 and 6.55/3.28 ms, respectively. The final refinement keeps
store-mode constants local when no traversal needs to share them. This latter
change awaits benchmark refresh. The ordinary suite is running on that source.

Selective outlining also preserves Intel's inline control: 17.50/17.55 ms
post-GC and 5.70/5.74 ms steady. Combined takes 13.60/7.59 and 12.58/6.79 ms,
respectively. All five selective combinations improve or preserve speed there.

Expanded validation caught a vector-search code-generation regression: a labelled
`break` had crossed the newly introduced function boundary. Search exit labels
now belong to their outlined traversal. The existing selection tests verify both
results and actual Number entry/replay. All 765 tests in the 23-file Intel
selection pass after the fix; 176 focused Mac tests and the full Euler 310 case
also pass. The ongoing ordinary Mac run had already executed Euler 310 before
that fix and reported its missing Number region; its targeted rerun passes.
