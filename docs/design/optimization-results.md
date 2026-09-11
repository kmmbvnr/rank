# Optimization pass: measured results

This pass is in `perf/demo-roadmap`, integrated with main `9e67783`.
The runtime checkpoint is `3c355a6`. Main has not been changed by this pass.
The [experiment log](optimization-lab.md) records individual changes and
rejections; the [roadmap](performance-roadmap.md) tracks remaining work.

## Unchanged numerical demos

The final comparison used Node v24.15.0 on Apple M5, five warm samples per
case, independent result oracles, and the same source and inputs in both
checkouts. Times below are warm medians in milliseconds. Startup, input
construction and parsing are excluded from these kernel measurements.

| Demo / largest size | Main 9e67783 | Worktree 3c355a6 |
| --- | ---: | ---: |
| Euler / 200,000 | 10.9 | 11.4 |
| Matrix-vector / 512 square | 26.2 | 18.9 |
| K-means / 2,048 points | 45.3 | 33.8 |
| Row means / 512 square | 12.6 | 4.1 |
| Column means / 512 square | 12.7 | 4.2 |
| Matrix multiplication / 64 square | 310.2 | 133.7 |
| Gradient descent / 2,048 rows | 77.0 | 60.1 |

The inputs here are ordinary host arrays, not snapshot-only inputs. The
[full final report](../../benchmarks/baselines/2026-09-11-final-pair-numerical.json)
also contains the small and medium sizes, cold-process measurements and memory.
The [pre-recursion-fix integration report](../../benchmarks/baselines/2026-09-11-integrated-numerical.json)
is retained to distinguish checkpoints. Euler did not gain in this final
comparison; no extra optimization is claimed for it.

## CSES and scalar controls

All six cold judge-scale cases passed at N=200,000: restaurant 2382.8 ms,
rooms 1881.5, playlist 442.4, books 171.4, bounded-sum 627.4 and sum 164.6.
These are timeout/oracle checks, not six precise speedup estimates. The log
contains repeated paired bounded-sum measurements showing that its earlier
regression was removed.

The recursive tree control returned to 36.9 ms against main's 37.2 ms after
removing nested continuations and per-call generator-function allocation.
This retained the matrix gain. Scalar array addressing remains slower:
16.4 ms against 13.5 ms. Small scalar differences elsewhere are not evidence
for more specialized paths.
[Raw controls](../../benchmarks/baselines/2026-09-11-pair-continuation.txt).

## Host-array tradeoff still needs acceptance

The integrated array comparison has 81 workloads per checkout, including
integer, real and mixed inputs and named/reused intermediates. It predates the
last recursion fix, which does not change private storage or fold kernels.
[Raw comparison](../../benchmarks/baselines/2026-09-11-integrated-host-arrays.json).

Plain-host inline `(A * 2 + B) + reduce` at one million elements became slower:
integer 30.7 to 92.4 ms, real 29.8 to 86.2 ms, mixed 34.3 to 86.9 ms.
Main's former fusion proof probed unknown object descriptors; a Proxy trap
could change values during that proof. The corrected path does not make those
extra host calls. Restoring the unsafe probe is not an acceptable speed fix.

Explicit `createArraySnapshot` inputs retained a fused path: integer 29.0 ms,
real 26.4 ms, mixed 32.6 ms at one million elements.
[Snapshot controls](../../benchmarks/baselines/2026-09-11-integrated-snapshot-arrays.json).
Snapshot construction copies inputs in O(N) and was outside these kernel
timers. These timings do not claim that copying for each call is free.

Private storage also adds exposure/representation costs. Isolated earlier
named snapshot reductions retained about 3–4% with explicit GC. The larger
scalar-addressing cost above remains a separate acceptance item. The current
branch is not being presented as a universal speedup or as ready to merge
without that decision.

## Kept and rejected work

Kept: safe private-storage proofs and inline arithmetic sum fusion; tensor-cell
coordinate copying; transpose coordinate reuse; synchronous operand collection
and unary extrema; one reusable continuation for suspended binary operands.
The log gives the tests and measurements for each checkpoint.

Rejected and rolled back: compact real/boolean buffers with slower consumers;
short-vector caches whose small gain did not justify more cache state;
generated JS for a narrow private sum whose limited warm gain did not justify
dynamic code; condition composition that either gained too little or regressed
the existing direct path. Rejected patches and measurements remain in the repo.

The offline alias-analysis prototype remains a research tool, with no runtime
cost. It found no unaffected fresh-array candidate among the 51 bindings in its
249 parsed functions. More precise type/effect contracts need a profitable
transformation before a runtime pass is justified. Existing unparseable demo
drafts are listed in its report; passing demo tests does not certify drafts.

## Verification at the recursion checkpoint

`npm test` passed 43 parser and 445 interpreter tests. The demo runner passed
all 200 test files. The standalone alias-analysis suite passed seven tests.
The final numerical report passed all independent oracles and all six
judge-scale cases passed. Tests include operand order, errors, resource
cleanup, host getters/proxies, deep recursion and tail calls.

New tests check the execution tasks themselves, so an extra continuation is
caught without relying on a noisy timing threshold. The remaining storage
acceptance work must preserve these semantics and the measured demo gains.
