# Euler 448: average least common multiple

The full answer at N = 99999999019 remains **106467648**. The existing totient
summatory recurrence is retained:

```
A(n) = (1 + sum(d * phi(d), d divides n)) / 2
F(x) = sum(k * phi(k), k <= x)
F(x) = sum(k^2, k <= x) - sum(k * F(x // k), k = 2..x)
```

The prefix table and descending cache of large quotient values still evaluate
this recurrence with a hyperbola split. There are two Rank loops, one in the
weighted-totient helper and one in the quotient cache; neither is nested.
The full default N and table-length option L = 10000000 are preserved.

The totient sieve now has a private function scope and one prime-power loop.
Its temporary arrays no longer remain top-level bindings. The prefix scan
reduces every addition modulo M rather than storing the entire unreduced
prefix and then slicing and reducing it. The scalar square-sum polynomial is
computed modulo M using the inverse of six, keeping the recurrence within
Number's exact domain. This is valid because M = 999999017 is coprime to six.

A triangular interval weight uses `(n * (n+1) mod (2*M)) // 2`. The reduced
product remains even, so division by two gives the exact residue modulo M.
This removes parity masks and four factor arrays from the former spelling.
Global cutoffs clamp to at least one, so the empty prefix S(0) returns zero.
The final small/large quotient lookups share a helper. Variable names describe
their role, and sum operands have their own bindings.

## Compiler and reference execution

The triangular formula exposed the Number modular multiplier's 2^30 domain
limit. Beyond that limit an unsafe full product replayed the entire private
loop. Exact modular products now support positive moduli through 2^31, whose
residues still fit signed Int32 cells. The <=2^30 imul path is unchanged.
The new range rounds the floating quotient to the nearest integer. Its
error is below 2^-20, so the exact centered difference has magnitude at most
2^30 + 2048. The signed low word from imul therefore recovers it exactly; one
addition of M normalizes a negative result. Modular folds share this helper.
Scalar Number functions and numeric vectors use the same checked helper.
Ordinary equal-shape Int32 array products also use this path in reference
execution, without materializing the wide products first. Larger, negative
and zero moduli preserve their existing exact/error paths. Powmod and keyed
fold admission limits are unchanged.

This is a domain extension with an exactness proof, not an increase to the
copy-cost or speculative-loop thresholds. Completed ordinary products still
remain complete before a later remainder; no '=' boundary is fused away.

## Measurements

| Host / mode | Before, ms | After, ms | Before RSS, MiB | After RSS, MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac, compiled | 18082.25 | 5854.75 | 1674.52 | 591.91 |
| Mac, reference | 17287.22 | 8145.73 | 1673.53 | 983.08 |
| Intel, compiled | 49053.96 | 15429.23 | 1340.99 | 443.32 |
| Intel, reference | 47128.23 | 23696.49 | 1370.47 | 614.74 |

Three alternating before/after pairs per host and mode use fresh Node
v24.15.0 processes, comparing 16418492 with the final source/runtime. Timings
include parsing and execution; RSS is process peak. Source and compiled
runtime hashes are recorded. Intel vmstat samples are collected before each
run (96–100% CPU idle, no active swap traffic); Mac background load is
retained with each sample.

A separate array workload repeats one million modular products twenty times.
It compares both the new 31-bit domain and the established 1000000007 modulus,
with and without compilation. A direct BigInt sum validates each output.

| Host / mode | Before, ms | After, ms | Before RSS, MiB | After RSS, MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac, compiled, M=1000000007 | 189.92 | 187.89 | 191.47 | 190.89 |
| Mac, reference, M=1000000007 | 201.92 | 200.92 | 290.20 | 300.34 |
| Mac, compiled, M=1999998034 | 772.97 | 235.71 | 274.20 | 192.14 |
| Mac, reference, M=1999998034 | 807.51 | 219.14 | 279.64 | 287.30 |
| Intel, compiled, M=1000000007 | 469.09 | 472.83 | 163.07 | 148.81 |
| Intel, reference, M=1000000007 | 568.21 | 566.33 | 240.18 | 270.50 |
| Intel, compiled, M=1999998034 | 1931.41 | 656.02 | 251.80 | 148.88 |
| Intel, reference, M=1999998034 | 2006.90 | 737.05 | 257.69 | 240.54 |

The large-domain control is faster on both hosts in both modes, and the
compiled runs use less peak RSS. The established small-modulus timings and
RSS ranges overlap. Reference-control RSS also varies between processes;
the data does not establish a reference-control memory reduction.

## Verification

442 focused tests across 14 files pass on Mac and Intel.
There are 306 direct LCM-average comparisons per host across 17 input sizes,
six prefix lengths and three execution modes. Cases include zero/one, square
boundaries, a complete table and recurrence below the cutoff. The Rank fixture
runs at changing N/L in the same interpreter in all three modes. The full
compiled answer and zero Number overflows are asserted.

The modular multiplier is checked against BigInt at 40484 residue pairs,
including deterministic random pairs and 16-bit/Int32 boundary values, plus
196 signed safe-input cases. Scalar functions, vectors and ordinary arrays
cover new moduli through 2^31, shape/rank preservation, warming with changing
moduli, exact replay outside the domain, ordinary wide-product boundaries,
aliased caller writes, errors, budgets and cancellation. Existing modular
power, scan and keyed-fold tests check the retained small-modulus paths.
Source/test TypeScript checks and execution-exclusion checks pass. Exhaustive
audits were not run. The full demo is removed from corpus exclusions.

Raw measurements: [full runs and domain controls](baselines/2026-11-07-euler448.json).
From the repository root:

```sh
git show 16418492:demos/euler/448_averagelcm.ra > /tmp/euler448-before.ra
node benchmarks/euler448.mjs compiled 99999999019
node benchmarks/euler448.mjs reference 99999999019
node benchmarks/modular-product-domains.mjs compiled 1999998034
node benchmarks/modular-product-domains.mjs reference 1999998034
node benchmarks/modular-product-domains.mjs compiled 1000000007
```

For the baseline, build an interpreter at 16418492 and pass its out/index.js
file URL as RANK448_RUNTIME (demo) or RANK_BENCH_RUNTIME (domain control).
The demo runner's third argument selects the saved old source.
