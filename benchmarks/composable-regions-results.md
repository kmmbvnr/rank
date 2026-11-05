# Composition of private numeric regions

Implementation and integration verified against current main. The implementation
commit is `680bf539`; measurements below use the integrated source at
`3b388cd6a575f17f47d731bfd35e452d33f3bbf5` against main `954ad5b6c1fb7316c79c56ea390840dfbd831022`.
No demo sources are changed by this optimization.

## Verified results

Node 24.15.0, Apple M5 and Intel Core i7-10750H. Five fresh processes per
version and case, alternating order; medians in milliseconds, baseline / new.
Parsing is outside the timer. Each worker checks its answer against an
independent BigInt recurrence. A separate diagnostic run is excluded from timing
medians. Cold runs include compilation and execution.

| Case | Mac cold | Intel cold |
| --- | ---: | ---: |
| inline | 22.11 / 22.47 | 52.41 / 53.41 |
| helper | 29.39 / 21.39 | 70.04 / 52.10 |
| array-helper | 32.63 / 22.34 | 79.11 / 54.61 |
| mixed | 29.10 / 24.16 | 73.56 / 58.49 |
| combined | 29.76 / 23.30 | 75.43 / 56.47 |
| vector | 25.94 / 26.06 | 56.22 / 57.98 |
| vector-mixed | 31.79 / 28.07 | 62.98 / 55.04 |
| plans | 381.87 / 75.07 | 1322.48 / 191.79 |

Forty warmups precede the following measurements. Post-GC explicitly collects
before timing; steady execution does not. Both collect after timing for retained
memory observations. These modes measure different costs.

| Case | Mac post-GC | Intel post-GC | Mac steady | Intel steady |
| --- | ---: | ---: | ---: | ---: |
| inline | 12.48 / 12.31 | 19.56 / 19.44 | 2.00 / 2.00 | 6.68 / 6.65 |
| helper | 7.38 / 3.22 | 15.35 / 8.36 | 5.96 / 2.69 | 14.06 / 7.50 |
| array-helper | 10.08 / 3.06 | 22.27 / 8.49 | 9.72 / 2.79 | 20.28 / 7.32 |
| combined | 8.17 / 4.22 | 14.88 / 8.17 | 6.05 / 2.91 | 15.78 / 7.87 |
| vector-mixed | 5.17 / 3.06 | 14.01 / 9.52 | 3.60 / 1.97 | 9.25 / 5.59 |

The inline and vector rows are controls. In particular, the plain vector case
uses the existing tensor path in both versions; it is not evidence of new numeric
region admission. The combined case joins a scalar helper, sequential array
aliases and an exact accumulator in one mixed private region.

Peak process RSS for the cold plans/container/array case (MiB, baseline / new):

- mac: 320.4 / 185.1 (42.2% lower).
- intel: 294.0 / 167.3 (43.1% lower).

Peak RSS, retained heap and copied bytes are separate metrics. Compact integer
snapshots and fewer region entries reduce copying; this does not imply a uniform
process-memory reduction for every program.

## Validation and limits

- Integrated ordinary Mac suite: **12055 tests in 564 files pass**.
- Integrated Intel selection: **853 tests in 28 files pass**, including the
  current main changes for shared plan inputs and exact vector reductions.
- TypeScript build/test types, 11 semantic-boundary tests (65 owners), and both
  application-form checks pass.
- Exhaustive inferred-type, differential and Nurikabe audits were not run.
  They remain CI checks; this is not a claim that every possible Rank program
  has been benchmarked or that all fallback paths can be fused.
- Earlier ordinary failures were fixed: vector-search labels stay inside their
  outlined function; generated-call assertions recognize locally bound callees.
  The complete integrated ordinary run above includes those repairs.

Reference controls check exact answers separately. Their timing is broadly
unchanged; no reference-mode speed or memory improvement is claimed. Mac reference
combined peak RSS was bimodal in the pre-integration runs: roughly 438 and 600 MiB,
with the candidate hitting the higher mode more often. Retained array buffers
and tracked COW traffic were equal; retained heap varied around 31.7/35.1 MiB.
This process-level memory observation remains a limitation of the memory comparison,
not evidence of reduced reference allocation. Raw reference runs and the nine-sample
distribution check are retained alongside the compiled measurements.

Final raw files have the `integrated-{cold,hot,steady}` suffix. The manifest records
source and harness hashes. Earlier snapshots below are investigation history and
should not be mixed with the verified tables above.

## Reproduction

Build both checkouts, then run from this checkout:

```sh
node benchmarks/composable-regions.mjs --baseline=/path/to/main --samples=5
COMPOSABLE_WARMUPS=40 node benchmarks/composable-regions.mjs \
  --baseline=/path/to/main --cases=inline,combined,helper,array-helper,vector-mixed --samples=5
COMPOSABLE_WARMUPS=40 COMPOSABLE_PRE_GC=0 node benchmarks/composable-regions.mjs \
  --baseline=/path/to/main --cases=inline,combined,helper,array-helper,vector-mixed --samples=5
```

## Investigation history

### Changes and supported combinations

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

### Workloads and measurement

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

### Range-guarded snapshot measurements

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

### Reference controls

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

### Verification

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

### Reproduction

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

### Remaining vector composition regression

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

### Outlining investigation

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

Remaining work at that snapshot: identify the warm scalar-helper composition cost, verify
outlining on Intel and broader ordinary tests, and repeat final measurements on
the resulting source. No completion or universal speedup is claimed.

### Stable helper bindings investigation

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

### Compact snapshot investigation

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

### Traversal frame and preparation boundaries

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
change awaits benchmark refresh. The ordinary suite had not completed for that snapshot.

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


## Constructor-owned storage across helper chains (2026-11-05)

Compared with `dd5f656aa0cba6f6273239133dd89a93b430724b`. The same source
runs on both checkouts, including a two-helper chain, array swaps, a retained
input alias and a wide exact accumulator. Each invocation creates its own
scratch storage. Five fresh-process samples, two warmups, four rounds of 32,768
cells; Node 24.15.0 on Apple M5 and Intel i7-10750H. Every result is asserted.
Diagnostics run separately from timing. Tests and benchmarks do not overlap
on either host. All four changed production files have identical SHA-256 hashes
on both hosts.

| Case | Mac baseline → candidate, ms | Intel baseline → candidate, ms |
| --- | ---: | ---: |
| scratch-array | 2181.96 → 59.04 | 8242.02 → 175.17 |
| scratch-queue | 105.46 → 101.13 | 319.00 → 313.24 |
| scratch-index | 140.06 → 140.33 | 413.31 → 389.60 |
| scratch-set | 166.79 → 163.62 | 464.20 → 456.21 |

The array case improves about 37× on Mac and 47× on Intel. Its baseline cannot
link the scratch-array helper and does not enter a Number loop. The candidate
enters one mixed outer region. Constructor-only local writes no longer force
that helper back through ordinary invocation.

The collection cases already compile their inner traversal on the baseline;
they now compose into one mixed outer region instead of four separately entered
inner regions. Their timings are approximately unchanged, with small gains in
some cases. This change does not eliminate per-call container allocation or
make linked exact helpers into raw Number kernels.

For scratch-array, median peak RSS falls from 476.6 to 178.7 MiB on Mac and
449.2 to 163.3 MiB on Intel. Retained heap after GC falls by about 3.9 MiB on
both. Collection peak RSS changes by less than 2 MiB, and retained heap by less
than 0.5 MiB. Retained buffers are identical (424,771 bytes) in every measured
case; these measurements do not establish a general storage reduction.

Longer warmed controls use 24 rounds, 20 warmups and seven samples:

| Control | Mac baseline → candidate, ms | Intel baseline → candidate, ms |
| --- | ---: | ---: |
| helper | 3.02 → 3.05 | 7.41 → 7.12 |
| vector-mixed | 2.80 → 2.87 | 8.78 → 8.52 |

Validation: TypeScript build passes. The ordinary Mac run executed 12,169
tests: 12,168 passed and one expected Number-function count needed updating
because both calls in a linked bridge now compile. After that correction and
final guard changes, all 122 focused Mac tests pass. Intel passes 139 tests,
including compiled integer collections. Cases cover local arrays, queues,
indices and sets; mapping parameter writes into caller-owned storage; aliased
external writes; current borrowed array buffers; overflow replay; original
errors; live nested-helper replacement; and overridden queue methods.
The three excluded audits are types, differential and Nurikabe.

This is a bounded composition improvement. Captured observations, unknown
aliases, reference-returning private calls and lazy plans within these effect
summaries remain conservative. The reference engine is unchanged and provides
the semantic oracle in the tests; no reference-engine speedup is claimed.

Reproduce:

```sh
COMPOSABLE_ROUNDS=4 COMPOSABLE_WARMUPS=2 \
  node benchmarks/composable-regions.mjs --baseline=/path/to/baseline \
  --samples=5 --cases=scratch-array,scratch-queue,scratch-index,scratch-set,helper,vector-mixed
COMPOSABLE_ROUNDS=24 COMPOSABLE_WARMUPS=20 \
  node benchmarks/composable-regions.mjs --baseline=/path/to/baseline \
  --samples=7 --cases=helper,vector-mixed
```

Raw observations: [Mac](baselines/2026-11-05-helper-effects-mac-benchmark.json),
[Intel](baselines/2026-11-05-helper-effects-intel-benchmark.json),
[Mac controls](baselines/2026-11-05-helper-effects-mac-controls.json),
[Intel controls](baselines/2026-11-05-helper-effects-intel-controls.json).
[Manifest](baselines/2026-11-05-helper-effects-manifest.json) records source hashes.


### Unmodified Euler programs and exact call results

The synthetic gain above did not establish a gain on the Euler corpus. A
read-only scan of scalar helper proofs identified newly eligible functions in
26, 44, 303 and 330, among others. These four were measured at their full
default inputs, with 310 (no such helpers) as a control. The same unmodified
source was run on the baseline and candidate; source hashes and full expected
answers are checked. Three fresh-process samples, no warmup, a separate
instrumented run, Node 24.15.0, no concurrent tests on either machine.

This exposed a regression in the first implementation (`9607ead7`): Euler 303
went from 372 to 467 ms on Mac and 908 to 1,116 ms on Intel. Narrowing a wide
helper result caused the new outer Number region to replay an already completed
prefix: 14,992 Number-function calls instead of 9,997, despite the same answer.

The follow-up keeps a private scalar-only helper call exact when it feeds an
exact output. Local writes in the existing effect summary make these calls
prefer the existing mixed output tier, avoiding speculative replay of expensive
local-storage work. Array addresses and stores still require checked Numbers;
raw caller array buffers do not cross the exact Rank-value ABI. This uses the
existing wide-output/dataflow proof and live binding guards, without a special
case for Euler 303 or its source structure.

After the correction, Euler 303 again executes 9,997 Number calls and three
local function fallbacks, with one mixed outer loop. Final medians:

| Full default | Mac baseline → final, ms | Intel baseline → final, ms |
| --- | ---: | ---: |
| Euler 026 | 16.22 → 16.24 | 40.34 → 39.57 |
| Euler 044 | 93.07 → 93.76 | 197.40 → 198.72 |
| Euler 303 | 375.57 → 378.11 | 911.66 → 919.52 |
| Euler 330 | 39.89 → 39.19 | 97.79 → 95.05 |
| Euler 310 | 348.03 → 354.35 | 810.60 → 809.84 |

These five programs show no substantial speed or memory gain. Peak RSS differs
by at most about 1.3 MiB in this series. In 330 an additional Number loop is
selected, but the overall runtime remains close to the baseline. The result is
better composition coverage and restored performance, not a demonstrated
acceleration of existing Euler solutions. Three samples cannot establish a
small percentage speedup or regression.

Validation of the correction: build and 1,044 tests in 34 relevant Mac files
pass; 169 focused Intel tests pass. A regression test checks exact wide helper
results together with private array swaps and requires zero caller loop
replays. All five full Euler answers pass in every benchmark worker.

Reproduce with `node benchmarks/helper-effects-euler.mjs --baseline=/path/to/baseline`.
Raw [initial Mac](baselines/2026-11-05-helper-effects-euler-mac-initial.json),
[initial Intel](baselines/2026-11-05-helper-effects-euler-intel-initial.json),
[final Mac](baselines/2026-11-05-helper-effects-euler-mac-final.json),
[final Intel](baselines/2026-11-05-helper-effects-euler-intel-final.json).


### Helper equivalence: Euler audit of the unfinished implementation

This measures the uncommitted `perf/helper-equivalence` implementation against
`c996b5aa`. Its base is `88a57910`; the interpreter and language source trees
are unchanged between those two commits. This is a progress measurement,
not a completed composition improvement or a comparison against later main.
Source and fixture hashes are in the
[manifest](baselines/2026-11-05-helper-equivalence-euler-manifest.json).

All programs use their unchanged full default inputs. A proof scan newly
admitted helpers in 263, 326, 352 and 399. The previous five-program control
set is retained. Full 054 is added because the ordinary tests exposed a
captured-helper compilation regression, corrected before this final series.
The proof scan uses default scalar parameter types; it is not an exhaustive
inventory of all array-typed specializations in the Euler corpus.

Node 24.15.0 on both machines. Five cold samples per version, separate fresh
processes, alternating version order, followed by one separate diagnostic
sample. Parsing is outside the timer; execution includes first compilation.
No test suite runs concurrently with the benchmark on the same host.
Every worker asserts the full answer. Peak RSS is whole-process high-water
usage; retained heap and buffers are sampled after GC.

The table reports the median of the five paired candidate/baseline time
ratios. Positive means slower. These are observations, not statistical
confidence bounds or evidence that a small percentage change is repeatable.

| Full default | Mac time change | Intel time change |
| --- | ---: | ---: |
| Euler 026 | +0.5% | +3.3% |
| Euler 044 | +0.1% | -1.7% |
| Euler 054 | +0.7% | -4.4% |
| Euler 263 | +1.0% | +1.0% |
| Euler 303 | +2.3% | +0.2% |
| Euler 310 | +0.5% | -0.7% |
| Euler 326 | -0.9% | +1.8% |
| Euler 330 | -0.5% | -0.5% |
| Euler 352 | +2.7% | +3.8% |
| Euler 399 | +0.9% | -1.7% |

No broad Euler speedup or material memory saving is established. In particular,
352 selects one additional Number loop but has slightly higher cold runtime.
Peak RSS differences in the nine-program final series range from -3.8 to
+5.1 MiB on Mac and -2.6 to +0.8 MiB on Intel, without a consistent reduction.

Mac 263 is especially noisy: the final baseline spans 2.59–3.56 seconds and
candidate 2.54–3.65 seconds. Taking independent medians suggests a 22% gain,
while the median paired change is +1%. Earlier series even suggested a loss.
Neither a speedup nor a regression should be claimed from these measurements.

The 303 replay regression remains fixed: both versions execute 9,997 Number
functions, three function fallbacks, and zero caller-loop overflows. The one
loop overflow in 326 is present in both versions. In 352 both execute 50
Number functions; the new outer Number loop alone is not a performance win.

Initial repeated Intel cold measurements showed about 2 ms additional cost
for 026 and 4 ms for 330. Ten warmups and seven measured samples reduced those
differences to essentially zero (026: 25.25 → 24.86 ms; 330: 27.52 → 27.60 ms).
These initial warm results precede the last captured-helper and integer-alias
repairs; final warm controls are recorded separately below.

Validation: build passes. The ordinary Mac suite excluding types,
differential and Nurikabe executed 12,188 tests: 12,185 passed and three
failed. Two failures exposed the captured-helper eligibility regression;
restoring the pre-existing capture-safe path fixes both. The remaining check
expected no fresh compiled loop after helper replacement; the new binding is
correctly rejected, then a new region compiles against the replacement.
Its assertion now checks the binding rejection and correct outputs. All 168
tests in the five affected files pass after these corrections. The full
ordinary suite was not repeated after the corrections. The same 168 focused
tests also pass on Intel after the final benchmark series.

Composition acceptance remains incomplete: for large private arrays, work
inside a consumed-plan helper is not included in copy-amortization feedback.
The tiny inline/helper/alias/chain matrix passes, but that does not establish
equivalent execution cost or class at realistic sizes. No SSA rewrite is
needed to address this remaining cost-accounting boundary.

Reproduce:

```sh
node benchmarks/helper-equivalence-euler.mjs --baseline=/path/to/baseline --samples=5
node benchmarks/helper-equivalence-euler.mjs --baseline=/path/to/baseline --samples=7 --warmups=10 --cases=026,330,352
```

Raw final observations: [Mac](baselines/2026-11-05-helper-equivalence-euler-mac-final.json),
[Intel](baselines/2026-11-05-helper-equivalence-euler-intel-final.json),
[Mac 054](baselines/2026-11-05-helper-equivalence-euler-mac-poker.json),
[Intel 054](baselines/2026-11-05-helper-equivalence-euler-intel-poker.json).
Initial series and repeated controls use the same `helper-equivalence-euler`
filename prefix in `baselines/`.

Final warm controls (10 warmups, seven samples, median milliseconds):

| Full default | Mac baseline → candidate | Intel baseline → candidate |
| --- | ---: | ---: |
| Euler 026 | 9.89 → 9.84 | 25.19 → 25.47 |
| Euler 330 | 10.29 → 10.19 | 26.31 → 26.66 |
| Euler 352 | 20.53 → 20.82 | 47.46 → 46.59 |

Raw warm controls: [Mac](baselines/2026-11-05-helper-equivalence-euler-mac-warm-final.json), [Intel](baselines/2026-11-05-helper-equivalence-euler-intel-warm-final.json).


### Measured helper work across call boundaries (in progress)

The next change shares an invocation-scoped work counter through measured
callee bindings, including ordinary helper chains and ranked callbacks.
Generated exact kernels accept the counting checkpoint at binding time;
Number kernels reuse their existing checkpoint parameter. Ordinary cached
bindings do not retain counters, and runtime binding guards remain mandatory.
Both Number copy probes and exact fallback samples include completed nested
work. The existing large-copy cap remains conservative.

The new repeated-entry matrix uses 1,024-cell arrays and checks inline,
loop-helper, plan-helper and alias-chain forms. All retain the outer Number
loop after feedback. A helper that reads only its first cell, or returns from
its first iteration, does not earn a full-pass budget. Build and 178 tests in
seven relevant files pass.

This fixes measured admission, not yet the complete execution-cost criterion.
`node benchmarks/helper-equivalence.mjs` exposes the remaining difference:
with 4,096-cell arrays and 50 passes, a local exploratory warmed run gave
inline 0.46 ms, loop helper 0.75 ms, plan helper 4.78 ms, plan alias chain
12.67 ms. Every form returns 301144, selects one Number loop and has zero
caller overflows. The plan variants still use the exact borrowed-array ABI,
so their internal per-cell BigInt work remains. These exploratory numbers
are not a cross-architecture performance claim.

The Euler tables above precede this work-counter change; their manifest
identifies that earlier measured snapshot. Euler must be rerun after the
remaining execution changes, before delivery.

### Shared Number lowering for consumed integer plans (in progress)

Consumed integer plans now use the existing function-plan/tensor emitter with
Number inputs and checked reductions. Scalar operations reuse the Number
function arithmetic emitter. The initial supported domain includes integer
arithmetic, broadcasting, outer operations and row reductions; unsupported
native/conversion/callback/power stages retain the exact path. A plan's
observable consumer hooks retain the exact captured-binding ABI.

This removes per-cell BigInt conversion from the plan and alias-chain cases
above. Repeated local synthetic measurements (10 warmups, seven samples,
median milliseconds; diagnostic sample separate):

| Form | Mac | Intel |
| --- | ---: | ---: |
| Inline | 0.476 | 1.286 |
| Loop helper | 0.865 | 1.718 |
| Plan helper | 0.899 | 1.743 |
| Plan alias chain | 0.944 | 1.657 |

Every form returns 301144, retains one Number loop, performs no caller replay,
and reports exactly 32,768 snapshot bytes. All report zero exact-ABI borrowed
views. This is equivalent numeric execution/storage class, not identical
wall time: helpers still carry per-cell checks and polling overhead.
The earlier exploratory plan and chain times were 4.78 and 12.67 ms on Mac.

Build and 235 focused tests in eight files pass on both Mac and Intel.
New boundary tests compare Number execution, exact fallback and reference
results for overflow, signed division/remainder, broadcasting, outer/row
reductions, empty input, local COW aliases and located errors. Consumer
arithmetic errors and construction-time shape errors retain distinct locations;
scalar deferred-value errors retain their existing construction locations.

Raw [Mac](baselines/2026-11-05-helper-equivalence-number-plan-mac.jsonl),
[Intel](baselines/2026-11-05-helper-equivalence-number-plan-intel.jsonl),
[manifest](baselines/2026-11-05-helper-equivalence-number-plan-manifest.json).

Still pending: direct deferred scalar returns versus forced scalar locals,
copy admission above the existing speculative cap, broader ordinary tests and
updated full Euler measurements before integration and delivery. The previous
Euler tables do not measure this latest implementation.

### Integrated helper-equivalence delivery

The delivery snapshot is compared with `bff39e70` (current main at integration),
not the older `c996b5aa` used by the progress tables above. The source identity
and test counts are in
[the delivery manifest](baselines/2026-11-05-helper-equivalence-delivery-manifest.json).

The implementation now carries storage origins through aliases and helper
returns, composes effects from existing scalar proofs, and counts nested helper
work when measuring private-copy amortization. Integer consumed plans share
the existing tensor emitter in the Number backend. Direct deferred scalar
returns and forwarding chains enter that backend only at a proven immediate
consumer; an unused returned plan remains lazy. Live implementation guards,
observable consumers, exact overflow replay and error locations remain checked.

The tested forms are inline, loop helper, consumed-plan helper, alias chain,
direct plan return and forwarded plan return. This establishes the same numeric
execution/storage class for this supported domain, not equal elapsed time for
all source programs. Unsupported native/map/conversion/power plan stages still
use exact lowering. The existing 262,144-cell speculative-copy cap is unchanged:
above it, inline and equivalent helpers all decline the same private snapshot.
Extending that cap requires a separate cost/admission design, since some
permutation regions have no publishing exact backend from which to learn.

Validation: 573 ordinary files / 12,222 tests passed on Mac before merging
main (types, differential and Nurikabe audits excluded). After merging main,
13 affected files / 341 tests passed on both Mac and Intel. Both builds pass.

Five cold samples per version, alternating order in fresh processes; parsing
is excluded. Every full unchanged program answer is asserted. Diagnostics use
a separate run. Values below are medians of paired runtime changes; positive
means slower. Small differences are not confidence bounds.

| Euler | Mac | Intel |
| --- | ---: | ---: |
| 026 | +2.6% | +3.7% |
| 044 | -0.4% | -1.2% |
| 054 | -0.4% | -1.1% |
| 263 | +0.5% | -0.6% |
| 303 | -0.8% | -1.4% |
| 310 | +0.7% | +0.6% |
| 326 | +0.0% | +0.9% |
| 330 | -0.4% | +0.8% |
| 352 | +1.9% | +3.2% |
| 399 | +0.2% | +0.9% |

No broad Euler speedup or material memory reduction is established. Peak RSS
median differences range from -1.0 to +1.4 MiB on Mac and -2.5 to +2.7 MiB
on Intel. Both versions retain zero caller overflows in 303 and one in 326.
The extra Number loop in 352 is not itself evidence of acceleration.

Raw cold observations: [Mac](baselines/2026-11-05-helper-equivalence-delivery-euler-mac.json),
[Intel](baselines/2026-11-05-helper-equivalence-delivery-euler-intel.json).

Synthetic matrix (4,096-cell arrays, 50 passes, 10 warmups, seven samples;
median milliseconds):

| Form | Mac | Intel |
| --- | ---: | ---: |
| inline | 0.456 | 1.334 |
| loop | 0.750 | 1.664 |
| plan | 0.794 | 1.689 |
| chain | 0.883 | 1.795 |
| return | 0.852 | 1.653 |
| forward | 0.845 | 1.770 |

All six forms retain one Number loop, zero replay, zero exact borrowed-array
views and 32,768 snapshot bytes. Helpers still have checking/polling overhead.
Raw matrix: [Mac](baselines/2026-11-05-helper-equivalence-delivery-mac.jsonl),
[Intel](baselines/2026-11-05-helper-equivalence-delivery-intel.jsonl).

Warm controls (10 warmups, seven samples; median milliseconds):

| Euler | Mac baseline → candidate | Intel baseline → candidate |
| --- | ---: | ---: |
| 026 | 9.93 → 9.95 | 25.02 → 25.30 |
| 330 | 8.88 → 8.88 | 26.45 → 26.86 |
| 352 | 20.52 → 20.67 | 47.78 → 47.78 |

Raw warm observations: [Mac](baselines/2026-11-05-helper-equivalence-delivery-warm-mac.json),
[Intel](baselines/2026-11-05-helper-equivalence-delivery-warm-intel.json).
