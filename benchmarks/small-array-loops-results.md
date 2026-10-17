# Small array loop measurements

Measured on 2026-10-17, Apple M5, Node v24.15.0.
Baseline: `5517baa4` (main including #289). Candidate runtime: `131c43dd`;
demo rewrites: `90f3b95e`. Later changes add tests and documentation only.

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
| scalar | 1.624 | 1.621 | 1.365 | 1.360 | 170.9 | 169.2 |
| array | 21.054 | 4.295 | 20.781 | 4.029 | 553.1 | 435.4 |
| euler76 | 0.470 | 0.460 | 0.206 | 0.201 | 135.7 | 132.0 |
| euler77 | 0.474 | 0.468 | 0.213 | 0.207 | 138.0 | 136.5 |
| euler78 | 1.639 | 3.916 | 1.376 | 3.628 | 171.3 | 443.4 |

## Interpretation

The fixed array recurrence from #291 improves from about 21.05 s to 4.30 s,
including startup, with all three candidate runs below 5 s. The answer remains
55374. Both sides use exactly the original 488 pentagonal entries and padding;
the runtime comparison does not get credit for trimming the demo generator.

The compiled scalar recurrence remains faster, at about 1.62 s including
startup. The Euler 78 demo now chooses the concise array recurrence: its 3.92 s
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
| scalar | 1.666, 1.620, 1.624 | 1.629, 1.621, 1.621 |
| array | 20.776, 21.065, 21.054 | 4.295, 4.279, 4.299 |
| euler76 | 0.470, 0.467, 0.470 | 0.465, 0.460, 0.460 |
| euler77 | 0.474, 0.476, 0.473 | 0.471, 0.468, 0.467 |
| euler78 | 1.633, 1.639, 1.812 | 3.915, 3.916, 3.940 |
