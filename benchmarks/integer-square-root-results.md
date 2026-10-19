# Exact integer square roots and scalar array application (#333)

Measured on 2026-10-19 with Node v24.15.0 on Apple M5. The baseline is
`d6c27f08` (tree `97aecea9`, identical to main `a3c63d7f`); the candidate is
`cd739c2b`. Later documentation changes do not change the measured runtime.

The host had substantial unrelated CPU and memory load during this series.
These are **contended-host measurements**, not estimates of idle-machine
latency or a portable speed guarantee. All samples are retained. No other
benchmark, test or build from this task ran concurrently with the series.

## Workloads and method

```rank
use numbers
use sequences
Xs = 1 to 5000000 array
Ys = 31250000000000000 - Xs * Xs
```

The driver runs two separate workloads in fresh processes, with three samples
per version/workload and alternating baseline/candidate order:

- `sum`: execute `Ys isqrt sum` and check the exact answer.
- `materialize`: execute `Ys isqrt`, then force all 5,000,000 result cells
  through `.items`. Stop the operation timer only after materialization.
  Verify sample square inequalities and sum every root outside that timer.

Both produce `883765608673157`. Setup (input construction/arithmetic) is
separate from operation time. Cold time includes process creation, imports,
setup, operation, validation and disposal. No diagnostics/inspection hooks
are installed during timing. Each worker has a 180-second timeout.

The raw JSONL records Node/CPU, source-tree identities, input and driver SHA256,
and every sample. It is committed at
[`baselines/2026-10-19-integer-square-root.jsonl`](baselines/2026-10-19-integer-square-root.jsonl).

## Medians

| Measurement | Baseline | Candidate | Speedup |
| --- | ---: | ---: | ---: |
| `Ys isqrt sum`, operation | 48.609 s | 4.317 s | 11.26x |
| Full root-array materialization, operation | 25.044 s | 3.582 s | 6.99x |
| `sum`, cold process | 60.607 s | 14.129 s | 4.29x |
| Materialization, cold process | 31.943 s | 11.311 s | 2.82x |

Input setup medians were 8.606/7.675 s (sum workers) and 4.206/4.264 s
(materialization workers). The variability and different absolute workload
latencies reflect the machine load; the operation and cold timings must not
be conflated. Both measured operation medians exceed the issue's 5x target.
Cold startup/setup do not. Peak heap/RSS was not measured.

## What changed

`integerSquareRoot` uses a floating seed only below `2^63`. The seed's integer
root fits safely in Number, but the input and its square need not. BigInt
correction loops establish `r*r <= n < (r+1)*(r+1)` before returning a BigInt.
No assumption that one correction suffices is required for correctness.
Larger inputs retain the original integer Newton iteration.

That arithmetic change alone left most of the array cost intact in the review
prototype. Rank-0 application previously used general ranked-cell assembly:
coordinate arrays, per-cell shape checks and a Map of results. The refactor
moves that assembly into `ranked-cells.ts` without changing its behavior.

The new internal scalar-builtin registration opts only `isqrt` into a checked
stored-array path. Canonical scalar frames use direct reads and retain source
dependency tracking, the first cell's shape/error boundary, and lazy errors in
unread cells. Streaming retains no per-element result Map. A requested full
materialization stores the complete array once; it does not duplicate its cells
in a Map. Partial reads may recompute pure roots.

Prepared stored readers are refreshed when the source revision changes.
Materialization can reuse one reader for a synchronous pass with no user
callbacks or inspection. Atomics cancellation remains cooperative. Arbitrary
host polling uses ordinary reads so mutations remain visible. Unsupported
storage, user functions, overridden implementations, noncanonical axes and
inspection use ordinary ranked dispatch. Sequences keep their existing path.
There is no new syntax, NativeFunction field or public embedding API.

## Verification

The permanent tests compare more than 20,000 boundary/random inputs against an
independent integer-only Newton oracle and the square inequalities, including
perfect-square neighborhoods, `2^53`, `2^63`, and very large fallback inputs.
They also cover lazy errors, missing/type/domain failures, empty and permuted
frames, COW aliases, source writes, materialization invalidation, user/native
dispatch, inspection, custom polling and Atomics cancellation.

The first ordinary suite run passed 4,408 tests and found one documentation
line exceeding the manual's 40-column limit. After fixing that line, all 293
manual tests and all 20 new square-root tests passed; generated-reference,
semantic-boundary and application-form checks passed separately. Full PR CI
is the final integration gate.

The unchanged Euler 210 source from the separate Euler worktree was also run
with `R=8`, `24`, `800` and the default `1,000,000,000`, producing `100`, `916`,
`1022626` and `1598174770174689458`. The default used 5,000,000-cell chunks and
completed in 23.694 s on the contended host; this is one integration observation,
not a controlled baseline comparison. The source SHA256 was
`e4e70d65fd6b10d0cff1a65fb2c610c5d64245f643ca613be39d2e5f2257ae45`.
That demo is not added to this branch as part of the interpreter change.

## Reproduction

Build both checkouts before measuring; the CLI/interpreter consumes compiled
`out` files.

```sh
npm run langium:generate
npx tsc -b tsconfig.build.json
node benchmarks/integer-square-root.mjs \
  --baseline=/absolute/path/to/baseline/packages/interpreter/out/index.js
```

Use `--trials=1` for a smoke run. The default is three serial samples of each
workload/version. Correctness is asserted; wall-clock thresholds are not CI
tests because host load and runtime version affect them.
