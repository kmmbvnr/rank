# Euler 331: stream complete boundary rows

Baseline: `75a6ff63`, Node v24.15.0, 2026-11-02. The production demo now
advances X through a complete row before taking the next Y step. It preserves
constant auxiliary storage and the exact full answer, 467178235146843549.

## Implementation

The old code already avoided constructing an N×N board or an N-element parity
array. Its real-valued `boundary` helper compiled to one JavaScript function.
The cost was the O(N) boundary traversal, with a branch between an X advance
and a Y transition on every iteration. The new inner loop groups X advances;
the Y transition follows directly, with an early exit at the diagonal.
Original residual additions are preserved: combining them into multiplications
did not improve compiled execution and made reference execution more expensive.

The inner X loop does not need a separate X<Y check on every advance. It starts
at a black annulus cell with X<Y. If it reaches X=Y, the previous cell
(Y−1,Y) is also in that annulus. The distance between the radii of (Y−1,Y)
and (Y+1,Y) exceeds one for Y>=1, so both cannot lie in the width-one annulus.
Thus the next X step is already rejected by the outer-radius condition.
The explicit break after the row preserves the existing diagonal correction.

Residuals and counts remain small exact integers represented as reals, as
documented in the demo. The final product uses exact integers and must not be
changed to floating-point arithmetic: the answer exceeds Number's safe range.

No compiler change was needed for this speedup. The hot `boundary` helper
already compiles; the unsupported `N real` in the outer `turns` wrapper occurs
once per board, outside the hot loop. Adding that conversion to the scalar
compiler could be useful generally, but would not remove the traversal.

## Measurements

Three fresh processes per variant and mode, median including parse and
execution. Full compiled input is the production sum, not an isolated call to
the largest board. All full runs returned the exact answer above and recorded
14 compiled scalar-function executions.

| Host / input | Before | After | Before peak RSS | After peak RSS |
| --- | ---: | ---: | ---: | ---: |
| Mac / full, compiled | 1.911 s | 1.427 s | 161.5 MiB | 174.2 MiB |
| Intel / full, compiled | 4.632 s | 3.529 s | 163.6 MiB | 162.2 MiB |
| Mac / N=1,000,000, reference | 0.890 s | 0.959 s | 178.0 MiB | 177.8 MiB |

Compiled execution improves by about 25% on Mac and 24% on Intel. The reduced
reference regresses about 8%; grouping rows adds loop-control work to the
statement evaluator. This is a documented tradeoff, not a reference speedup.
Full reference was not run because the billion-scale traversal is expensive.

Intel was reached using `ssh -p 22022 root@viewflow.io` when `jack.lan` was
unavailable. It used `/opt/rank-bench-node/bin/node` v24.15.0 and the matching
interpreter/language output copied for the preceding Euler 326 measurements.

## Memory investigation

The algorithm allocates no board, parity table or DP buffers; both versions
use O(1) auxiliary storage. There was no large algorithm allocation to remove.
The Mac peak-RSS measurements remain bimodal: production trials were 174.2,
175.9 and 161.6 MiB. Do not conceal their higher median or claim a Mac RSS saving.
Intel peak RSS decreases slightly, by about 1.4 MiB.

Separate `--expose-gc` controls measured retained heap growth from immediately
before execution to after a full GC: median 11.843 MiB before versus 11.793 MiB
after, a difference of only about 51 KiB. Retained ArrayBuffer growth was zero
in every trial. These figures include parser/runtime/kernel retention; they
are not a measurement of loop workspace alone. GC-control peak RSS was 158.3
versus 160.4 MiB. They support similar retained storage, but do not erase the
ordinary-process peak-RSS result. No forced GC was added to production.

Earlier fused-arithmetic, branchless and additionally guarded nested-loop
prototypes were rejected. The selected version keeps the arithmetic and
removes the unnecessary diagonal check from the hot inner loop.

## Verification

- 95 focused tests passed across `euler-331`, `scalar-entry`, `loop-control`.
- Independent board enumeration through every even N=2..128, given examples,
  and N=10,000: 1088 comparisons over eight variants in both execution modes.
- Both original Rank fixture tests across those variants/modes: 32 passes.
- 2088 comparisons against the saved original walk: all even N=2..4096 and
  sizes around large diagonal transitions, through approximately 741,000.
- The production full answer is a regression test above the safe Number range.
- No exhaustive audit or full test suite was run.

The selected production change is deliberately limited to the loop shape.
The remaining reference cost is statement evaluation over O(N) work. Further
reference optimization would need separate evidence and semantic checks.

Reproduce from the repository root:

```sh
node benchmarks/euler331-investigation.mjs verify
node benchmarks/euler331-investigation.mjs compiled full original
node benchmarks/euler331-investigation.mjs compiled full production
node benchmarks/euler331-investigation.mjs reference 1000000 original
node benchmarks/euler331-investigation.mjs reference 1000000 production
MEMORY=1 node --expose-gc benchmarks/euler331-investigation.mjs compiled full production
```

The original is saved in `benchmarks/experiments/euler331-original.ra`.
Set `DIAGNOSTICS=1` for counters, `SOURCE_OUT=/tmp/331.ra` to export a variant,
or `RANK_ROOT` to select an equivalent remote build. Raw measurements:
`benchmarks/baselines/2026-11-02-euler331-refresh.json`.
