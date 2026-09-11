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

## 2. Sequence numeric kernels: experiment in progress

Hypothesis: selecting the existing arithmetic kernel for sequences, as already
done for arrays, avoids repeated scalar dispatch. A guarded nonnegative BigInt
power can also bypass real-domain checks. Negative or real powers must retain
the existing error path. This is a smaller first experiment than cross-statement
fusion and directly matches Euler's profile. Keep it only after paired demo
measurements and semantic tests.

## Remaining experiments

Continue with builtin-sum fusion where it matches measured array workloads,
compact numeric storage, measured indexing/transpose paths, guarded generated
loops, and finally conservative mutation/alias analysis. Record failed attempts
here and remove their production code. No blanket performance claim follows
from the baseline or from a passing timeout.
