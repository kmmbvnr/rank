# Euler 484: prime-power stages and exact native word kernels

[Euler 484](https://projecteuler.net/problem=484) sums gcd(k,k') for 1<k<=5×10^15. The full answer remains **8907904768686152599**. This pass improves the array program and the shared integer runtime, including two compiler regressions found during validation.

## Exact enumeration and bounded storage

Write g(n)=gcd(n,n'). For a prime power, g(p^e)=p^e when p divides e, otherwise p^(e-1). Thus g=1*h, with h multiplicative and supported on powerful numbers. Its nonzero prime-power coefficients are p^(e-2)(p-1), multiplied by p+1 when p divides e; the coefficient is zero when p divides e-1. The program computes N-1 plus the sum of h(u) floor(N/u) over powerful u>1.

Nonzero prime powers and coefficients are prepared once and sorted by power. Squares use the complete prime list through isqrt(N). Higher powers need only primes below 2^ceil(B/3), where B is N's bit length. A prime with binary width w+1 needs at most floor(B/w) exponents; ragged expansion constructs those candidates and exact power comparisons discard the excess. These integer bounds avoid floating logarithms.

A state stores its next allowed prime index, floor(N/u), and h(u). Existing `upperindex` batches locate its power interval; a prime-index mask removes powers of earlier primes within that interval. Increasing prime indices make each powerful factorization unique. A child is retained only when the actual next prime's square fits the remaining quotient.

Chunks split the flat candidate range, including a single oversized ragged row. Prefix clipping and row expansion bound each batch to 1,000,000 candidate powers. The original whole-row chunking could exceed its nominal size on the first row. Scoped helpers release batch temporaries, and the complete Rank source has one explicit loop with every line at most 40 characters.

The final product vector uses ordinary `Terms =`. A measured lazy `Terms'` candidate had similar compiled speed but roughly twice the reference time. Ordinary storage adds about 40 MiB in the initial comparison while reducing reference time from 28.61 to 13.94 seconds. Final controls below use the selected ordinary binding.

## Shared runtime and compiler repairs

Int64 comparisons now use signed high words and unsigned low words. All six predicates preserve values outside Number's exact range, including Int64 extrema. The native path supports scalar and mixed Int32 operands and multidimensional broadcasting, and writes packed Boolean masks. The new comparison path declines wider scalars, shared wide buffers and opaque checks, and preserves observed/budgeted execution.

Numeric tensor consumers read Int64 words directly without allocating a BigInt at every load or copying the input to a Float64 buffer. Individual cells and arithmetic intermediates must still fit Number's exact integer range. A running sum that leaves that range flushes its exact safe subtotal into a private BigInt accumulator and continues. Large signed cancellation and totals beyond Int64 remain exact. A genuinely unsafe cell or intermediate still uses exact replay. The existing 64-element copy admission cap remains for boxed wide inputs; native words no longer incur that conversion cost. Both rank-one and multidimensional layouts use this path.

Three focused failures also reproduced on clean baseline a8e269fd. Uniform view checks now require the internal pure-check marker, so arbitrary per-cell checks keep their order and errors. Ranked text-to-integer plans retain their more precise `integer0` recipe instead of losing it behind a generic scalar-builtin recipe. The existing contract and text-power fusion regressions pass after these repairs.

## Measurements

Baseline: **a8e269fd5f26a61b6a184da61a1179be3051ef9a**. Compiled values are medians of three alternating fresh-process rounds. Reference values are one fresh-process sample per variant. Both hosts had background load; Intel was running a ZFS scrub. CPU time, source and runtime hashes, and process peak RSS are retained in the raw data.

| Host | Mode | Change | Seconds | Peak MiB |
| --- | --- | --- | ---: | ---: |
| Mac | compiled | Original | 30.575 | 1449.0 |
| Mac | compiled | Runtime only | 19.582 | 1365.0 |
| Mac | compiled | Program only | 29.079 | 895.7 |
| Mac | compiled | Both | 14.244 | 886.6 |
| Mac | reference | Original | 31.689 | 1290.2 |
| Mac | reference | Runtime only | 21.331 | 1313.7 |
| Mac | reference | Program only | 29.769 | 890.5 |
| Mac | reference | Both | 14.446 | 921.4 |
| Intel | compiled | Original | 77.991 | 1134.6 |
| Intel | compiled | Runtime only | 51.829 | 917.4 |
| Intel | compiled | Program only | 77.558 | 653.6 |
| Intel | compiled | Both | 35.747 | 618.0 |
| Intel | reference | Original | 78.886 | 1016.8 |
| Intel | reference | Runtime only | 55.213 | 898.8 |
| Intel | reference | Program only | 76.291 | 648.6 |
| Intel | reference | Both | 35.754 | 625.1 |

The four variants isolate the original program, shared runtime changes, program changes, and the combined result. Earlier lazy-candidate measurements are archived separately. Its obsolete Intel run was stopped after selecting ordinary `Terms`; partial observations are excluded from the final controls.

Standalone warmed probes perform three demands over 1048576 cells (one process per side):

| Host | Probe | Milliseconds | Peak MiB |
| --- | --- | ---: | ---: |
| Mac | sum-vector | 30.62 → 17.96 | 184.5 → 183.8 |
| Mac | sum-matrix | 29.88 → 18.25 | 180.6 → 180.0 |
| Mac | compare | 80.13 → 18.39 | 283.4 → 151.8 |
| Intel | sum-vector | 119.75 → 54.68 | 168.9 → 170.9 |
| Intel | sum-matrix | 112.03 → 59.87 | 166.9 → 167.0 |
| Intel | compare | 209.74 → 45.85 | 267.7 → 147.1 |

Neighboring workloads use three alternating fresh-process pairs with their unchanged sources:

| Host | Euler | Seconds | Peak MiB |
| --- | --- | ---: | ---: |
| Mac | 482 | 3.707 → 3.288 | 1307.6 → 1284.2 |
| Mac | 483 | 4.744 → 4.733 | 585.8 → 631.2 |
| Intel | 482 | 10.075 → 8.852 | 928.5 → 922.2 |
| Intel | 483 | 14.154 → 13.922 | 562.1 → 555.7 |

The Mac Euler 483 RSS median rose from 585.8 to 631.2 MiB while elapsed time stayed at about 4.74 seconds. The three baseline peaks ranged from 582.7 to 630.6 MiB, versus 629.2 to 650.1 MiB afterward. A separate explicit-GC probe of the unchanged program leaves 40.13 versus 40.29 MiB of live JS heap and the same 0.05 MiB of array buffers. Buffer-retention tests also verify that cached runners release previous inputs. These checks distinguish live retention from process peaks; the higher measured RSS remains recorded.

## Verification

Each host passed **818 tests in 33 focused files**, plus both selected differential cases. Source/test TypeScript builds and all five exclusion-catalog checks passed. The larger Euler 482 and 483 golden cases are included in the focused total.

The JS oracle computes derivatives directly using Leibniz's rule and then gcd, independently of h and the powerful-number traversal. It checks selected bounds through 100,000 on three execution backends, including prime-power boundaries and the empty sum at N=0. Chunk sizes 1, 7 and 31 exercise clipped ragged rows. Negative input retains the square-root domain error. Statement fixtures remain unchanged.

The independent C++ oracle uses a depth-first traversal with on-the-fly prime powers and successive g(p^e) differences. It has no sorted power table, query windows, ragged expansion or Rank kernels. It confirms the full answer from 387936 visited states and 103994236 nonzero prime-power contributions.

Runtime checks cover all six comparisons around signed word boundaries, values above 2^53, mixed broadcasting, wide positive and negative totals, cancellation, late unsafe replay and native word inputs without conversion buffers. The full program returns to ordinary corpus audits. Validation used focused package-script suites and the two selected differential cases.

## Reproduction

Build matching language and interpreter output first. From the repository root, run `node benchmarks/euler484.mjs compiled 5000000000000000` or `reference`. `RANK484_EXPECTED=8907904768686152599` checks the result. `RANK484_RUNTIME` selects a frozen interpreter index.js with its matching language package.

Four-way controls: `node benchmarks/euler484-compare.mjs /absolute/frozen/interpreter/out/index.js 3 5000000000000000 1`. Neighboring-workload controls: `node benchmarks/euler484-regressions.mjs /absolute/frozen/interpreter/out/index.js 3`.

The separate retention probe is `node --expose-gc benchmarks/experiments/euler484-retained.mjs`; production execution does not force GC.

Standalone warmed probes use `node benchmarks/experiments/euler484-kernels.mjs sum-vector`, `sum-matrix`, or `compare`. The comparison probe uses reference execution to measure the shared runtime. Compile the independent oracle with `c++ -O3 -std=c++17 benchmarks/experiments/euler484-oracle.cpp`; its default input is the full bound.

[Raw controls, probes, regression checks and verification logs](baselines/2026-11-08-euler484.json).
