# Optimization experiments, September 2026

This log records the autonomous pass through the [roadmap](performance-roadmap.md).
The starting runtime is `f257042`. Work is on `perf/demo-roadmap` in a separate
worktree. Unrelated Euler additions in the main checkout are outside this pass.

## 1. Unchanged numerical demos: baseline collected

Run `npm run bench:numerical`. To compare a built checkout, add
`-- --baseline=/absolute/path`. The harness calls the functions from the unchanged
DeepML files and runs the unchanged Euler source with `--limit`. It checks every
answer against a JS loop or closed-form reference. Matrix multiplication also
checks the result shape. Lazy outputs are forced inside the compute timer.

Five warm samples follow one first call and two warmups. Five fresh processes
measure cold execution. Cold timing includes Node startup, imports, input setup,
the independent reference calculation and validation; it is not pure interpreter
time. Euler's warm samples also include parsing. Other warm samples time function
calls. Peak RSS includes the whole process; the final heap snapshot is not an
allocation count. Baseline/candidate cold process order alternates by sample.
Warm samples are grouped by runtime, with version order reversed at alternate
sizes; repeat comparisons in reverse order before accepting small gains.

Apple M5, Node 24.15.0. [Raw baseline](../../benchmarks/baselines/2026-09-11-numerical-demos-before.json):

| Unchanged demo | Input sizes | Warm medians, ms |
| --- | --- | --- |
| Euler 006 | Limit 100 / 20,000 / 200,000 | 0.5 / 2.2 / 15.5 |
| DeepML 004, rows | square 8 / 128 / 512 | 0.1 / 1.4 / 12.5 |
| DeepML 004, columns | square 8 / 128 / 512 | 0.1 / 1.4 / 13.0 |
| DeepML 009 | square 4 / 24 / 64 | 0.3 / 18.3 / 314.8 |
| DeepML 015 | 16 / 256 / 2,048 rows, 8 features, 20 steps | 1.2 / 9.8 / 75.1 |

CPU profiles of the largest cases identify different costs:

- Euler: scalar `power` and `evaluateBinary`, plus sequence generator layers.
  The named `Squares` is a lazy sequence, not an allocated arithmetic array.
  Removing array temporaries alone would not help this source.
- Matrix mean: `coordinates` and `tensorEntries` dominate sampled compute.
- Interpreted matrix multiplication: execution-task advancement, generator
  allocation/GC and selectors dominate. Compact storage alone cannot remove them.
- Gradient descent: transpose coordinates, transpose materialization and file
  discovery occur repeatedly. These deserve experiments before code generation.

Profiles are diagnostic samples, not speed comparisons. Reproduce a profile with
`node --cpu-prof benchmarks/numerical-demos.mjs --worker=gradient --scale=2`.
Other worker names are `euler`, `row`, `column` and `matmul`.

## 2. Sequence numeric kernels: benefit reproduced

Hypothesis: selecting the existing arithmetic kernel for sequences, as already
done for arrays, avoids repeated scalar dispatch. A guarded nonnegative BigInt
power can also bypass real-domain checks. Negative or real powers must retain
the existing error path. This is a smaller first experiment than cross-statement
fusion and directly matches Euler's profile.

Two paired comparisons used five warm samples per size. Euler at 200,000 fell
from 15.7 to 11.0 ms, then from 15.5 to 11.4 ms with the runtime order reversed:
26–30% less warm time. The second comparison's cold process median fell only 4%;
startup and setup remain in that measurement. At Limit 100 the second warm pair
was unchanged. The first pair was slightly slower at this small size.

The full numerical control comparison ranged from 5.7% faster to 8.2% slower
(the slower case was row mean at 512 square). No gain is claimed for these
controls. Their cold medians ranged from 2.3% faster to 1.4% slower.

Raw results: [first Euler pair](../../benchmarks/baselines/2026-09-11-sequence-kernel-euler-first.json),
[full reversed-order pair](../../benchmarks/baselines/2026-09-11-sequence-kernel-numerical.json).
All 432 JS tests and 164 demo files passed. New tests cover nonnegative integer
powers, exact large integers, negative/real-domain failures, empty sequences,
mixed arithmetic, both scalar sides, zipped sequences and repeated named sums.
The [row-mean repeat](../../benchmarks/baselines/2026-09-11-sequence-kernel-row-repeat.json)
reversed order: 15.3 to 15.0 ms at 512 square. The earlier 8% slowdown did not
repeat; absolute times rose for both runtimes. No row-mean speedup is claimed.

Scalar controls also passed. Five-sample extrema/alias controls ranged from
3.7% faster to 4.0% slower; playlist was 0.8% slower. Recursion `tree` was
37.4 ms in both versions; tail calls were 22.7 to 22.6 ms and accumulator tail
calls 25.8 ms in both. Ordinary calls were 14.8 to 15.4 ms. Memo manual/fresh
medians were 129.4/83.5 to 128.6/84.2 ms; cached calls were 0.2 ms in both.

All six CSES-scale checks passed at 200,000. One cold baseline/candidate pair
(ms): restaurant 2704.8/2624.9, rooms 2120.6/2061.8, playlist 541.4/511.8,
books 203.6/198.6, bounded-sum 935.7/914.9, sum 192.5/189.4. Single samples
are smoke checks, not evidence of an improvement. Source and benchmark changes
are kept; broader fusion remains conditional on a matching demo workload.

## Remaining experiments

The independent matvec oracle found a correctness bug in DeepML 001:
`Row * B sum` parses as `Row * (B sum)`. The official example returned nested
rows `[3, 6]` and `[6, 12]` instead of `[5, 10]`. Its Rank test returned a tensor
of false values, which the scalar-boolean assertion mechanism did not reject.
The demo is corrected to `(Row * B) sum` in a separate correctness commit, with
an internal JS test comparing exact scalar result items. This change is not an
interpreter optimization and is not counted as a speedup. Future matvec timing
uses the same corrected source against both runtimes, with source hashes saved.
Other array-valued demo assertions still need a separate correctness audit.
Correction commit: `96d1dc2`. The independent JS test passed. The corrected
matvec baseline at square sizes 8/128/512 was 0.1/2.4/26.5 ms warm; largest
peak RSS was 278.3 MiB. [Raw samples](../../benchmarks/baselines/2026-09-11-matvec-corrected-before.json).

Next, measure the corrected DeepML 001. It provides a program for builtin-sum
fusion that the initial four-demo shortlist missed. DeepML 017
also has `(D * D) sum`, but `D` is a named lazy arithmetic result, so it adds
cache and effect constraints. Builtin `sum` materializes its array before
validating numeric elements; the explicit `+ reduce` path reads one element
at a time. A fusion experiment must preserve this difference, including host
getters and shadowed `sum` functions.

Continue with builtin-sum fusion where it matches measured array workloads,
compact numeric storage, measured indexing/transpose paths, guarded generated
loops, and finally conservative mutation/alias analysis. Record failed attempts
here and remove their production code. No blanket performance claim follows
from the baseline or from a passing timeout.
