# Seven nightly slowdowns, 6 November 2026

The selection uses the report captured from https://rank.viewflow.io/bench/
at the start of this investigation. Compare `fbc7621940c6` (started
2026-11-04 22:00 UTC) with `fa79cd791e20` (started 2026-11-05 22:00 UTC).
These are the 5 and 6 November runs in Asia/Almaty. The newer run was still
running. Rank successful workloads by relative increase in execution time;
exclude errors and timeouts. All seven source and workload hashes match.

| Euler | Previous ms | Report ms | Increase |
| --- | ---: | ---: | ---: |
| 700 | 867.85 | 1371.70 | 58.1% |
| 212 | 14802.74 | 23141.71 | 56.3% |
| 645 | 456.74 | 704.13 | 54.2% |
| 234 | 768.03 | 1154.91 | 50.4% |
| 245 | 12310.78 | 17537.23 | 42.5% |
| 283 | 9298.34 | 13020.99 | 40.0% |
| 695 | 954.62 | 1304.34 | 36.6% |

## Causes and changes

`bff39e70` admitted borrowed packed inputs beside private writes. Its common
integer reader checked the representation of every loaded cell. Euler 212,
for example, borrows `Hs` while repeatedly reading already prepared arrays
inside its segment-tree sweep. The CPU profile includes this common reader
on the hot path. Bind a reader separately for each array: borrowed slots
retain precision checks; prepared slots use an identity reader. Private
writes, overflow replay and observable polling retain their existing rules.
This addresses the shared scalar-loop cost in 212, 245 and 283.

`c8939c0c` added numeric layout consumers. Euler 234 speculated on a sum
with wide integer inputs, paying for conversion before falling back to exact
arithmetic. Disabling just that speculative layout sum restored its previous
performance in a separate experiment. Limit eager conversion for layout sums
to 64 cells per non-Int32 integer input. Larger wide inputs use the existing
exact consumer. Int32 inputs and small inputs keep numeric execution; copy,
selection and ordinary rank-one numeric consumers retain their existing paths.
The limit is a conservative cost policy, not a numeric correctness bound.
It can forgo speedups on large wide inputs whose sums happen to fit Number.

The nightly increases for 700, 645 and 695 did not consistently reproduce in
paired runs. No workload-specific change is made for them. Background work
was visible on both benchmark hosts; on Intel, nightly execution and other
Euler benchmarks overlapped this investigation. CPU affinity reduces CPU
migration but does not remove shared cache, frequency or memory interference.
Do not interpret every difference in these timings as a code regression.

Restoring the older loop-outlining policy did not repair the Intel slowdown
and was rejected. Replacing every reader with a checked numeric conversion
also failed to restore the hot loops. Neither experiment is in the patch.

## Verification and reproduction

Build each checkout independently, then run:

```sh
node benchmarks/experiments/nightly-seven.mjs BEFORE AFTER
```

The runner alternates order across three pairs, launches one fresh CLI
process at a time, times parsing and execution after imports, and checks all
seven full answers. Intel runs use Node 24.15.0 and CPU 4 affinity; Mac runs
use Apple M5 and Node 24.15.0. The patch starts at `5e4a0cb1`, which includes
changes newer than the nightly report. Historical checkouts were also run to
separate those changes from the original overnight regression.

Focused verification: 750 tests across the 22 numeric-loop and scalar-kernel
files; deferred bindings (26), tensor number mode (6), and deferred native
tensors (27), including the new large-wide-sum regression. TypeScript build,
semantic boundaries and application-form checks pass. No full suite or
exhaustive audit was run.

## Final paired measurements

Median milliseconds from three fresh processes per version. All full answers match.

| Euler | Mac report | Mac fixed | Intel report | Intel fixed | Intel reduction |
| --- | ---: | ---: | ---: | ---: | ---: |
| 700 | 312.94 | 340.64 | 956.63 | 962.03 | -0.6% |
| 212 | 9010.64 | 5154.01 | 25385.69 | 15983.36 | 37.0% |
| 645 | 106.67 | 110.62 | 520.59 | 514.58 | 1.2% |
| 234 | 335.18 | 191.63 | 1311.79 | 807.78 | 38.4% |
| 245 | 5730.61 | 5950.85 | 19430.58 | 13853.77 | 28.7% |
| 283 | 6933.05 | 3808.91 | 14430.02 | 10459.33 | 27.5% |
| 695 | 235.33 | 235.95 | 1096.99 | 1086.51 | 1.0% |

Euler 245 improves on Intel but does not show a Mac speedup in these samples.
The small changes for 700, 645 and 695 are not treated as improvements.
Mac timing noise was larger; no run was discarded from the final series.

Raw measurements: `baselines/2026-11-06-nightly-seven.json`.
