# Euler 337: guarded numeric `band` (#364)

Measured on Apple M5, Node 24.15.0. Baseline: `74edcc96e491d0fda5e4ed12175f0fed7f624c34`;
candidate: that revision with signed-Int32 `band` lowering in the existing Number
loop backend. The demo source is unchanged. Each sample runs in a fresh process,
serially; execution includes parsing, CLI binding, initialization and printing,
but excludes process startup and imports. Diagnostic runs are separate.

| Limit | Baseline | Candidate | Speedup | Samples per variant |
| --- | ---: | ---: | ---: | ---: |
| 1,000,000 | 3.311 s | 1.454 s | 2.28x | 3, median |
| 20,000,000 | 89.255 s | 23.307 s | 3.83x | 1 |

Both variants return `23116575` at one million and `85068035` at twenty million.
The full-size comparison is a single sample per variant, not a median.
Candidate diagnostic runs verify that both the sieve and Fenwick DP use the
Number backend, with zero overflow replays and zero typed-storage unpacks.

Large arrays already use BigInt64 storage in the baseline. The change removes
BigInt arithmetic and native-call dispatch from the inner Fenwick traversal by
inlining `band` for signed-Int32 operands. Wider operands discard the private
attempt and replay through the existing exact backend. Builtin identity checks
remain in place. The optimization applies to eligible loops generally.

This is a speed improvement with a memory cost. After-run process RSS at full
size was 806 MiB for the baseline and 1126 MiB for the candidate. These are
snapshots, not peak measurements. The existing Number backend stages array
updates in private Float64 buffers with dirty-cell maps; no array representation
or buffer-publication behavior was changed. Reducing that temporary storage
would require a separate change to numeric-buffer preparation/publication.

Reproduce after building:

```sh
npx tsc -b tsconfig.build.json
node benchmarks/totient-stairs.mjs --quick
node benchmarks/totient-stairs.mjs --limits=1000000 --trials=3 --baseline=/absolute/path/to/baseline/out/index.js
node benchmarks/totient-stairs.mjs --limits=20000000 --trials=1 --baseline=/absolute/path/to/baseline/out/index.js
```

The baseline must retain its package dependencies. The saved samples used a copy
of the baseline interpreter's compiled `out/` and the workspace dependencies.
Source SHA-256 and machine information are recorded with the raw samples:
[one million](baselines/2026-10-21-totient-stairs-million.jsonl),
[twenty million](baselines/2026-10-21-totient-stairs-full.jsonl).

Validation: the three supplied checkpoints (10, 100, 10000) agree across the
reference interpreter, BigInt loops and Number loops. Regression tests cover
signed boundaries, wider operands, overflow after prior mutations, aliasing,
operand errors, short-circuit evaluation, rebound builtins and cancellation.
The ordinary interpreter suite passes 250 files / 4903 tests; the separate
exhaustive type, differential and Nurikabe audits were not run for this change.
