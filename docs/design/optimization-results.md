# Optimization pass: measured results

This pass is in `perf/demo-roadmap`, integrated with main `9e67783`.
Main has not been changed by this pass.
The [experiment log](optimization-lab.md) records individual changes and
rejections; the [roadmap](performance-roadmap.md) tracks remaining work.

## Latest decision and results

The owner confirmed that our JS objects are an internal protocol, not a public
embedding API. Private ownership/exposure tracking was removed. Ordinary eager
arrays now use the same numerical fusion as snapshots. Arbitrary eager-host
Proxy/getter effects are outside the [contract](array-storage.md); Rank lazy
readers, aliases, writes and resource cleanup retain their semantics.

The latest full numerical comparison used five warm samples and ordinary eager
inputs against main `9e67783`:

| Demo / largest size | Main | Simplified storage |
| --- | ---: | ---: |
| Matrix-vector / 512 square | 26.6 ms | 7.9 ms |
| K-means / 2,048 points | 45.3 ms | 33.1 ms |
| Row means / 512 square | 13.2 ms | 4.3 ms |
| Column means / 512 square | 13.5 ms | 4.3 ms |
| Matrix multiplication / 64 square | 313.1 ms | 132.3 ms |
| Gradient descent / 2,048 rows | 80.5 ms | 61.1 ms |

[Latest numerical report](../../benchmarks/baselines/2026-09-11-eager-arrays-numerical.json).
Scalar addressing took 13.5 ms initially and 14.1 ms in the full verification
run, versus 16.4 ms under private exposure tracking. Recursion stayed at
37.4–37.5 ms. Real inline chain reduction took 34.6 ms, down from 86.2 ms
under the private-only gate; it remains above the earlier main result of
29.8 ms because eager cell validation has a cost. No universal speedup is claimed.

The final [81-case array report](../../benchmarks/baselines/2026-09-11-eager-arrays-full.json)
checks integer, real and mixed inputs at all sizes. One-million-cell inline
folds took 34.7, 34.4 and 38.4 ms respectively. Real named and reused folds
took 83.4 and 109.4 ms; their caches still matter.

After the final constructor simplification, `npm test` passed 43 parser and
436 interpreter tests. The demo runner passed 200 files. All six N=200,000
judge-scale cases passed: restaurant 2441.8 ms, rooms 1946.0, playlist 460.3,
books 180.8, bounded-sum 634.5 and sum 162.9. Runtime and memo controls passed.
The smaller test count reflects removal of private-state and arbitrary eager
host-trap requirements; lazy-reader and mutation checks remain.

The 81-case array run, seven offline alias-analysis tests and
[paired extrema gate](../../benchmarks/baselines/2026-09-11-eager-arrays-extrema.json)
also passed. All 59 local links in the results, experiment log, roadmap and
storage contract were checked. This pass evaluated each planned research area;
further conditional work is listed in the roadmap rather than claimed as
implemented. Comparisons are pinned to main `9e67783`; independent later main
commits and its in-progress graph edits were not changed or included in these
measurements.

## Earlier checkpoint: unchanged numerical demos

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

## Earlier checkpoint: host-array tradeoff

This private-only design was replaced by the owner-approved internal boundary
above. The measurements below explain the decision; they are not outstanding
acceptance requirements for the current representation.

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

Kept: eager numeric checks and inline arithmetic sum fusion; tensor-cell
coordinate copying; transpose coordinate reuse; synchronous operand collection
and unary extrema; one reusable continuation for suspended binary operands.
The log gives the tests and measurements for each checkpoint.

Rejected and rolled back: compact real/boolean buffers with slower consumers;
short-vector caches whose small gain did not justify more cache state;
generated JS for a narrow private sum whose limited warm gain did not justify
dynamic code; condition composition that either gained too little or regressed
the existing direct path. Private ownership/exposure tracking was later removed
after the owner clarified the internal JS boundary; a short-array size cutoff
was also rolled back. Rejected patches and measurements remain in the repo.

The offline alias-analysis prototype remains a research tool, with no runtime
cost. It found no unaffected fresh-array candidate among the 51 bindings in its
249 parsed functions. More precise type/effect contracts need a profitable
transformation before a runtime pass is justified. Existing unparseable demo
drafts are listed in its report; passing demo tests does not certify drafts.

## Historical verification at the recursion checkpoint

`npm test` passed 43 parser and 445 interpreter tests. The demo runner passed
all 200 test files. The standalone alias-analysis suite passed seven tests.
The final numerical report passed all independent oracles and all six
judge-scale cases passed. Tests include operand order, errors, resource
cleanup, host getters/proxies, deep recursion and tail calls.

New tests check the execution tasks themselves, so an extra continuation is
caught without relying on a noisy timing threshold. The remaining storage
acceptance work must preserve these semantics and the measured demo gains.
