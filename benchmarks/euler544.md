# Euler 544: bounded chromatic-polynomial samples

Base: `5bd893497f3d6b6891a5b4ac3be005d03eb3bf99`.
Default: a 10 by 9 grid, summing colourings for 1 through 1112131415
colours, modulo 1000000007. Exact result: **640432376**.

The exclusion's historical 75-second estimate was stale. The current base
already needed about 6.1 seconds compiled on the Mac. Its remaining work
rebuilt the same frontier transitions, tracked global colour-class counts,
and gathered/shifted a full 92-column DP matrix at each cell.

The new program evaluates the chromatic polynomial at consecutive colour
counts instead. A new frontier class has `q - used` available colours;
joining an existing allowed class has weight one. The polynomial's prefix
sum has degree at most R*C+1, so consecutive-node Lagrange interpolation
recovers the answer. This degree is below P-1 for these grids, making the
sum periodic modulo P. Small N uses only the needed samples.

The transfer graph repeats by column after two complete rows. A seeded
scan constructs this finite graph once. Its records contain completed
arrays for existing/new source and target rows; DP never rebuilds them.
First-occurrence labels use reversed duplicate writes followed by a prefix
scan, replacing both nested relabelling loops and a large comparison cube.
The narrower grid side is the frontier. One explicit loop processes cells
and sample blocks; Rank lines stay within 40 columns.

Blocks of 32 colour samples bound DP temporaries. In exploratory Mac
runs, blocks 16/32/64 took 5.22/5.01/6.27 seconds with peaks of
399/408/469 MiB before the final transition-record cleanup. These are
single exploratory samples, not the final paired results below.

A shared compiled assignment fast path now reads trusted Int32 operands
without boxing every value into BigInt and immediately converting it back
to Number. Safe partial sums/products remain exact; promotion to BigInt
occurs before unsafe arithmetic, including after a previously widened
bucket. Selector/RHS snapshots, validation and observable polling guards
are unchanged. This benefits dense accumulating writes in other programs.

## Measurements

Node v24.15.0 on both hosts. Three alternating fresh-process old/new pairs
per mode; each run checks the exact result. Wall time includes parsing and
execution, excludes importing the interpreter. RSS is the process high-water
mark. Diagnostics/profiling are disabled. No other Node processes appeared
in any Intel sample; its load was 0.58-1.22 during these measurements.

| Host/mode | Old seconds | New seconds | Old RSS MiB | New RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac arm64, compiled | 6.104 | 5.320 | 415.8 | 399.7 |
| Mac arm64, reference | 6.935 | 5.241 | 398.0 | 384.8 |
| Intel x64, compiled | 15.146 | 13.270 | 393.4 | 383.4 |
| Intel x64, reference | 17.672 | 13.511 | 378.0 | 376.5 |

CPU-time medians (user+system), old/new seconds: Mac compiled 9.044/6.650,
Mac reference 11.066/6.551, Intel compiled 21.534/16.159,
Intel reference 26.592/16.435. Peak memory improvements are modest,
especially for Intel reference; the primary gain is less CPU work.

A single new-source/old-runtime control took 5.461 seconds / 397.7 MiB on
the Mac and 13.736 seconds / 387.1 MiB on Intel. Most of the full-grid gain
comes from the program rewrite. The separate dense-update fixture checks
1.6 million Int32 updates to 200000 destinations, with exact sum
1279999200000. Three alternating pairs isolate the shared runtime change:

| Host | Old ms | New ms | Old RSS MiB | New RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac arm64 | 224.673 | 107.845 | 227.4 | 201.1 |
| Intel x64 | 577.670 | 270.113 | 212.6 | 187.2 |

## Verification and reproduction

The focused suite covers brute-force colourings, transposed and empty
grids, zero/one/two colours, both statement examples, polynomial
interpolation across a full field period, and the full result in Number,
exact and reference modes. Accumulation regressions cover packed/reversed
operands, aliases, negative factors, widening and exact wide arithmetic.
The full demo is restored to ordinary corpus execution.

Passed: TypeScript build; 203 focused checks on Mac and the same 203 on
Intel; two filtered differential checks (full demo and its fixture).
The exhaustive audits and full npm test were not run.

From the repository root:

```sh
node node_modules/typescript/bin/tsc -b packages/interpreter/tsconfig.json packages/interpreter/tsconfig.test.json
node benchmarks/euler544.mjs compiled
node benchmarks/euler544.mjs reference
node benchmarks/euler544.mjs compiled 1112131415 benchmarks/fixtures/euler544-original.ra
RANK544_EXPECTED=1279999200000 node benchmarks/euler544.mjs compiled 1112131415 benchmarks/fixtures/euler544-dense-updates.ra
```

`RANK544_RUNTIME` selects another built runtime; `RANK544_R` and
`RANK544_C` change the grid. `RANK544_EXPECTED` checks a golden answer.
`RANK544_DIAGNOSTICS=1` and `RANK544_PROFILE=path` enable separate diagnostic
runs. Frozen base binaries were built from the base commit above.
Raw samples are in `baselines/2026-11-09-euler544.json`.
