# Euler 303: multiples with small digits

## Delivered implementation

The default limit remains 10000, the answer remains **1111981904675169**, and
`smallest` retains its exact-integer result. Production retains native `queue`.
The BFS now stops before expanding another remainder once Parent[0] is assigned.
Its parent chain is already the shortest lexicographically smallest zero path.

The compiler now lowers eligible helpers directly to checked Number execution:
scalar arguments/result, fresh one-dimensional integer arrays and append-only
integer queues, no object arguments, aliases, escaping storage, captured values,
Rank calls or deferred stages. Native queue methods and module bindings remain
guarded. Opaque polling/debug observation and disabled Number mode retain the
original path. Supported private state is numeric JS storage, not published
Rank locals; it needs neither a persistent pool nor a global compiler-option
change. Private storage becomes collectible when each invocation finishes.

Every integer operation/store/result remains checked. Unsafe arithmetic,
indices or dimensions discard private changes and replay the exact helper;
negative reads retain the canonical selector through that fallback. Queue
length/index limits are the private JS representation's bounds, not new Rank
limits. Wide N=9999 still returns **11112222222222222222** exactly.

Related correctness repairs made while admitting the general backend:

* Build the default integer proof's Number variant regardless of which caller
  first populates the proof-keyed kernel cache.
* Keep negative `till` endpoints exclusive; use signed Rank compound mod and
  floor division, including their zero-divisor checks.
* Keep a range iterator's cursor independent of assignments to its block-local
  iteration variable.
* Remove an extra array ownership hold in exact helper iteration. Traversal
  captures its receiver once and follows existing ownership semantics; it is
  not an additional `=` binding. Private source-cell writes remain live, while
  explicit ordinary aliases still retain their CoW boundaries. Tests cover both.

No Number/copy admission constants changed. General escaping arrays, shared
containers, other container operations and unsupported layouts retain their
existing execution paths.

### Final measurements

Apple M5 / Node v24.15.0, serial fresh processes. Baseline is the original
47cdf712 runtime. An isolated baseline restores the three changed runtime
modules; all other modules are identical. Primary table: last matched series,
three samples per compiled case, rotating case order, after final correctness
repairs. Wall time includes parsing/execution; imports/startup are excluded.
CPU time is user+system process CPU, including runtime worker threads.

| Full compiled case | Wall median | CPU median | Median peak RSS |
| --- | ---: | ---: | ---: |
| original source / old compiler | 13.030 s | 13.346 s | 422.0 MiB |
| new source / old compiler | 7.811 s | 8.268 s | 474.8 MiB |
| new source / final compiler | **0.579 s** | **0.749 s** | **177.9 MiB** |

That series shows about 22x less wall time / 18x less CPU against the original
program and about 58% less peak RSS. The same-new-source comparison isolates
the compiler change (7.811 -> 0.579 s). No global compilation feature is disabled.
The research prototype's 704 MiB peak falls to about 178 MiB with the direct
private-state implementation.

**Timing limitation:** external host load was substantial. In this last series,
original wall times were 10.399–13.791 s and final 0.556–1.018 s. An earlier
final-code series measured 1.298 s (0.938–1.887 s); its baseline original was
9.485 s (9.017–10.211 s). These phases are all preserved. The additional matched
CPU series was collected to assess the scheduling variation; do not generalize
an exact speed ratio to other hosts. An earlier compiled `after` candidate series
predates final cursor/live-iteration repairs and is not the final performance claim.

Full reference, one sample on each side:

| Source | Time | Peak RSS |
| --- | ---: | ---: |
| original | 143.170 s | 447.3 MiB |
| production | 104.915 s | 462.5 MiB |

Reference still exceeds corpus execution budgets; no reference memory saving
is claimed. Its code path is unchanged by the final Number-only cursor repair,
so the stored `after` reference controls remain applicable. The reference
exclusion is retained with an updated reason, and a dedicated full compiled
regression checks the answer plus Number function execution and exact fallback.

Final full diagnostics: **10000 Number function entries, 3 checked fallbacks**.
The function still returns a Rank integer; its caller is not declared
unconditionally Number-safe. The fallbacks include wide reconstruction and
protect temporary arithmetic even when the eventual result is small enough.

### Verification

* **451 ordinary interpreter files / 10338 tests pass**, excluding exhaustive
  types/differential/Nurikabe audits as required.
* TypeScript project build and semantic-boundary checks pass.
* 22 new private-state tests cover queue liveness/ordinals, standalone/linked
  cache preparation, wide stores/results, canonical errors, empty/invalid shapes,
  signed compounds, range mutation, live array iteration and explicit aliases,
  escaping/external state, prototype overrides and opaque polling.
* Scoped fixture type/differential audits pass; scoped name-facts check passes.
* **2022 independent checks** include direct numerical candidate enumeration
  for all divisors 1..200, five helper variants in both engines, the wide 9999
  result, and published reduced sums. Full timed runs assert the full answer.
* The fixture retains existing assertions and adds the wide result. The main
  retains its original limit and has a full compiled regression.

Delivery artifacts: `euler303-delivery.json` preserves baseline/candidate/final
phases and full reference controls; `euler303-cpu-samples.json` is the last matched
series used above; delivery diagnostics omit zero/empty counters. The earlier
investigation and raw experiments below remain historical evidence.

Reproduction after building:

```
node benchmarks/experiments/euler303-build-baseline.mjs
node benchmarks/experiments/euler303-delivery-samples.mjs
node benchmarks/experiments/euler303-cpu-samples.mjs
DIAGNOSTICS=1 node benchmarks/euler303-investigation.mjs compiled 10000 production
node benchmarks/experiments/euler303-verify.mjs
```

The delivery sampler resumes existing JSON; move it aside for a new complete
series. For historical experiments, set RANK_BENCH_RUNTIME to the old runtime.

## Initial investigation at 47cdf712 (before implementation)

The following describes the original source/runtime and archived prototypes.
The delivered implementation above supersedes its compiler proposal.

## Finding

The BFS algorithm is appropriate: at most N decimal remainders, with three
outgoing digit edges each. The search retains the first shortest/lexicographically
smallest path to every remainder and reconstructs the minimum positive multiple.
For all divisors through 10000, the upper work bound is O(sum N), not an
exponential enumeration of candidate integers. Replacing BFS is not the priority.

Two worthwhile opportunities are demonstrated:

1. Stop before expanding the next queued remainder as soon as remainder zero
   has been discovered, rather than waiting for zero to be dequeued. The current
   three-digit expansion may finish, but there is no need to expand the rest of
   that frontier. Both BFS order and the zero parent chain are unchanged.
2. Improve backend selection/coverage for helpers with fresh integer buffers
   and queues. The existing Number function-prefix backend can do the narrow
   BFS efficiently, but the normal linked helper route selects exact scalar
   function code instead.

## Current compilation

The unchanged program already compiles `smallest` as a whole exact function.
At limit 100 diagnostics record 100 compiled scalar function entries and one
compiled outer loop, with no Number loops. It is not a failure to compile the
function. `compileScalarNumberKernel` declines containers and array writes;
`FastPaths.scalarCall` links the exact helper. This matters because the hot
remainder transitions, indices, parent links and digits all have small values.

Full original answer is **1111981904675169**. An initial compiled pass took
8.852 s; the later repeated series was much slower under host load. A full
reference process did not complete within its explicit 60 s budget and was
terminated; that is a censored run, not its completion time.

The large integer boundary cannot be removed: for N=9999, the smallest multiple
is **11112222222222222222**, outside Number's exact integer range and also
outside signed 64-bit range. Its small BFS state does not make its return value
Number-safe. Preserve checked promotion/exact fallback rather than marking the
whole helper or its caller as unconditionally Number-safe.

## Controlled variants

Archived sources in `benchmarks/experiments/euler303-*.ra`:

* `original`: unchanged queue BFS, break when zero is dequeued.
* `early`: native queue BFS, break when Parent[0] is already assigned.
* `array`: replace the queue by a fresh N-cell vector with head/tail indices.
* `arrayearly`: vector queue plus early discovery termination.
* `reduce`: an additional exact factor-5 reuse experiment; it is not selected
  on performance evidence. It retains the original helper and uses previous
  quotient terms for divisors divisible by 5 or 10.

The harness's `NO_LINKED_CALLS=1` sets **scalarCallCompilation:false**. This is a
control, not a production recommendation or a Rank CLI option. For an array
helper, it avoids the linked exact call and lets ordinary function execution
use the existing private Number function-prefix kernel. Native queue helpers
still enter their exact function backend, so the option alone does not fix the
original program.

Three fresh processes per case, serial execution, rotating compiled case order;
reference controls use limit 1000. No tests or other benchmarks from this
investigation ran alongside samples. External host load was uncontrolled and
large: do not interpret these medians as precise speed ratios.

| Full compiled case | Median | Range | Median peak RSS |
| --- | ---: | ---: | ---: |
| original, normal backend | 15.810 s | 15.284–22.881 s | 434.1 MiB |
| early native queue, normal backend | 14.119 s | 12.754–18.053 s | 493.8 MiB |
| arrayearly, normal backend | 12.138 s | 11.486–19.414 s | 539.1 MiB |
| arrayearly, NO_LINKED_CALLS | **1.617 s** | **0.852–3.222 s** | **704.0 MiB** |
| original, NO_LINKED_CALLS | 23.506 s | 12.230–24.994 s | 477.6 MiB |

All runs return 1111981904675169. An earlier arrayearly Number control took
0.562 s, with diagnostics; it is an exploratory point, not the repeated median.
The Number route consistently demonstrates substantial headroom even across
the broad ranges. The queue-array rewrite without backend selection does not
establish a similar improvement by itself. The faster route also has a higher
process memory peak; a production implementation needs to address/measure
private buffer allocation and publication, not just adopt this global option.

Reference limit 1000, three-sample medians:

| Source | Time | Range |
| --- | ---: | ---: |
| original | 2.201 s | 1.651–4.834 s |
| early native queue | 1.677 s | 1.323–3.451 s |
| arrayearly | 1.838 s | 1.798–2.596 s |

No full reference result was obtained, and these smaller times must not be
extrapolated as full-input measurements.

## Work counts independent of host timing

An exact-product JavaScript control runs the same graph search with native
integer buffers and reconstructs the answer as BigInt. Full-limit counts:

| Search | Expanded remainders | Discovered remainders | Digit transitions |
| --- | ---: | ---: | ---: |
| original | 24791492 | 34897691 | 74374476 |
| early termination | 12981568 | 24801492 | 38944704 |

That is about **47.6% fewer transitions**, with the same minimum multiple for
each N. This control is an algorithm/work oracle, not a projected Rank runtime.

Full `arrayearly` Number-path diagnostics record 10008 Number loop entries,
10006 compiled loop entries, six Number overflows, three mixed-integer loops
and one exact-work promotion. The correct wide N=9999 result is retained. At
limit 100 the normal array-helper route instead records 100 exact scalar
function entries and no Number loops; disabling linking records 100 Number
loops and zero scalar function entries. Backend selection explains the control.

## Recommended implementation direction

First apply early-discovery termination: a small independent BFS improvement.
Then allow linked helper calls to use a checked private Number execution region
when its arrays/queues are fresh and do not escape. The public result can stay
an exact Rank integer, with promotion/fallback for wide reconstruction.

There are two related compiler tasks: reuse the existing private-array Number
prefix from linked calls, and support owned integer queues in that Number
region. The latter would preserve the compact native-queue demo rather than
requiring explicit head/tail bookkeeping in Rank source. Admission must prove
container ownership, native operations, aliases, visibility and rollback/error
semantics; returned/captured/shared containers need their existing exact path.
No Number/copy threshold change is justified by this experiment.

This is a useful general feature for BFS and other helpers with private mutable
state. The measured control requires both a source representation change and
a global compiler-option change; it is not a finished compiler fix. Other demos
and private-buffer memory behavior require verification when implementing it.

## Correctness and reproduction

The independent small oracle enumerates actual allowed positive integers in
numerical order, without remainder BFS. After 32804 candidates it resolves all
N=1..200; the largest first multiple is 1122222222. Four helper variants match
in both engines. Wide N=9999 is checked in both engines, and the published sum
11363107 at limit 100 is checked for all five variants: **1618 comparisons**.
Every timed full run asserts the full expected sum. Production fixtures remain
unchanged and no broad test suites or exhaustive audits were started.

```
node benchmarks/euler303-investigation.mjs compiled 10000 original
node benchmarks/euler303-investigation.mjs compiled 10000 early
NO_LINKED_CALLS=1 node benchmarks/euler303-investigation.mjs compiled 10000 arrayearly
NO_LINKED_CALLS=1 DIAGNOSTICS=1 node benchmarks/euler303-investigation.mjs compiled 10000 arrayearly
node benchmarks/experiments/euler303-samples.mjs
node benchmarks/experiments/euler303-control.mjs 10000 early
node benchmarks/experiments/euler303-verify.mjs
```

Raw samples, diagnostics, work controls, the censored reference run and oracle
results are in `benchmarks/baselines/2026-10-31-euler303-*.json`. Diagnostics omit
zero/empty counters. Timing variation is a material limitation of this series.
