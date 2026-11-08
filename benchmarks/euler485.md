# Euler 485: bounded divisor stages and native affine updates

[Euler 485](https://projecteuler.net/problem=485) asks for the sum of maximum divisor counts across width-100000 windows through 100000000. The full answer is **51281274340**. The original segmented divisor sieve and linear van Herk window maxima were already sensible algorithms. This change reduces array traffic, interpreter work and the working-set size; it does not replace an asymptotically naive window search.

## Program

The small-prime powers are prepared once as array operations. A block starts with divisor counts of one and the remaining integers. At stage p^e, earlier stages have contributed the factor e; dividing by e and multiplying by e+1 adds the next choice of exponent. Dividing the remaining integers by p at each applicable stage leaves at most one larger prime. A final mask doubles its divisor count.

This removes the separate exponent-count and small-prime-product arrays and their gathered vector operands. One indexed loop traverses the stages. A scalar guard skips powers with no multiple in the block. It avoids creating an empty selector and evaluating three empty writes. The separate division and multiplication are deliberate: combining them into a larger RHS was slower, especially without compilation.

Each block handles a disjoint range of window starts and includes the following K-1 integers. `Starts block rank 0 sum` consumes independent scalar block results, releasing their temporary arrays. There is one explicit loop and no nested Rank loops. All Rank lines fit within 40 columns. Existing U/K/Bs inputs and statement/cross-block fixtures remain compatible. The default block size drops from ten million to one million.

Smaller blocks alone do not explain the result. With the original source forced to one-million blocks on Mac, an exploratory compiled run still took 14.07 seconds and 532 MiB on the baseline runtime (11.82 seconds and 483 MiB on the changed runtime). The original default uses ten-million blocks; the controlled results below retain that original default.

## Shared runtime

Scalar Int32 updates over a proved affine selection now choose the arithmetic operation outside the hot cell loop and advance an address directly. The scalar is checked once. Every result must still fit Int32; the first widening cell continues through the existing exact tail without replaying committed cells. Descending and repeated addresses retain their established write semantics. Opaque host polling and demand budgets retain the existing per-cell paths.

Native affine view copies likewise walk their proved offset/stride without invoking the general address decoder for every cell. This covers Int32, Int64 and real storage, including reversed and repeated cells. Bounds, uniform contracts, ownership and the existing fallback remain guarded. The same runtime primitives serve interpreted array operations and compiled loops.

Four stale diagnostic expectations reproduced on clean baseline 06fbf90a. Reference execution already supports native compound and indirect writes. The tests now assert the implemented admission rules, retain an independent opaque-polling state oracle, and explicitly exercise observable polling over more than one cancellation interval. No interpreter correctness assertion was removed.

## Full-scale controls

Baseline: **06fbf90a5cd995a8397dd6fde62c609c5df79621**. Compiled times and peak RSS are medians of three alternating fresh-process rounds. Reference values are single fresh-process samples. Both hosts had background work; Intel had an active ZFS scrub. These are loaded-host comparisons, not idle-host absolute timings. Node version, CPU time, load, free memory, source hashes and kernel hashes are retained in the raw artifact.

| Host | Mode | Change | Seconds | Peak MiB |
| --- | --- | --- | ---: | ---: |
| Mac | compiled | original | 12.622 | 2041.6 |
| Mac | compiled | compiler-runtime-only | 9.203 | 2040.1 |
| Mac | compiled | demo-only | 4.598 | 342.2 |
| Mac | compiled | final | 4.662 | 343.7 |
| Mac | reference | original | 11.006 | 1919.6 |
| Mac | reference | compiler-runtime-only | 8.891 | 1919.5 |
| Mac | reference | demo-only | 6.164 | 381.1 |
| Mac | reference | final | 4.992 | 359.3 |
| Intel | compiled | original | 30.081 | 1363.6 |
| Intel | compiled | compiler-runtime-only | 23.460 | 1396.4 |
| Intel | compiled | demo-only | 12.629 | 322.5 |
| Intel | compiled | final | 12.711 | 342.6 |
| Intel | reference | original | 26.043 | 1333.7 |
| Intel | reference | compiler-runtime-only | 22.275 | 1327.3 |
| Intel | reference | demo-only | 18.581 | 335.6 |
| Intel | reference | final | 14.608 | 344.5 |

A separate two-round alternating comparison selected the scalar empty-stage guard over executing empty stages. Explicit vector filtering was evaluated separately. The guard retained compiled speed and improved reference speed on both architectures. Candidate sources and exploratory measurements, including rejected fused-RHS and product variants, are retained in the raw artifact. Exploratory single runs are not mixed into the final medians.

## Native probes and neighbors

Each probe performs twelve demands over 1048576 selected cells. The first two demands warm the kernel; the table reports the median of the remaining ten. Each side uses a separate process. Scalar writes use stride three; copies use a descending stride of minus three. Setup is outside the timing.

| Host | Probe | Milliseconds, before → after | Peak MiB, before → after |
| --- | --- | ---: | ---: |
| Mac | += | 2.433 → 0.541 | 92.8 → 91.6 |
| Mac | -= | 2.480 → 0.544 | 92.9 → 91.3 |
| Mac | *= | 2.997 → 0.586 | 92.8 → 91.9 |
| Mac | gather-int32 | 2.972 → 0.802 | 140.5 → 140.6 |
| Mac | gather-int64 | 3.187 → 1.107 | 205.0 → 205.0 |
| Mac | gather-real | 3.160 → 0.992 | 204.9 → 204.9 |
| Intel | += | 5.875 → 2.043 | 93.8 → 91.6 |
| Intel | -= | 5.961 → 2.730 | 94.0 → 91.0 |
| Intel | *= | 5.964 → 2.094 | 94.1 → 91.8 |
| Intel | gather-int32 | 6.913 → 3.096 | 141.6 → 139.0 |
| Intel | gather-int64 | 7.461 → 5.512 | 180.6 → 204.2 |
| Intel | gather-real | 7.628 → 4.166 | 204.9 → 204.1 |

Unchanged neighboring sources use three alternating fresh-process pairs on each host:

| Host | Euler | Seconds, before → after | Peak MiB, before → after |
| --- | --- | ---: | ---: |
| Mac | 482 | 3.239 → 3.267 | 1271.9 → 1268.8 |
| Mac | 483 | 4.727 → 4.718 | 631.6 → 621.3 |
| Mac | 484 | 14.329 → 14.251 | 926.8 → 885.2 |
| Intel | 482 | 8.206 → 8.340 | 916.6 → 899.3 |
| Intel | 483 | 12.707 → 12.661 | 586.8 → 581.4 |
| Intel | 484 | 36.690 → 36.263 | 616.3 → 614.2 |

Peak RSS does not fall in every standalone allocation probe: the Intel Int64 gather peak rose from 180.6 to 204.2 MiB. That increase remains recorded alongside the lower full-program peaks. A separate explicit-GC check of the final full Rank program leaves 36.71 → 36.73 MiB of live JS heap and 0.12 → 0.12 MiB of array buffers. Production execution does not force GC.

## Verification

Both hosts passed **505 tests in 22 focused files**, plus the two selected differential cases for the full default and its fixture. Source/test TypeScript builds and five exclusion-catalog checks passed. The full workload returns to ordinary corpus audits. No exhaustive audit was run for this change.

Small independent checks count divisors by enumerating every divisor and inspect every window directly. Cases cover empty input, singleton windows, prime powers, K=U, K>U, tiny blocks, partial final blocks and overlap larger than a block on three execution backends. Existing statement and million-element cross-block fixtures remain unchanged. The full independent C++ oracle uses a linear least-prime-factor sieve followed by a monotone deque, sharing neither the segmented stage traversal nor van Herk scans.

Runtime tests cover scalar and vector writes, wide scalar operands, mid-vector widening, descending/zero strides, aliases, snapshot semantics, errors, cancellation, budgets and observable host polling. Affine copy checks cover all three numeric storage kinds and verify that a native linear address is not decoded per cell.

Concurrent Euler 791 changes added scalar-function admission for an extreme node. After integration, overlapping tests and a full Euler 485 smoke run were repeated on both hosts. That change does not make the array/range-based 485 helper a scalar function kernel. Integration output is retained separately from the controlled measurements.

## Reproduction

Build matching language/interpreter output. From the repository root:

- `node benchmarks/euler485.mjs compiled` or `reference` runs the full default; `RANK485_EXPECTED=51281274340` checks the answer.
- Pass a limit, source path and CLI arguments to test another geometry, e.g. `node benchmarks/euler485.mjs compiled 1000003 demos/euler/485_maxdivisors.ra --k=1000 --bs=77777`.
- `RANK485_RUNTIME=/absolute/frozen/interpreter/out/index.js` selects a frozen runtime with its matching language package.
- `node benchmarks/euler485-compare.mjs /absolute/frozen/interpreter/out/index.js 3 100000000 1` repeats the four-way controls.
- `node benchmarks/euler485-regressions.mjs /absolute/frozen/interpreter/out/index.js 3` checks neighboring workloads.
- `node benchmarks/experiments/euler485-kernels.mjs +=` runs a scalar probe; other modes are `-=`, `*=`, `gather-int32`, `gather-int64`, and `gather-real`.
- `node --expose-gc benchmarks/experiments/euler485-retained.mjs` checks retained storage separately.
- Compile `benchmarks/experiments/euler485-oracle.cpp` with `c++ -O3 -std=c++17`; its default invocation checks the full answer.

Raw data: [2026-11-08-euler485.json](baselines/2026-11-08-euler485.json).
