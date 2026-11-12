# Captured scalar reads in pure recursion

Baseline: `676ecfc9`. Retain the optimization after repairing its observer
boundary; the original prototype was unsafe during deep interpreted fallback.

## Change and boundary

For a proven primitive scalar function whose only calls are self calls, read
captured bindings into separate JavaScript locals once per direct invocation.
They are refreshed for every recursive call and every later top-level call.
No array of capture values is allocated per invocation.

Array/collection expressions, other user/native calls and observable capture
proofs do not qualify. Generic kernel calls retain live reads. Direct calls
also retain live reads during inspection, observable polling, or when any
compiler hook is installed. Hook presence is checked once when preparing the
entry; interrupt/inspection state is checked at each invocation.

The additional hook guard is necessary: after the boxed recursion budget is
exhausted, a child can execute in a framed body. Its body-execution hook can
change a global capture that the compiled parent reads after the child returns.
The original prototype returned a stale parent value in this case. The added
regression test fails on that prototype and passes after the repair.

## Measurement

Use the existing fresh-process harness, with matching source hashes and exact
answers, three alternating pairs, Node 24.15.0 and a 4 GiB heap:

```sh
CASES=452,505,507 ROUNDS=3 \
CASE_INPUTS='{"505":{"args":["100000000000"],"answer":"459260736097816346"}}' \
node benchmarks/experiments/nightly-2026-11-11.mjs BEFORE AFTER
```

A separate full-default Euler 505 pair uses `CASES=505 ROUNDS=1` without
`CASE_INPUTS`. The public demo and its algorithm are unchanged.

Intel was idle before timing. Mac runs overlapped a different session's large
Vitest suites; those samples remain archived as contended evidence and are not
used for a clean Mac speedup percentage. No other session's processes were
stopped or changed.

## Verification

After integration onto `a8ff2e4e`, 272 focused interpreter tests in ten files
and 71 language tests in two files pass, including capture rebinding,
closure instances, native Map writes, the deep fallback hook regression, wide
integer arithmetic, recursion, interruption and compiler observations.
TypeScript, semantic boundaries (65 owners), application forms and whitespace
checks pass. Full npm test and exhaustive audits were not run.


## Reviewed Intel results

Medians of three pairs, seconds:

| Workload | Before | After | Time change |
| --- | ---: | ---: | ---: |
| Euler 505, N=10^11 | 10.237 | 7.558 | -26.2% |
| Euler 452, default | 1.597 | 1.633 | +2.3% |
| Euler 507, default | 14.780 | 14.652 | -0.9% |

The 505 ranges do not overlap: 9.776–10.627 s before versus 7.493–7.559 s
after. Both control workloads have overlapping ranges; their small median
changes do not establish a performance change. This is a speed improvement,
not a claimed reduction in retained memory or general whole-program coverage.

The full-default Euler 505 input (N=10^12) took 161.333 s before and
120.823 s after (-25.1%), with the same exact answer `714591308667615832`.
This is one additional pair, not a repeated median. Peak RSS was 173.4 versus
172.2 MiB; no memory improvement is claimed.

[Raw measurements](baselines/2026-11-12-captured-scalar-reads.json) include the
reviewed Intel series, full-default pair, contended Mac series, and preliminary
prototype series.
