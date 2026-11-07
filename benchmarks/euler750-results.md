# Euler 750: amortized broadcast lanes and weighted interval costs

Issue: https://github.com/kmmbvnr/rank/issues/551

Cards=976 and the default answer `160640` are unchanged. The DP still considers
all 154952200 splits. Work proceeded from the language implementation and
array storage to eliminating repeated work in the Rank solution.

## Full-input measurements

Baseline: main `7c2af13e`, with source frozen in `fixtures/euler750-original.ra`.
Node v24.15.0; Apple M5 arm64 macOS and Intel i7-10750H x64 Linux, normal CPU
affinity. Each host ran one baseline and three serial final fresh processes.
The timings include parsing and execution. Other host load and CPU frequency
were not controlled; baseline variance was not measured. Ratios compare a
single baseline against the final median, not two measured distributions.

| Host | Baseline seconds | Final seconds, all runs | Median speedup | Baseline peak MiB | Final median peak MiB |
| --- | ---: | --- | ---: | ---: | ---: |
| Mac | 25.79 | 5.22 / 4.62 / 5.20 | 4.96x | 387.30 | 333.98 |
| Intel | 44.96 | 11.85 / 12.09 / 12.21 | 3.72x | 335.07 | 277.50 |

All full-input runs returned `160640`. Median peak RSS fell 13.8% on Mac and
17.2% on Intel; all final peaks were below their host's baseline. RSS is the
whole-process high-water mark, rather than live DP storage or allocation
volume. The issue's historical 39-second figure is not used as a baseline.
Raw samples and calculated medians are in `results/euler750/`.

## General language improvement first

The original Cards=600 CPU profile was headed by three sampled instances of
`mapStoredInt32Binary` (507, 466 and 396 self samples). Broadcast address
calculation also appeared repeatedly (222, 192 and 92 samples). The expensive
operations were full broadcast maps for DP indices and distance expressions.
The final Cards=600 profile instead led with tensor binding and selectors;
profiles are diagnostic and are excluded from the primary timing series.

The existing compact broadcast kernel admitted an Int32 operand plus short
boxed/wide constants, capped at 64 cells. Larger Int64 range vectors went
through a per-output broadcast path, even when all their values fit Int32
and each input was reused hundreds of times.

The interpreter now allows checked narrowing of completed Int64 lanes when
at least four output cells amortize each copied input cell. It also allows
both inputs to be Int64 when their combined copy cost meets that bound.
The resulting native lane loop shares broadcast addresses across a row and
writes Int32 directly. Ordinary arithmetic bounds still prove the result fits;
wide inputs/results retain the existing exact paths. No language syntax or
numerical semantics change, and there is no Euler-specific kernel.

Only typed, proven stored inputs receive the larger limit. Boxed constants
retain the old small limit. Logical view offsets/strides remain respected.
Large conversions have bounded cancellation checkpoints. The new cases
decline under demand budgets, preserving their existing traversal, and
observable polling retains the ordinary path.

An accepted compact broadcast avoids a full Float64 scratch array followed
by Int32 packing: output payload falls from roughly 12 to 4 bytes per cell,
plus small copied input lanes. This local allocation improvement does not
prove a lower whole-program RSS: the runtime-only control below actually
had a slightly higher high-water mark on both hosts.

## Separate runtime and source controls

These are single exploratory fresh-process controls, not final-series samples:

| Host and source | Runtime | Seconds | Peak MiB |
| --- | --- | ---: | ---: |
| Mac, original Rank source | Baseline | 25.79 | 387.30 |
| Mac, original Rank source | Expanded Int64 lanes | 16.05 | 409.52 |
| Intel, original Rank source | Baseline | 44.96 | 335.07 |
| Intel, original Rank source | Expanded Int64 lanes | 23.56 | 341.66 |
| Mac, final Rank source | Baseline | 10.69 | 280.27 |
| Mac, final Rank source | Expanded lanes, final median | 5.20 | 333.98 |

Thus both changes contribute to time savings. In the Mac source-only control,
Rank changes alone give a substantial speedup; the new runtime roughly halves
that reduced workload's time again. The combined result must not be attributed
entirely to the interpreter. The source-only control also has lower peak RSS
than the combined median, so the kernel's local buffer savings must not be
presented as a measured end-to-end memory saving by themselves. Controls were
not repeated or pooled, and early exploratory trials overlapped short test or
diagnostic activity.

## Reuse the interval edge in Rank

The original recurrence is

```
Cost(l,r) = min_m Cost(l,m) + Cost(m+1,r) + |pos(m)-pos(r)|
```

For a fixed right interval, its extra edge is independent of the outer left
endpoint. Store a second DP layer, for starts s>=2:

```
Weighted(s,r) = Cost(s,r) + |pos(s-1)-pos(r)|
Cost(l,r) = min_m Cost(l,m) + Weighted(m+1,r)
```

The weighted singleton rows are initialized with their adjacent-label distance.
After each length's minima are computed, that row's weighted costs are filled.
A weighted entry starting at label 1 is never read as a right child.

This preserves interval order and every split, while moving the distance and
its extra addition out of the 154952200 candidate cells into 476776 interval
entries, including singleton initialization. The hot path needs two table
gathers, one addition and a row minimum. It no longer constructs the large
Near/Dist arrays and their associated broadcast indices for each length.

At defaults, each compact DP table occupies 3.65 MiB; the extra table raises
the retained DP payload to about 7.30 MiB. The measured whole-process reduction
comes from the combined change, despite that extra retained state. The source
still has one loop and uses existing array operations.

## Rejected experiments

Simply making all loop intermediates deferred was rejected by the language:
a live First plan reads Table and therefore prevents mutating it. That scope
protection was preserved. Moving the computation into a function made the
source legal, but a Cards=600 baseline trial took 41.37 seconds versus the
original profile's 4.93 seconds, with substantially higher memory.

A generic checked Number trailing-axis min/max fusion prototype was also
slower: its partially deferred Cards=600 source took 33.53 seconds and
634.14 MiB. It was removed from the delivered interpreter. Its zero-context
patch is retained in `experiments/euler750-axis-fusion.patch`; it can be
applied with `git apply --unidiff-zero` in a disposable baseline checkout.
Source variants and raw failed-trial records are retained for investigation.
They are not part of the selected solution or the final timing series.

## Verification

The TypeScript build passed. Both hosts passed 152 focused tests across six
files, plus the full default golden test. The golden took 7.30 seconds on Mac
and 12.39 on Intel under Vitest, separately from benchmark timings.

The scalar oracle uses the original recurrence with a two-dimensional BigInt
DP and direct distances, without the weighted layer or flattened addressing.
Cards=0,1,2,3,4,5,6,8,10,16,24,32,64 are checked in both compilation modes.
The existing statement examples remain 8 and 47 for Cards=6 and 16.
Kernel tests cover both-wide and mixed inputs, both operand orders, three-axis
broadcasting, nonzero buffer offsets, signs/zero, arithmetic and GCD, exact
fallback through arbitrary precision, budgets and cancellation.

An additional `plan-tensor-reduction.test.ts` check has two pre-existing
JIT hook-count assertion failures. They reproduce with the source restored
to unmodified `7c2af13e` (50 pass, two fail), and remain with this change.
They are recorded separately; this is not a claim of a clean full suite.
No full ordinary suite or exhaustive audit was run.

## Reproduction

From the repository root:

```sh
npm run langium:generate
node node_modules/typescript/bin/tsc -b tsconfig.build.json
EXPECTED=160640 node benchmarks/euler750.mjs
```

The first argument selects Cards; the second can be `reference` to disable
compilation. `RANK_SOURCE` selects a source fixture, `PROFILE` writes a CPU
profile, and `DIAGNOSTICS=1` records counters and execution costs. Reproduce
the original source on the new runtime with:

```sh
RANK_SOURCE=benchmarks/fixtures/euler750-original.ra \
  EXPECTED=160640 node benchmarks/euler750.mjs
```

From `packages/interpreter`:

```sh
node scripts/test.mjs test/amortized-broadcast-lanes.test.ts \
  test/euler750.test.ts test/packed-column-broadcast.test.ts \
  test/compact-gcd.test.ts test/integer-axis-extreme.test.ts \
  test/plan-tensor-axis.test.ts
node scripts/test.mjs test/full-scale-demos.test.ts -t 750
```
