# Euler 483: batched cycle transitions and exact division

[Euler 483](https://projecteuler.net/problem=483) keeps the default n=350 and returns **4.993401567e22**, rounded to ten significant digits. The earlier issue estimate of 47 seconds is historical: current main already runs the original program in about 11 seconds on the Mac. Measurements use current main as the baseline.

## Program

For a cycle type with m_c cycles of length c, its number of permutations is `n! / product(c^m_c m_c!)`, and its order is the least common multiple of its cycle lengths. The computation sums the squared order weighted by these exact integer counts, then divides by n! only for final formatting.

Lengths are processed by decreasing largest prime factor, ascending within a prime block. Once the block for prime p finishes, later lengths cannot contain p. Its current power p^a can therefore leave the stored order and contribute p^(2a) to the weight. This preserves the squared final order. The largest possible power divides the largest p-power not exceeding n, so a single `gcd` extracts it; repeated mask/choose loops are unnecessary. The bit length of n gives an exact upper bound for the small power table, without floating logarithms.

Each cycle-length transition now expands all admissible multiplicities in one ragged batch. Prefix counts and `scan max` label source rows; a product scan builds the exact `c^m m!` denominators. LCM is computed once per input state before gathering repeated rows. Ordinary function scopes release transition temporaries. Sorted equal states use the existing `sum by` operation instead of retaining a wide prefix sum and subtracting gathered endpoints.

A fresh radix `1 + max(order)` makes `(used, order)` keys injective and keeps early keys compact. This also removes the old unexplained fixed radix of 10^13. Existing factorization supplies largest prime factors. There is one explicit loop in the complete Rank source, with no nested loops or hand-made memoization cache.

The diagnostic volume of published typed cells falls from **312049358 to 124795235**; these are cumulative publications, not a measurement of unique allocated bytes. The full DP uses arbitrary-width integer weights.

## General runtime repair

`floorDivide` previously computed both BigInt quotient and remainder before checking signs. For operands with the same sign, truncating division already equals floor division. The shared helper now skips the remainder in that case. Opposite signs retain the divisibility correction, and division by zero still fails at the initial division. This helper serves both reference arithmetic and generated array/function/loop kernels; there is no Euler-specific compiler rule.

The original-program CPU profile identified this helper as the largest individual self-sampling hotspot. The standalone division probe checks wide quotients while measuring equal-sign and opposite-sign operands separately.

## Measurements

Baseline: **bf5ef36b1e31a8c75af527c814f2b82f17217a53**. Compiled numbers are medians of three alternating fresh-process rounds; reference numbers are one fresh-process sample per variant. Both hosts had background load and Intel was performing a ZFS scrub. Absolute timings should not be treated as idle-host performance.

| Host | Mode | Change | Seconds | Peak MiB |
| --- | --- | --- | ---: | ---: |
| Mac | compiled | Original | 10.999 | 863.8 |
| Mac | compiled | Runtime only | 9.675 | 1108.1 |
| Mac | compiled | Program only | 6.126 | 607.0 |
| Mac | compiled | Both | 4.698 | 628.4 |
| Mac | reference | Original | 11.047 | 850.7 |
| Mac | reference | Runtime only | 9.696 | 848.0 |
| Mac | reference | Program only | 5.968 | 593.6 |
| Mac | reference | Both | 4.531 | 600.1 |
| Intel | compiled | Original | 30.047 | 858.0 |
| Intel | compiled | Runtime only | 27.375 | 1030.5 |
| Intel | compiled | Program only | 15.673 | 563.9 |
| Intel | compiled | Both | 12.378 | 563.1 |
| Intel | reference | Original | 30.090 | 808.1 |
| Intel | reference | Runtime only | 26.510 | 773.7 |
| Intel | reference | Program only | 15.261 | 526.5 |
| Intel | reference | Both | 11.973 | 521.6 |

The four-way controls compare the original, runtime-only, program-only and combined changes. All 16 full-input runs per host match the entire **763-digit numerator**, not just the printed rounded answer. Runtime/source hashes and CPU time are retained with the raw measurements.

The runtime-only compiled Mac variant has a higher peak RSS than its control, despite lower elapsed time; the reference pair is almost unchanged in memory. A separate explicit-GC retention probe leaves about 39 MiB of live JS heap in both versions. This does not erase the measured RSS increase or establish universal memory savings from the division change. The complete delivered program reduces peak RSS; that is the memory improvement claimed here.

The division probe measures 200000 checked wide quotients after warmup (single process pair per mode):

| Host | Signs | Before ms | After ms |
| --- | --- | ---: | ---: |
| Mac | same | 196.11 | 95.19 |
| Mac | opposite | 198.50 | 201.30 |
| Intel | same | 579.00 | 296.65 |
| Intel | opposite | 589.48 | 584.71 |

These are primitive-level observations, not end-to-end speedup predictions.

The investigation retained three intermediate variants: ragged expansion alone, scoped grouped sums, and flattened prime elimination. The full delivered version also hoists LCM out of repeated rows. These exploratory single samples are not substitutes for the final paired controls.

## Verification

Both hosts passed **412 tests across 14 focused files** and both selected differential cases. Source and test TypeScript builds and all five exclusion-catalog checks passed.

An independent JS oracle enumerates all integer partitions into cycle lengths and multiplicities, including fixed points. It directly sums `n! / product(c^m m!) * lcm^2`, without prime elimination, packed keys, grouped sums or ragged expansion. Exact numerators and independently rounded decimal strings agree at n=0,1,2,3,4,5,7,10,12,20,25,30 on three execution backends. Statement fixtures remain unchanged. The full-size golden checks the ten-digit result; the full exact numerator is additionally compared against the original program in every performance control.

The division tests cover 2500-bit values, both signs, exact and inexact quotients, zero numerators and zero divisors. Floor quotients are checked through their defining interval bounds, independently of the implementation's sign/remainder formula. Existing expression, function, loop, real division, keyed-fold and gather tests remain in the focused set.

The main program returns to ordinary corpus audits. No full npm test or exhaustive audit was run.

## Reproduction

Build matching language and interpreter output first. From the repository root, run `node benchmarks/euler483.mjs compiled 350` or `reference`. `RANK483_RUNTIME` selects a frozen interpreter index.js and matching language package; `RANK483_EXPECTED=4.993401567e22` checks the rounded answer. Four-way controls use `node benchmarks/euler483-compare.mjs /absolute/frozen/interpreter/out/index.js 3 350 1`.

`node benchmarks/experiments/euler483-division.mjs same` and `opposite` measure the shared division primitive. Use `node --expose-gc benchmarks/experiments/euler483-retained.mjs` only for the separate retention probe; production execution never forces GC.

[Raw controls, probes, profile summary and verification logs](baselines/2026-11-08-euler483.json).
