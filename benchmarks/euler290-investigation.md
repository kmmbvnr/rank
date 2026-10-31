# Euler 290 investigation

Investigated `euler/290_digitalsignature.ra` and its fixture at main
`8be3a4df` on 2026-10-31. Issue #447 lists these as the next unfinished
problem in ascending numerical order. The original investigation is retained below; the delivered implementation
and final verification are summarized first.

The task counts integers below 10^18 whose digit sum equals that of 137n:
https://projecteuler.net/problem=290 . The existing digit DP is appropriate;
this is not enumeration of 10^18 integers.

## Delivered implementation

The demo now uses bounded row-slice additions. Number loops compile integer
`=`, `+=`, `-=`, and `*=` between trailing arithmetic ranges with scalar
prefixes, including distinct positive/negative steps. Private snapshots precede
stores, Int32 destinations widen and unsafe arithmetic replays exactly. Invalid
selectors and shapes replay the ordinary evaluator, preserving its errors and
preceding state. The assignment result is a separate live selection, constructed
only when it escapes. Sources written in the region, named table rows, mixed
scalar-wide regions and unsupported domains retain ordinary execution. Existing
Number copy-admission thresholds are unchanged.

Final three-sample medians, restoring the pre-change JIT in fresh child-loaded
processes for before cases:

| Workload | Before, ms | After, ms |
| --- | ---: | ---: |
| Full original → shipping, compiled | 189.4 | 175.5 |
| Row-slice variant, compiled (compiler change) | 416.3 | 175.5 |
| Full original → shipping, reference | 8779.4 | 600.2 |
| Control 026, compiled | 102.1 | 100.7 |
| Control 104, compiled | 746.6 | 760.8 |
| Control 129, compiled | 116.5 | 119.8 |
| Control 093, compiled | 1696.4 | 1708.5 |

The reference gain is **14.6x**. Compiling the array variant gives **2.37x**
relative to that same variant on the old compiler, while keeping the original
fast compiled performance (about 0.18 seconds). Control differences are within
3%; three samples on an uncontrolled host do not establish small regressions.

Compiled row-slice peak RSS falls from 372.5 to 196.9 MiB. Relative to the
original scalar demo, compiled peak rises from 186.0 to 196.9 MiB, and reference
peak rises from 195.9 to 395.8 MiB. These are whole-process peaks, not retained
memory measurements; the reference speedup has a peak-memory tradeoff.

TypeScript build passed. Focused validation passed 23 files / 1045 tests,
including 27 new slice cases; full compiled Euler 289 and 290 passed. Four
scoped type/differential checks cover the demo and its fixture. After main
received an unrelated modular-product fusion, the rebuilt integration passed
the 27 slice cases and full Euler 290 again. The direct-enumeration oracle
passed **85** comparisons, including shipping; full runs retain the exact
golden `20444710234716473`. The fixture retains N=18,3,6 and adds N=0,1,2.
Full/exhaustive suites and Intel measurements were not run.

Reproduce the final alternating series with
`python3 benchmarks/euler290-delivery-series.py`.
Raw delivery samples, controls, checks, diagnostics and source hashes are in
`baselines/2026-10-31-euler290-investigation.json` under `delivery`.

## Original investigation

The following measurements and compiler findings describe the pre-change
checkout, rather than the shipped implementation.

## Current behavior and measured alternatives

Mac arm64, Node v24.15.0. Medians of three fresh serial processes per case,
with alternating case order. Parse/JIT time is included; module import time
is excluded. Every full-size answer was asserted to be `20444710234716473`.
Other host load is uncontrolled. These figures supersede the historical
70.8/1.5-second measurements in the issue for this checkout and machine.

| Frozen variant | Compiled, ms | Reference, ms | Compiled / reference peak RSS, MiB |
| --- | ---: | ---: | ---: |
| original | 179.0 | 8567.3 | 185.5 / 196.5 |
| window: reachable + completable range | 158.2 | 3492.3 | 186.4 / 197.1 |
| prune: window + hoist nonzero read before digit loop | 156.0 | 3079.4 | 186.1 / 353.1 |
| vector: window + row-slice addition | 425.4 | 584.0 | 399.1 / 395.3 |
| lowered: window + explicit scalar expansion of slice addition | 153.9 | not measured | 187.0 / not measured |

RSS is the whole process peak, not retained table storage. The vector variant
makes reference execution 14.7 times faster but currently makes compiled
execution 2.4 times slower and approximately doubles peak process memory.
The scalar expansion demonstrates an attainable implementation strategy;
it does not establish the performance of an unimplemented generic compiler
extension.

Single-sample exploratory variants also tried reachable bounds alone,
reordering alone, both together, and evaluating the last digit directly into
the answer. None gave a better overall tradeoff. Raw exploratory samples are
separate from the repeated series in the JSON baseline.

## Why the original is slow in reference mode

The original scans 18 * 137 * 10 * 400 = 9,864,000 DP cells. Most early and
late cells cannot contribute. Every scalar iteration still evaluates Rank
statements, scopes, selection and branch machinery. A separate CPU profile
of the original reference run had its largest self-time entries in
`applySelectors`, expression evaluation, general assignment, selectors,
block execution and binding assignment. This is evidence of interpreter
bookkeeping cost, not an arithmetic-only bottleneck; the profile includes
startup and is not part of the timing series.

For digit level L, before processing that digit, the difference d lies in
[-9(L-1), 9(L-1)]. With R=N-L+1 digits left, each future digit changes it
by [-9,9]. The final carry is in [0,136], so its digit sum is at most 18.
Only d in [-9R-18, 9R] can finish at zero. Intersecting those intervals
reduces the scanned cells to 2,219,400 without changing the DP recurrence.
The window variant preserves C/D/T loop order, so multiplication/division
for the carry remains outside the T loop.

Moving T before D avoids repeated nonzero reads but recomputes carries for
every live cell; its reference peak RSS is also substantially higher. The
window variant is the better conservative scalar change.

## Pre-change compiler finding and proposed follow-up

The original heavy C/D/T loop already uses Number execution. Diagnostics
show 19 compiled loops, 20 Number entries and one Number overflow. The
separate final accumulation exceeds Number's safe-integer range and retains
exact semantics through replay/mixed integer lowering. Replacing the exact
answer with unchecked floating point would be incorrect.

The outer Level loop is rejected for `mutable-array-alias` at `Now = Next`;
its nested numeric loop still compiles and runs at each layer. This is not
the cause of an 8-second compiled execution: current compiled total is 179 ms.

The most useful general extension exposed by this problem is compiling:

```rank
Next Carry (Lo + Move to Hi + Move) += Now C (Lo to Hi)
```

All counts are nonnegative, so adding zero cells has the same numeric effect
as the original nonzero branch. The row-slice form removes that scalar loop
from Rank source, and the reference interpreter already uses bulk writes.

However, `jit/integer-loop-writes.ts` only recognizes a range destination
when `assignment.indices.length === 1`. A scalar leading coordinate followed
by a range is rejected (`loop:unsupported-op:to`). In addition,
`jit/number-loop-runtime.ts` excludes `info.slice` destinations entirely.
Thus the vector variant compiles only the final answer loop: diagnostics
show one compiled loop, 24,661 bulk writes and no fused array updates.

Recommended implementation order:

1. Lower a fixed scalar prefix plus trailing range on reads and compound
   writes to checked row offsets and a numeric cell loop. Preserve range
   validation, RHS evaluation, shape and error behavior, and overlapping
   source snapshot semantics.
2. Support that lowering in private Number execution, including widening,
   overflow rollback/replay and partial-state publication on ordinary errors.
   Keep the final answer exact.
3. Adopt the bounded row-slice demo only after comparing the implemented
   compiler against both the scalar original and the reference variant.

This is a reusable multidimensional array operation, with no Euler-specific
compiler cases. The explicit `lowered` prototype gives 154 ms and the correct
answer, but it is not a substitute for testing those generic contracts.

## Verification and reproduction

`euler290-verify.py` directly enumerates all integers below 10^6, computes
both digit sums, and compares counts at N=0 through 6. It passed 75 Rank
comparisons: all nine variants compiled at N=0..6, plus original/window/
vector/lowered in reference mode at N=0,3,6. Counts are 1,2,4,33,306,2902,27955.
Full-size exploratory and repeated samples assert the existing golden answer.
No full or exhaustive test suite was run, and no Intel measurement was made.

```sh
./node_modules/.bin/tsc -b packages/language packages/interpreter
node benchmarks/euler290-investigation.mjs compiled original 18
node benchmarks/euler290-investigation.mjs reference vector 18
DIAGNOSTICS=1 node benchmarks/euler290-investigation.mjs compiled vector 18
python3 benchmarks/euler290-verify.py
```

The baseline JSON contains repeated samples, exploratory measurements,
diagnostics, the direct-enumeration verification output and source hashes.
The original fixed 400-column table and its input-range limitations are
retained by the prototypes; the investigation does not claim arbitrary-N
support. The fixture itself executes N=18, N=3 and N=6, so its historical
cost also includes two extra runs of the same DP.
