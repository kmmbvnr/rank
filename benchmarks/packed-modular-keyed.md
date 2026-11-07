# Packed modular keyed folds

Dense `reduce` and `scan` with integer group keys and an outer `mod` now use
their packed Int32 buffers directly. Addition and multiplication reduce each
state into the modulus; a wide negative seed is reduced exactly once. The
existing modular multiply handles products beyond Number's exact range.
This native primitive works in the reference interpreter without generated JS.

Eligibility requires completed Int32 values and keys of the same shape, a
positive modulus up to 2^30, and no column/selection metadata. The kernel
validates keys before allocating its private group states. Large sparse key
domains retain the ordinary fold, keeping scratch space proportional to input.
Budgets, inspection, observable polling and SharedArrayBuffer inputs also
retain the ordinary path. Cancellation checkpoints remain between blocks.

The benchmark groups 2,000,000 values into 4096 groups, with modulus
1000000007 and seed 1, then sums the groups. Three alternating before/after
pairs run in fresh Node v24.15.0 processes, with compilation disabled. Timing
includes parsing, constructing the inputs, grouping and summation. Each result
is checked against an independent BigInt calculation outside the timed region;
peak RSS is captured before that oracle. The answer is 2092769469577.

| Host | Before, ms | After, ms | Before RSS, MiB | After RSS, MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac / arm64 | 439.92 | 113.39 | 300.97 | 206.03 |
| Intel / x64 | 1391.15 | 315.51 | 263.21 | 181.70 |

Values are medians, not best runs. The isolated baseline is `66ec8383`; the
after build contains only this change, excluding other Euler 445 prototypes.
The raw 12 records are in `baselines/2026-11-07-packed-modular-keyed.json`.
Intel before-run vmstat samples are retained. Both versions have zero compiled
loop/tensor counts; only after has one native integer keyed-fold admission.

Run with `node benchmarks/packed-modular-keyed.mjs`. Set `RANK_BENCH_RUNTIME`
to a control runtime's `out/index.js` file URL for comparison. Packed input
construction is explicit: completing the modulus before adding 1 avoids the
unrelated wide-storage path of one composed range expression.

Validation: isolated build and 295 focused tests in 10 files on both hosts.
Tests cover addition/product, reduce/scan, matrices, modulus 1 and 2^30,
negative values and seeds, empty inputs, wide values/moduli, key errors,
sparse domains, foreign headers, shared buffers, budgets and interruption.
Exhaustive audits were not run. Euler 445's source and issue row remain
unchanged; its algorithm and peak-memory tradeoffs are still being evaluated.
