# Small array loop measurements

Measured on 2026-10-17, Apple M5, Node v24.15.0.
Baseline: `5517baa4` (main including #289). Candidate: [PR #299](https://github.com/kmmbvnr/rank/pull/299), including the
follow-up fix distinguishing dyadic min/max from reduction terminals.

Build both checkouts, then run the candidate benchmark driver against each:

```sh
node benchmarks/small-array-loops.mjs --root /path/to/built/baseline
node benchmarks/small-array-loops.mjs --root /path/to/built/candidate
```

Each case uses three fresh processes, sequentially, with tests/builds/profilers
stopped. Every run checks the answer. Process time includes module startup;
execute time starts immediately before parsing/execution. RSS is the process
high-water mark, not live heap size. These local timings are not CI gates.

| Case | Before process s | After process s | Before execute s | After execute s | Before max RSS MiB | After max RSS MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| scalar | 1.624 | 1.618 | 1.365 | 1.356 | 170.9 | 168.3 |
| array | 21.054 | 4.213 | 20.781 | 3.952 | 553.1 | 435.6 |
| euler76 | 0.470 | 0.458 | 0.206 | 0.197 | 135.7 | 132.0 |
| euler77 | 0.474 | 0.460 | 0.213 | 0.204 | 138.0 | 136.4 |
| euler78 | 1.639 | 3.834 | 1.376 | 3.552 | 171.3 | 443.6 |

## Interpretation

The fixed array recurrence from #291 improves from about 21.05 s to 4.21 s,
including startup, with all three candidate runs below 5 s. The answer remains
55374. Both sides use exactly the original 488 pentagonal entries and padding;
the runtime comparison does not get credit for trimming the demo generator.

The compiled scalar recurrence remains faster, at about 1.62 s including
startup. The Euler 78 demo now chooses the concise array recurrence: its 3.83 s
is slower than the former scalar demo (1.64 s), but meets the issue target. Its
additional improvement over the fixed array benchmark comes from trimming the
generator to entries <= Limit. This is a readability tradeoff, not a claim that
the array version has overtaken compiled scalar loops.

Euler 76 and 77 replace floating triangular solves/rounding with exact integer
recurrences. Their default timings are similar; tests additionally check
p(300) - 1 = 9253082936723601 and prime partitions of 1000 = 48278613741845757.

The runtime uses existing exact scalar arithmetic. Small stored numeric
operations materialize; comparison masks remain lazy/read-only. Vector dot
products avoid tensor-coordinate allocation and can borrow trusted selections
without per-cell caches or whole-source type scans. Other readers retain
ordinary read/effect order. The owner approved removing the separate guarantee
that external JavaScript storage writes update earlier Rank formulas; Rank
assignments, COW, binding checks and retained-view snapshots remain supported.

## Samples

Process seconds, in run order:

| Case | Before samples | After samples |
| --- | --- | --- |
| scalar | 1.666, 1.620, 1.624 | 1.618, 1.611, 1.619 |
| array | 20.776, 21.065, 21.054 | 4.211, 4.213, 4.230 |
| euler76 | 0.470, 0.467, 0.470 | 0.458, 0.458, 0.456 |
| euler77 | 0.474, 0.476, 0.473 | 0.465, 0.459, 0.460 |
| euler78 | 1.633, 1.639, 1.812 | 3.850, 3.834, 3.832 |
