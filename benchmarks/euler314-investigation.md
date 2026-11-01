# Euler 314: delivered improvements

The production change reuses the interpreter's captured compiler capabilities
in function invocation, rather than resolving every compiler flag at each
linked helper call. Base/reference capability switching and execution hooks
remain live. No Number admission threshold was changed.

Number loops now borrow stored, all-present real read operands, including
boxed arrays and Float64 buffers. Destinations retain private copies for
copy-on-write and exact replay. Host getters, lazy storage and missing cells
keep their existing paths. Demand budgets retain the prior preparation
checkpoints by disabling this borrowing optimization under a budget.

The demo retains `cross` and its convex-envelope algorithm. Its initial
estimate now comes from the continuous geometric optimum, scaling with Grid.
The full input converges in two rounds instead of three.

## Delivery measurements

Three fresh serial processes per before/after case, with rotating order.
Node 24.15.0 on Apple M5 and Intel i7-10750H. Parsing/execution included;
imports/startup excluded. Process peak RSS includes imports. These compare
the old compiler/demo with the complete delivered implementation and demo;
they do not isolate individual changes. Every full result is
`132.52756425686314`, rounding to `132.52756426`.

| Host / input | Before | Delivered | Peak RSS before / delivered |
| --- | ---: | ---: | ---: |
| Mac, full compiled Grid 250 | 3.575 s | 0.987 s | 344 / 252 MiB |
| Intel, full compiled Grid 250 | 8.767 s | 2.574 s | 294 / 259 MiB |
| Mac, reference Grid 25 | 0.914 s | 0.505 s | 446 / 326 MiB |
| Intel, reference Grid 25 | 3.284 s | 1.742 s | 424 / 300 MiB |

The full compiled case is about 3.6x faster on Mac and 3.4x on Intel. Peak RSS
fell about 27% and 12% respectively. Small reference timings include fewer
optimization rounds; they do not demonstrate the compiler-only contribution.
The full uncompiled workload remains excluded from the reference audit budget.
A dedicated full-scale compiled test now asserts the answer and the no-copy path.

## Delivery verification

* TypeScript project build passed.
* 767 tests passed across 23 focused interpreter suites (compiler capabilities,
  Number loops, scalar helpers, array storage, missing cells, aliases, slices,
  overflow/error replay, typed builtins and debugger integration).
* Scoped Euler 314 inferred-type, differential and full-input tests passed;
  the fixture executes both the Grid 10 and Grid 1 assertions in both engines.
* Scoped name-facts audit passed; 65 semantic owners, 11 static audit tests and
  application-form checks passed.
* 21 independent small-grid oracle checks passed on each host for production
  compiled, exact-loop and uncompiled execution. Each host also passed the full
  diagnostic assertion: 500 Number regions, 94,501,500 borrowed real cells,
  zero copied real read cells, zero Number overflow or helper fallback.
* No full workspace suite or exhaustive corpus audit was started.

The new regressions cover packed/boxed real matrices, nonfinite values and
negative zero, input revisions and rebinding, read/write aliases, unsafe-integer
replay, earlier stores before bounds errors, masked holes, host getters, budgets,
execution hooks and inspection switching. The capability test also verifies that
linked helper calls do not invoke the capability resolver again.

Raw delivered measurements and oracle results:
`baselines/2026-11-01-euler314-delivery-{mac,intel}.json`.
Reproduce after building the current source, with an archived baseline runtime:

```sh
RANK314_BASELINE_RUNTIME=/path/to/baseline/packages/interpreter/out/index.js \
node benchmarks/experiments/euler314-delivery.mjs /tmp/314-delivery.json
```

## Initial research

The following records the pre-implementation investigation and alternatives.
Its timings are separate from the delivery measurements above.

Research against `5654217b` (Node 24.15.0, Apple M5 and Intel i7-10750H).
The starting #447 inventory listed `314_mousemoon.ra` as outstanding.
Production sources and the issue were unchanged during the research stage.
Concurrent main commit `67e415c8` changed Euler 696 only; compiler and Euler 314
sources remained unchanged. Later Mac series record that newer HEAD.

## Finding

The existing algorithm is already an accelerated convex-envelope dynamic
program, not an exhaustive four-dimensional predecessor search. Each outer
fractional-optimization round visits O(Grid^3) envelope sites and queries.
At Grid 250 the current source performs three rounds and returns
`132.52756425686314` (`132.52756426` to eight decimals).

The October report `dense-envelope-results.md` describes an earlier compiler
and a much slower full run. Current timing must be measured anew: the full
program already uses Number loops and Number scalar helpers.

The main remaining runtime cost is more specific than arithmetic or a missing
loop compiler. `FunctionInvocation.compiler` calls
`resolveCompilerCapabilities(this.options())` on every read. The linked
Number helper's invocation path reads this getter for its execution hook.
The full program calls `cross` 24,823,683 times. A separate CPU profile found
roughly 2.8 seconds of self samples in capability resolution, its `flag`
closure and the getter, out of a 5.4-second profiled execution. Profiling adds
overhead; these samples identify the hot path, not a latency prediction.

`Interpreter` already stores immutable base/reference capabilities and
switches between them during inspection. Function invocation should consume
that existing state, as other compiler clients do. The copied-runtime
prototype instead caches the resolver result by options identity to isolate
this repeated work. It preserves switching between options objects; a
production change should reuse the interpreter's existing capability owner.

## Compact demo improvement

Replace the input-independent starting guess `130.87` with:

```rank
Pi = (-1) acos
Answer = 2 * Grid / (2 + Pi ** 0.5)
```

This is a continuous geometric upper bound, not a stored Euler answer. For a
square of side 2G with corners rounded by radius r, the area is
`4G^2 - (4-pi)r^2` and perimeter is `8G - (8-2pi)r`. Maximizing their ratio
gives `r = 2G/(2+sqrt(pi))`, equal to that optimal ratio. It supplies a close,
scale-dependent initial estimate for the existing lattice optimization.
At the full input it reduces three rounds to two, with the same final result.
Small-grid comparisons use exhaustive predecessor enumeration rather than
the convex envelope or analytic crossing formula.

## Timing

Three serial fresh processes per case, rotating case order. Interpreter import
and process startup excluded; parsing and execution included. Diagnostics are
disabled in timing samples; RSS is process high water, including imports.
Other machine load is uncontrolled. An earlier Mac cache series contains a 6.28 s
current-control outlier. The final series repeats every case after correcting
the real-buffer prototype. Compare medians, not individual exploratory runs. All full runs assert the eight-decimal answer.

Final series (seconds / median process peak RSS in MiB):

| Variant | Mac M5 | Intel i7-10750H |
| --- | ---: | ---: |
| Current | 3.719 / 339 | 9.204 / 289 |
| Continuous initial estimate | 2.535 / 340 | 6.315 / 298 |
| Cache capabilities, unchanged demo | 1.701 / 342 | 4.430 / 321 |
| Cache + continuous estimate | 1.207 / 324 | 3.068 / 294 |
| Cache + direct real reads | 1.472 / 279 | 3.818 / 273 |
| Cache + direct reads + continuous estimate | 1.032 / 253 | 2.715 / 264 |

The final Mac combination is about 3.6x faster, with median peak RSS about
25% lower. Peak memory remains noisy: the final combination ranges from 204
to 278 MiB over three processes. The Intel combination is about 3.4x faster,
with median peak RSS about 9% lower. This does not promise a fixed memory limit.

## Other prototypes

* Direct stored-real reads: these matrices are boxed real arrays, not
  Float64 arrays. The first prototype borrowed only Float64 buffers, so it
  did not remove the copies in this demo. Historical `borrow`-labelled raw
  samples are explicitly annotated with that limitation. An earlier exploratory
  `float64Cells` version could itself copy plain cells, so its zero diagnostic
  count was not proof of zero copying.
  The corrected prototype borrows `realCells` directly (boxed or packed),
  gated by all-present stored operands. It removes 141,752,250 copied cells
  (1.134 GB of cumulative copy traffic) in the original three-round program;
  the two-round version avoids 94,501,500 cells. This is cumulative traffic,
  not simultaneous memory. Missing values, aliases, host observability,
  overflow/error replay and budgets need focused coverage before production
  admission is expanded.
* Hand-expanded `cross`: 1.651 s Mac / 4.119 s Intel in the initial series,
  versus 3.711 s / 9.070 s current. Read-table copies were still present in
  that Float64-only experiment. This provides a bound on call overhead, but
  substantially enlarges the demo. Capability caching addresses the measured
  overhead while retaining the helper.
* A seven-argument Number wrapper without rest/spread: no stable benefit
  (Mac median 5.384 s, Intel 8.911 s with the inactive Float64-only read prototype). This isolated
  arity-seven experiment is not a general compiler implementation.
* Moving Site/Start/Val scratch allocation outside both loops was explored
  separately. Single Mac observations gave 3.821 s original estimate and
  2.623 s continuous estimate; no established advantage, so it is not proposed.

With Grid 25, a separate three-process Mac series measured ordinary reference
execution at 914.6 ms / 447 MiB versus compiled 122.3 ms / 190 MiB. The full
reference workload was not run; its audit exclusion remains appropriate until
that path is separately measured.

The private-helper compiler also rejects the full `optimize` function at
`0 to Grid array`. That is a separate limitation: inner work already compiles
as 750 Number-loop regions. Expanding whole-function range/array/record
lowering is a broader project and is unnecessary for the measured cache fix.

## Verification and reproduction

Both Mac and Intel passed 77 independent small-grid comparisons each, across
current compiled/reference execution, continuous initialization and the copied
runtime prototypes. All timed full runs also matched the required answer.

A later three-process Mac reference control was noisy: current/cache medians
were 1.055/1.499 s, but process CPU medians were essentially identical at
1.743/1.743 s and cache wall samples ranged 0.928–1.649 s. This does not establish
an improvement or regression of reference execution. Retain this control when
implementing the generic change; do not claim reference speedups from the
compiled full-input results. Raw samples are in `reference-cache.json`.

No full suite or exhaustive corpus audit was run for research-only artifacts.
At that stage production files were unchanged. Each small-grid worker
checks an independent O(G^4) DP after timing, at tolerance 1e-10. Full workers
check the existing eight-decimal golden result. Reported memory is captured
before the small oracle allocates its tables.

For historical prototype comparisons, build a pre-fix checkout (5654217b),
then use its runtime explicitly. The helper below copies that baseline build;
the frozen `euler314-original.ra` preserves the original starting estimate:

```sh
export RANK314_BASELINE_ROOT=/path/to/built/pre-fix/checkout
export RANK_BENCH_RUNTIME="$RANK314_BASELINE_ROOT/packages/interpreter/out/index.js"
node benchmarks/experiments/euler314-prototype.mjs /tmp/314-borrow
node benchmarks/experiments/euler314-prototype.mjs /tmp/314-arity --arity-seven --float64-only
node benchmarks/experiments/euler314-prototype.mjs /tmp/314-cache --cache-capabilities --keep-read-copies
node benchmarks/experiments/euler314-prototype.mjs /tmp/314-cache-borrow --cache-capabilities

RANK314_CACHE_ONLY=/tmp/314-cache/packages/interpreter/out/index.js \
RANK314_CACHE_BORROW=/tmp/314-cache-borrow/packages/interpreter/out/index.js \
node benchmarks/experiments/euler314-series.mjs /tmp/314-series.json

node benchmarks/experiments/euler314-verify.mjs \
 /tmp/314-borrow/packages/interpreter/out/index.js \
 /tmp/314-arity/packages/interpreter/out/index.js \
 /tmp/314-cache/packages/interpreter/out/index.js \
 /tmp/314-cache-borrow/packages/interpreter/out/index.js \
 /tmp/314-verification.json
```

Prototype output directories must be new. Intel used temporary runtime copies
and the same Node release; no services or machine configuration were changed.

Raw results are in `baselines/2026-11-01-euler314-*.json`: `mac-final` and
`intel-final` contain the final timing series; `*-initial` and `*-cache`
preserve the earlier Float64-only experiments with explicit caveats.
`profile`, `diagnostics`, `small` and `*-verification` contain separate
profile/diagnostic/independent-oracle evidence. No production speed or memory
claim is made from diagnostic timings.
