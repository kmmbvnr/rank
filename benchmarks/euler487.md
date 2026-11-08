# Euler 487: linear modular scans and exact 31-bit modular powers

[Euler 487](https://projecteuler.net/problem=487) retains the full answer **106650212746**, summed over the 100 primes in the original interval. This change improves the array program and the shared modular-power runtime/Number function compiler. Existing CLI inputs and the original fixture remain compatible.

## Program

S_k(n) is a polynomial of degree K+2. Its samples are two cumulative sums of j^K, so interpolate that polynomial directly. The old program interpolated F_k and F_(k+1) separately and combined their results. Nodes still run from zero through K+2, but the zero sample is explicitly zero, including K=0.

A scalar-prime helper lets the existing native `(scan * with Seed) mod Prime` perform linear prefix products. Factorials, inverse factorials, and the two Lagrange numerator sides no longer require O(K log K) matrix passes by doubling shifted rows. The helper uses contiguous one-dimensional arrays; `Primes subtotal rank 0 sum` consumes scalar answers and releases per-prime temporaries. The Rank source has no explicit loops and every line fits within 40 columns.

When the evaluation point is a sampled node, return its value directly. Interpolation needs Prime>K+2 so its factorial denominators are invertible. Smaller primes use an exact one-period weighted sum: for N=q*p+r, every complete block contributes the same sum of (r+1-j)j^K modulo p, and the final partial block covers j=1..r. Only q modulo p is needed. This also handles very large N without a large array.

Two existing correctness gaps are repaired. At K=0, N=10, p=17, the original program returned 15 instead of 4 because it included 0^0 in F_0. The rewritten samples exclude j=0. The small-prime path also avoids attempting to invert a zero factorial. Tests cover both cases and large-N closed forms for K=0 and K=1. The original fixture's answers remain 3 and 123.

## Shared modular-power paths

The old Number multiplication estimates a floor quotient and needs modulus<=2^30 to recover an unambiguous signed low-word remainder. The already-established `multiplyWide` uses a rounded quotient and a centered remainder, which supports every positive modulus through 2^31. Repeated use is exact because each result is again a residue in that domain.

Scalar modular powers and Number-compiled powmod helpers now use that wider multiplier in the newly admitted domain. The <=2^30 squaring cache and inner arithmetic remain in place. Larger moduli, unsafe integer inputs and invalid arguments retain their exact paths and errors. Arbitrary-precision exponents are not rounded into Number.

Packed Int32 bases with one fixed exponent also receive a four-lane wide multiplier path. Simply widening the generic Number mapper was insufficient: an exploratory scalar-only variant took 21.88 ms for the wide array probe on Mac, versus about 13 ms with the dedicated packed path. The production path avoids generic per-cell broadcast dispatch and overlaps independent power chains. Varying exponents keep their existing lower-domain shared-table kernel and can use the general checked wider mapper.

New wide packed admission declines demand budgets, retaining the old fallback work cadence. Opaque polling retains ordinary evaluation. The scalar wide implementation charges the same per-bit checkpoints as the exact BigInt implementation. Tests warm a helper normally before invoking it under a budget, compare preceding caller writes between execution engines, and check cancellation without publishing partial bindings. No global Number-array size threshold was changed.

## Full-scale measurements

Baseline: **8e6d9495060aedddffe8a24c62a76e8fbbd73747**. Compiled entries are medians of three alternating fresh-process rounds. Reference entries are one fresh-process observation per variant. Both hosts had background load, including a ZFS scrub on Intel. Source/kernel hashes, package metadata hashes, CPU time, load and free memory are retained. Both frozen and current interpreter packages use the same manifest, including ES module metadata; early typeless-package exploratory controls were discarded.

| Host | Mode | Change | Seconds | Peak MiB |
| --- | --- | --- | ---: | ---: |
| Mac | compiled | original | 3.1735 | 308.8 |
| Mac | compiled | compiler-runtime-only | 3.1771 | 309.0 |
| Mac | compiled | demo-only | 0.4104 | 254.9 |
| Mac | compiled | final | 0.3818 | 263.8 |
| Mac | reference | original | 3.7081 | 327.0 |
| Mac | reference | compiler-runtime-only | 4.0090 | 315.2 |
| Mac | reference | demo-only | 0.4003 | 251.6 |
| Mac | reference | final | 0.3714 | 257.7 |
| Intel | compiled | original | 7.6121 | 295.8 |
| Intel | compiled | compiler-runtime-only | 7.7472 | 294.2 |
| Intel | compiled | demo-only | 1.3435 | 228.3 |
| Intel | compiled | final | 0.8779 | 234.9 |
| Intel | reference | original | 9.3318 | 298.6 |
| Intel | reference | compiler-runtime-only | 9.3065 | 294.2 |
| Intel | reference | demo-only | 1.3312 | 223.8 |
| Intel | reference | final | 0.8620 | 228.6 |

Most of the full-program gain comes from the rewrite. The shared paths additionally help the rewritten fixed-modulus workload, especially on Intel. Runtime-only execution of the old matrix source is close in compiled mode; its single Mac reference sample is slower. The table retains that observation rather than claiming every mode improves. The original issue's roughly 21-second measurement predates the current baseline and is not attributed to this change.

A later follow-up repeated three alternating compiled rounds after the Intel ZFS scrub finished. Before the run, CPU idle was 99% and load average was 0.06/0.12/1.01. Median seconds / peak MiB were: original 7.574 / 295.4, runtime-only 7.470 / 301.8, demo-only 1.350 / 227.8, and final 0.835 / 233.2. Final times ranged from 0.821 to 0.858 seconds. This confirms the main gain without the earlier background scrub; reference mode and neighboring workloads were not repeated in this follow-up. Raw data is retained as `intelIdleFollowup`.

## Native probes and neighboring workload

Each array probe computes 131072 powers; each scalar-helper probe sums 10000 powers inside a compiled loop. The exponent is 10000, with modulus 1000000007 for `small` and 2000000011 for `wide`. Each side uses a separate process, two warmup demands and the median of five subsequent demands. Checksums must match. Setup is outside the timer.

| Host | Probe | Milliseconds, before → after | Peak MiB, before → after |
| --- | --- | ---: | ---: |
| Mac | array-small | 3.060 → 2.961 | 141.2 → 140.9 |
| Mac | array-wide | 14.182 → 13.262 | 173.6 → 141.4 |
| Mac | scalar-small | 1.638 → 1.668 | 143.1 → 142.5 |
| Mac | scalar-wide | 4.764 → 2.783 | 175.9 → 143.2 |
| Intel | array-small | 7.770 → 7.330 | 129.8 → 130.9 |
| Intel | array-wide | 83.529 → 23.244 | 161.4 → 128.8 |
| Intel | scalar-small | 4.305 → 4.240 | 131.9 → 131.8 |
| Intel | scalar-wide | 16.783 → 5.895 | 160.0 → 130.5 |

The unchanged Euler 486 program exercises the older small-modulus paths in three alternating fresh-process pairs:

| Host | Milliseconds, before → after | Peak MiB, before → after |
| --- | ---: | ---: |
| Mac | 171.9 → 171.3 | 185.5 → 185.6 |
| Intel | 447.9 → 461.9 | 171.4 → 170.4 |

The Intel neighbor median rose by about 3%; the Mac median stayed close. Low-domain probes likewise show small variations, not a universal speedup. These remain loaded-host measurements.

The combined rewrite has lower peak RSS than the original program. Adding the runtime changes to the rewritten program alone raises its measured peak by roughly 7–9 MiB. A separate explicit-GC probe reuses the same interpreter and helper three times. Array-buffer storage stays at 0.107 MiB on every run for both runtimes; live heap stays around 33–35 MiB. The final run leaves:

| Host | Live heap MiB, before → after | Array-buffer MiB, before → after |
| --- | ---: | ---: |
| Mac | 34.36 → 33.26 | 0.107 → 0.107 |
| Intel | 34.36 → 33.22 | 0.107 → 0.107 |

Production execution does not force GC. These checks distinguish retained buffers from process peaks; they do not erase the higher peak measurements.

## Verification

Each host passed **702 unique tests in 22 focused files**, plus both selected differential cases for the full default and its fixture. The seven modular-power tests were also rechecked after adding warmed-helper budget assertions. Source/test TypeScript builds and five exclusion-catalog checks passed. The full default is restored to ordinary corpus eligibility. Exhaustive audits were not run.

The independent C++ oracle uses exact uint64 products for the task's modulus range. It computes F_k and F_(k+1) separately and uses (N+1)F_k-F_(k+1), rather than the rewritten double-prefix samples. Its interpolation weights are built by scalar forward/backward loops. It confirms the full answer and the corrected K=0 example. Small tests independently sum (N+1-j)j^K as BigInts, including sampled points, N modulo p at a sample, empty prime intervals, small moduli and all three execution backends. Large-N tests use closed forms at N=10^40+13.

Modular-power checks compare against the unchanged BigInt oracle over signed residue boundaries, modulus 2^30+1 through 2^31, 4096 deterministic random cases, negative/safe-integer extreme bases, UInt32 and 53-bit exponent boundaries, packed tails, broadcasting, exact wider fallback, errors, cancellation and budgets. Existing modular arithmetic, vector ternary, shape, builtin and I/O suites are included.

## Reproduction

Build matching language/interpreter output, then from the repository root:

- `node benchmarks/euler487.mjs compiled` or `reference` runs the full default. `RANK487_EXPECTED=106650212746` validates its answer.
- `RANK487_RUNTIME=/absolute/frozen/interpreter/out/index.js` selects a frozen interpreter with matching language files and package metadata.
- `node benchmarks/euler487-compare.mjs /absolute/frozen/interpreter/out/index.js 3 1000000000000 1` runs the four-way controls.
- `node benchmarks/experiments/euler487-kernels.mjs array-wide` runs a probe; other modes are `array-small`, `scalar-small`, and `scalar-wide`.
- `node benchmarks/euler487-regressions.mjs /absolute/frozen/interpreter/out/index.js 3` repeats the Euler 486 check.
- `node --expose-gc benchmarks/experiments/euler487-retained.mjs` checks retained storage separately.
- Compile `benchmarks/experiments/euler487-oracle.cpp` with `c++ -O3 -std=c++17`; optional arguments are K, N, Lo and Wd. The default invocation verifies the full task with exact uint64 arithmetic.

Raw data: [2026-11-08-euler487.json](baselines/2026-11-08-euler487.json).
