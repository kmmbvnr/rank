# Euler 315 investigation

The initial investigation below is followed by the compiler repair and final
delivery results. The production demo now uses the guarded cached-tail version;
captured-length support and a bounded-prime-loop guard regression are repaired.
At selection time, `315_digitalclocks.ra` was the next unfinished inventory
entry after 314. Baseline: `3fbb64ec`, Node 24.15.0, Apple M5 and Intel
i7-10750H. Intel used a disposable copied runtime on `root@jack.lan`.
After the measured series, main advanced to `5c82e146` (modular matrix powers).
Those concurrent changes are not part of this investigation; the timing
metadata records `3fbb64ec` and the archived Intel runtime uses that build.

## Result

The main improvement is algorithmic. Existing helper compilation is active;
the original program is not falling back wholesale to interpreted execution.
The stream of primes runs in one compiled loop, and `digit_sum` uses the
Number scalar path. Other helpers still use exact arithmetic, captured-table
readers and native `popcount` calls.

The initially selected `split` prototype keeps the general `clock_diff` helper but
computes the default prime workload differently:

1. For each transition A → B, savings equal `2 * popcount(A band B)` for
   aligned display segments. Initial turn-on and final turn-off cancel.
   Unmatched leading digits have no shared segments, so only the digits of
   the much smaller B need inspection.
2. Build a 10×10 digit-overlap table with array broadcasting and `popcount`.
3. Compute the short-chain savings for every integer through
   `9 * decimal_digits(To)`, using the general helper. At the default To this
   is 73 values, not a table of answers for the 606,028 primes.
4. Stream the primes, compute each first digit sum once, and combine the
   first overlap with the cached tail. Single-digit primes contribute zero.

The general helper continues to work outside the CLI interval and outside
the cache bound. In particular, the statement example `137 clock_diff = 10`
still works when the demo's To is only 3. A tempting helper-only cache
rewrite without a fallback would break that existing fixture.

This follows the display semantics in the [official problem](https://projecteuler.net/problem=315),
including the unusual four-segment digit 7. No precomputed Euler answer,
unsafe Number arithmetic or admission-threshold change is used.

## Repeated full-input measurements

Three serial fresh processes per case, rotating case order; parsing and
execution included, interpreter import/startup excluded. Diagnostics disabled.
RSS is the median of process high-water samples, including runtime imports.
Other machine load is uncontrolled. All runs assert `13625242`.

| Variant | Mac time / RSS | Intel time / RSS |
| --- | ---: | ---: |
| Original Sam/Max simulation | 1.727 s / 175 MiB | 4.837 s / 161 MiB |
| Sum shared segments directly | 0.506 s / 176 MiB | 1.211 s / 162 MiB |
| Also precompute 100 digit overlaps | 0.380 s / 176 MiB | 1.033 s / 161 MiB |
| **Selected: cached small tails, streaming prime loop** | **0.260 s / 176 MiB** | **0.668 s / 163 MiB** |
| Materialized ranked-array pipeline | 0.625 s / 379 MiB | 1.738 s / 325 MiB |
| Selected + 1000-entry digit-sum chunk table | 0.267 s / 177 MiB | 0.707 s / 163 MiB |
| Original + small-integer `popcount` runtime prototype | 1.647 s / 175 MiB | 4.451 s / 162 MiB |

The selected variant is about 6.6× faster on Mac and 7.2× on Intel, with
essentially unchanged peak memory. The larger digit-sum table establishes
no additional benefit here, so prefer the simpler version.

The ranked-array version explicitly materializes the prime vector and its
digit sums, then computes the overlap and tail gathers. Its measured peak
includes temporary objects and garbage collection, not merely final buffers.
A separate single Mac run with lazy digit sums reduced that peak to 297 MiB
but still took 0.579 s. A streaming ranked helper variant took 0.818 s /
262 MiB once. These are exploratory observations, not three-sample medians.
They show a further array-pipeline opportunity, not a reason to materialize
the full workload in the selected demo.

The native `popcount` experiment reuses the existing Number bit-count routine
when a nonnegative BigInt fits the safe range. Its observed gain is only
about 5–8% on the original demo. The selected algorithm needs just the tiny
initial overlap table, so this runtime change is unnecessary for its speedup;
broader sparse/dense/large-integer controls would be needed before delivery.

## Reference execution

Three fresh-process samples on the smaller interval [100000, 200000), whose
independent result is 181328:

| Host | Original time / RSS | Selected time / RSS |
| --- | ---: | ---: |
| Mac | 1.208 s / 454 MiB | 0.248 s / 270 MiB |
| Intel | 3.496 s / 409 MiB | 0.653 s / 253 MiB |

This is an algorithmic improvement in ordinary execution too. The full
uncompiled interval was not run; these timings must not be presented as
full-input reference results or grounds to remove its audit exclusion.

## General compiler gap discovered

A valid bounds check inside a helper can prevent the entire helper and its
caller loop from compiling when the array is captured:

```rank
Lookup = array 10 20 30

fun I lookup_cell
  if I less (Lookup len)
    return Lookup I
  end
  return -1
end
```

The minimal checked-in repro sums four calls to 59 in both engines. Pre-fix
diagnostics reported `scalar-function:unbound-name:NameExpression` for `len`.
The proof recognizes `array-len` only for an array in its local type
environment; a captured table's indexed integer reads have a separate proof,
which does not cover its length. This is a performance gap, not a wrong answer.

In the helper-cache prototype, adding the correct parenthesized check
`Next at least (Small len)` raised one full Mac compiled observation from
the unchecked prototype's 0.273 s to 21.598 s / 465 MiB. The unchecked version
is not a valid replacement for the general helper. Replacing the check with
a captured scalar bound restored 0.477 s in a separate run. Passing the table
as a helper argument avoided the unbound-name rejection but still took
4.942 s / 433 MiB once, so it was not selected. These alternatives were not
repeated interleaved timing series.

A useful general compiler repair is to support length reads of captured
collections with proper builtin guards and current binding resolution.
It must inspect shape/length without scanning or materializing elements,
preserve rebinding and shadowed `len`, and retain errors and observation
timing on branches that do not read the length. This was not implemented
during the initial research; the repair is documented below. Whole-function Number lowering of arbitrary helper graphs
would be a broader change and is not needed for the selected demo's speed.

## Independent correctness checks

The oracle describes each digit using explicit segment names, simulates
Sam's off/on displays and Max's individual segment transitions, and sums
their costs. It does not use Rank's numeric masks, the overlap identity or
the cached-tail algorithm. Digit sums use decimal strings. Its own ordinary
Eratosthenes sieve found 606,028 primes in the full interval and independently
obtained **13625242**.

Both Mac and Intel passed **45,576 individual-number comparisons each**:
1266 inputs × nine variants × compiled/reference execution × two cache bounds.
Inputs cover 0–999, deterministic larger values, safe-Number boundaries,
40-digit integers, negative input and helper calls outside the CLI bound.
The statement's segment count for 137 is checked separately in every run.

The prime-range oracle also passed **286 comparisons on Mac** (13 variants,
two engines, 11 ranges) and **242 on Intel** (the first 11 variants). These
include empty/reversed intervals, negative lower bounds, the single-digit
boundary, decimal boundaries and a small slice of the default interval.

The selected full diagnostic run has one compiled prime loop, 606,112 Number
scalar executions, no compiler rejection, no Number overflow/fallback and
no numeric read-buffer copy. This is separate from uninstrumented timing.
At the initial research stage no production suites or corpus audits were
started. The compiler follow-up below includes focused suites; the Euler demo
and issue #447 have not been updated.

## Reproduction

After a current TypeScript build:

```sh
node benchmarks/euler315-investigation.mjs compiled 10000000 20000000 original
node benchmarks/euler315-investigation.mjs compiled 10000000 20000000 split
node benchmarks/experiments/euler315-series.mjs /tmp/315-compiled.json
node benchmarks/experiments/euler315-series.mjs /tmp/315-reference.json reference
node benchmarks/experiments/euler315-verify.mjs /tmp/315-individual.json
node benchmarks/experiments/euler315-verify.mjs /tmp/315-full-oracle.json full
node benchmarks/experiments/euler315-ranges.mjs /tmp/315-ranges.json
```

Optional disposable runtime experiment (output directory must be new):

```sh
node benchmarks/experiments/euler315-popcount-prototype.mjs /tmp/315-popcount
RANK315_FAST_POPCOUNT=/tmp/315-popcount/packages/interpreter/out/index.js \
node benchmarks/experiments/euler315-series.mjs /tmp/315-with-popcount.json
```

`RANK_BENCH_RUNTIME` selects a copied interpreter entry point for workers.
Frozen Rank variants and the minimal captured-length repro are under
`benchmarks/experiments/euler315-*.ra`. Raw timing, profile, diagnostic and
oracle evidence is in `baselines/2026-11-01-euler315-*.json`.


## Implemented compiler follow-up

`captured-len` is now a proven input operation, lowered to a guarded call at
its original expression position. The reader resolves the current lexical
binding on each observation, rather than caching the collection or its length
at function entry. The builtin identity and native implementation are checked
at entry, including overrides of the same native function object's `call`.

A new header-only storage capability, `hasNativeArrayHeader`, uses ownership
and native-derived-array metadata. It does not inspect element types, traverse
array dependencies or invoke shape getters. This admits native stored arrays
of any element type and native lazy arrays with a data-property shape, as well
as text. Opaque/changed host headers, other collection kinds and deferred
bindings retain ordinary execution. This admission is conservative; it does
not claim that arbitrary external headers or every local-closure optimization
now compile.

Length reads can still become observable through rebinding, so the proof
propagates this effect through linked and ranked helper calls. Such calls do
not enter private Number caller regions or enable deferred caller writes.
Captured scalar snapshots are also disabled across this effect. Budgeted or
inspected execution retains the existing path. No Number admission threshold
or arithmetic semantics were changed.

### Compiler-only measurements

Both runtimes execute the **same guarded `captured-len` variant**, including
`Next at least (Small len)`. This is not the original Sam/Max source, and no
algorithm/source rewrite is included in these before/after comparisons.
Node 24.15.0; fresh serial processes, import excluded, parse/execute included.

| Host / interval | Before | After | Before / after peak RSS |
| --- | ---: | ---: | ---: |
| Mac, [100000, 200000), medians of 3 each | 405.7 ms | 63.3 ms | 321 / 176 MiB |
| Intel, [100000, 200000), medians of 3 each | 1505.5 ms | 161.2 ms | 303 / 163 MiB |
| Mac, full interval | 19.384 s, **one control** | 0.334 s, **median of 3** | 466 / 178 MiB |
| Intel, full interval | not run | 0.883 s, **median of 3** | — / 166 MiB |

Every full answer is `13625242`. After the repair the full prime loop compiles
as one region, with no `len` rejection or Number overflow/fallback. The Mac
full-after samples are 0.334/0.333/0.604 s, so do not present the median as a
latency deadline. No repeated full baseline was run on either host.

Single original-source controls also preserved the answer (Mac before/after
2.903/2.009 s). They are noisy one-off observations, not evidence that this
repair accelerates the original source, which contains no captured `len`.
The archived baseline predates the independent 5c82e146 matrix-power change;
that change does not implement the examined construct.

### Follow-up verification

* TypeScript project build passed.
* **738 tests in 26 focused interpreter suites passed**, covering scalar
  kernels/proofs, arrays and aliases, native-call guards, lexical captures,
  function plans, ranked callbacks, demand budgets and debugger behavior.
* Each host passed **45,576 independent display-model comparisons** again
  against the repaired runtime, across the research variants and both engines.
* Semantic boundaries (65 owners), 11 static checks and application forms pass.
* No full workspace suite or exhaustive corpus audit was run.

The new regression file checks real and empty matrices, Unicode text, changed
bindings and shapes, closure-instance correctness, precise failure/state
comparisons, an invalid skipped length, unforced deferred captures, native
lazy-array cells that throw if read, opaque host-header observation counts,
publication before callbacks, live execution hooks, native overrides and
budget fallback. Nested local function declarations still use their existing
fallback where that broader compiler tier is unavailable; their results are
included in the correctness checks.

Raw follow-up records: `baselines/2026-11-01-euler315-compiler-*.json`.
Reproduce with a built pre-fix archived runtime and the current build:

```sh
RANK315_BASELINE_RUNTIME=/path/to/baseline/packages/interpreter/out/index.js \
node benchmarks/experiments/euler315-compiler-length.mjs /tmp/315-compiler.json
```

Set `RANK315_FULL_BASELINE=1` to add one potentially slow full pre-fix control.
The initial series above predates final delivery; the following section records
the final source and validation against the current parent.

## Final delivery

The demo uses the guarded `captured-len` algorithm, with the table broadcasting
and cache bound named explicitly. `clock_diff` checks `Small len` and falls back
to `clock_tail` when the argument is outside the cache. This keeps standalone
helper calls valid even when the CLI's To creates a very small cache. The
existing fixture assertions are unchanged.

Three fresh-process samples in rotating order, on the same final runtime:

| Full source | Mac time / peak RSS | Intel time / peak RSS |
| --- | ---: | ---: |
| Original Sam/Max simulation | 1.645 s / 176 MiB | 4.884 s / 162 MiB |
| Delivered guarded cached-tail demo | 0.324 s / 178 MiB | 0.876 s / 164 MiB |

This is about 5.1x / 5.6x faster, with essentially unchanged process peak RSS.
The separate compiler-only series below distinguishes this algorithm change
from support for captured `len`.

Final integration also found a regression from `8598c2ba` (#504): the loop
builtin guard required every catalogued value to be a native function. `primes`
is a cached sequence value, so bounded prime loops silently reverted to the
interpreter. With captured-length support present but that guard broken, the
full guarded source took a median 2.62 s and about 456 MiB on Mac. The repair
retains registry identity checks for all values and implementation checks for
actual native functions. The original bounded-prime-loop tests now pass again.

Compiler-only final comparisons use the same guarded frozen source. Both the
copied baseline and repaired runtime include the prime-sequence guard repair,
so these pairs isolate captured-length support. Node 24.15.0, serial fresh
processes; imports excluded, parsing/execution included.

| Interval / host | Before captured-length support | After | Peak RSS before / after |
| --- | ---: | ---: | ---: |
| [100000, 200000), Mac, medians of 3 | 395.4 ms | 64.8 ms | 323 / 177 MiB |
| [100000, 200000), Intel, medians of 3 | 1466.5 ms | 161.4 ms | 300 / 163 MiB |
| Full, Mac | 19.365 s, one control | 0.327 s, median of 3 | 469 / 178 MiB |
| Full, Intel | not run | 0.887 s, median of 3 | — / 164 MiB |

The full guarded prime loop compiles as one region with no `len` rejection or
Number overflow/fallback. All full answers remain `13625242`. This full Mac
compiler-only ratio has a single pre-fix control and must not be described as
a repeated baseline median.

For reference execution on [100000, 200000), three-run medians of the original
source versus the delivered guarded source are 1039.2 → 478.4 ms on Mac and
3617.5 → 1793.8 ms on Intel. Median peak RSS changes 453 → 317 MiB and
409 → 297 MiB respectively. Full reference execution was not repeated and its
audit exclusion is unchanged.

Final verification:

- TypeScript project build passes.
- Mac: **797 tests in 29 focused suites** pass, including 21 new captured-length
  cases, declared-call compatibility, bounded prime loops, Number loops,
  captures, native guards, plans, callbacks and debugger/budget behavior.
- Intel: **50 tests in 3 focused suites** pass for captured lengths, declared
  calls and bounded prime loops.
- Each host passes **50,640 independent display-simulation comparisons** across
  ten variants (including the actual production source), both engines and two
  cache bounds, plus **308 independent prime-range comparisons**.
- The existing Rank fixture passes all three tests in both engines on both
  hosts. Statement examples and calls outside a deliberately tiny cache remain
  covered. The prior independent full display-model oracle is retained.
- Semantic boundaries (65 owners), 11 static checks and application-form checks
  pass. Full workspace tests and exhaustive corpus audits were not run.

The parent is `bd911a89`, including the Euler 316 declared-call repair. Final
measurements, checks and source provenance are retained in
`baselines/2026-11-01-euler315-delivery-*.json`; the unsuccessful prime-guard
integration attempt is recorded separately from final measurements. The
popcount-only runtime prototype is not delivered. Unrelated workspace edits
remain outside this change.

To repeat the delivered-source series:

```sh
RANK315_DELIVERY=1 node benchmarks/experiments/euler315-series.mjs /tmp/315-final.json
RANK315_DELIVERY=1 node benchmarks/experiments/euler315-series.mjs /tmp/315-final-reference.json reference
```
