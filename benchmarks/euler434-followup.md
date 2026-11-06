# Euler 434: connected bipartite graphs by polynomial rows

Default N=100; answer **863253606**. Baseline:
`ca1e18afa1d28b9b4ae29a403fbe9dff9174986b`.
The issue's older 32.0 / 25.9-second reference/compiled observations are not the
current baseline. Current controls already benefit from earlier runtime work.

## Algorithm and array storage

The graph model is unchanged: a braced grid corresponds to a connected spanning
subgraph of the complete bipartite graph on its rows and columns. The old program
computes every R(m,n) separately, constructing rectangular coefficient, exponent,
power and product arrays inside each cell recurrence. Individual tensor kernels
compile, but whole-loop lowering declines at the named column selector `Js` in
`Bn Q Js`. Compilation alone does not remove that repeated rectangular work.

First count graphs in which each column has a nonempty neighbourhood. There are
`(2^m - 1)^n` such graphs. Decomposing the component containing the first row gives
another graph with nonempty columns outside that component. Normalize column
coefficients by n! and write:

```
A_m(z) = sum_n (2^m - 1)^n z^n / n!
C_m(z) = A_m(z)
         - sum_{i=1}^{m-1} choose(m-1,i-1) C_i(z) A_{m-i}(z)
```

Coefficients are taken through degree N, modulo the existing prime 1000000033.
The identity term A_0 is implicit. The standalone verifier checks primality;
all exercised N are below the modulus. Polynomial multiplication is the existing
exact `convolve mod` implementation, with no floating approximation. Multiplying
back by n! restores the public `Rg` matrix and its existing fixture values.

Each completed row depends on earlier rows. The source has one loop in the row
helper and one in the main driver, with no nested Rank loops. Factorials use the
existing modular scan, inverse factorials use batched `powmod`, and binomial
coefficients use the library. Whole-row selections replace repeated advanced
index vectors. The row-result copy keeps the initial polynomial independent of
later matrix stores; the convolution prefix uses `take`. Every production and
fixture line fits 40 columns.

The polynomial part changes from per-cell rectangular sums to O(N^2) row
convolutions. With the NTT backend, that part costs O(N^3 log N) rather than
O(N^4) cell products. N=0 now has the natural empty-sum answer 0. The default
input, all existing fixture assertions and full golden answer are preserved.

## Shared native improvement

The convolution backend previously retained one root table. Every CRT
convolution cycles through three NTT primes, replacing that table three times.
It now keeps one reusable prefix table per prime for short transforms. A level
uses `root^((p-1)/(2*half))`, independently of the final transform length, so a
larger table also supplies every smaller prefix.

Three tables of at most 4096 Int32 cells retain at most **48 KiB**. A larger table
is cached alone, preserving the previous large-transform retention policy. This
is a memory-retention cap, not a convolution-size or precision limit. No
schoolbook/NTT dispatch threshold, Number admission threshold or public operation
changes. Only pure private root tables are cached; inputs and convolution results
are not retained. Transform checkpoints and demand-budget charges are unchanged.

The new Rank formulation hands its polynomial arithmetic to the existing native
routine in both engines. It does not require a special compiler rule for Euler
434. Further whole-loop treatment of the old advanced selector remains a general
compiler opportunity rather than a correctness requirement for this change.

## Controlled measurements

Apple M5 arm64 and Intel Core i7-10750H x86_64, Node v24.15.0. Three fresh processes
per variant, with reversed order in the middle repetition. Imports and Interpreter
construction precede the timer; file reading, parsing, execution and diagnostics
are timed. RSS is whole-process peak, not live array bytes. Other sessions were
active, and small changes are not claimed as precise speedups.

| Compiled variant | Mac s / MiB | Intel s / MiB |
| --- | ---: | ---: |
| Baseline | 4.603 / 662.4 | 15.342 / 510.4 |
| Runtime only | 4.542 / 670.7 | 15.404 / 513.1 |
| Source only | 0.969 / 333.1 | 2.312 / 307.5 |
| Both | 0.929 / 312.0 | 2.215 / 292.2 |

| Reference variant | Mac s / MiB | Intel s / MiB |
| --- | ---: | ---: |
| Baseline | 6.186 / 619.1 | 17.992 / 444.0 |
| Runtime only | 6.175 / 603.2 | 18.049 / 441.9 |
| Source only | 1.028 / 345.2 | 2.565 / 322.8 |
| Both | 0.980 / 322.8 | 2.527 / 308.0 |

Combined compiled speedup is **4.96x / 6.93x** on Mac / Intel; reference improves
**6.31x / 7.12x**. Compiled peak RSS falls **53% / 43%**, reference **48% / 31%**.
The original source does not call convolution, so runtime-only timing differences
are noise. The main gain is the reformulated recurrence and reduced materialization.

A separate native-only control isolates root-table reuse. Batch times below are
three-process medians, after five warmup convolutions:

| Vector length / rounds | Mac before -> after ms | Intel before -> after ms |
| --- | ---: | ---: |
| 101 / 10000 | 396.0 -> 324.9 | 1953.6 -> 1785.7 |
| 513 / 500 | 385.7 -> 354.3 | 916.9 -> 881.6 |
| 5000 / 10 | 117.8 -> 114.2 | 203.9 -> 198.6 |

The 101-cell workload improves about 18% / 9%; the large-table control is close
and retains its original storage policy. All microbenchmark checksums agree.
Compiled diagnostic publication counts fall from **131299187 to 3569141 cells**;
these are publications, not an allocation-byte or live-memory measurement.

## Verification

- **258 tests / four files pass on each host**: the new recurrence, full defaults
  in three configurations, convolution (including wide integers and varied
  moduli), modular folds and interruption. New tests cover repeated roots,
  large-table replacement, smaller prefixes, input immutability and warm-cache
  demand exhaustion.
- **60 program comparisons / 76650 checked matrix cells per host**, using an
  independent BigInt component recurrence for N through 65 and symmetry at the
  full default. The oracle is independently checked by enumerating all edge
  subsets of every bipartite shape through 4 by 4. All three fixture tests pass
  in all three configurations. The full answer is retained in ordinary tests.
- Euler 344 and 654 fixtures: **18 test executions per host** across three
  configurations. Explicit small cases from Euler 648 and 709: **12 runs per
  host**. Their expensive full-default fixtures were not run or changed.
- TypeScript source/test build, semantic boundaries and source/exclusion checks
  pass. No full `npm test`, inferred-type audit, differential audit or Nurikabe
  audit was started. No execution exclusion or timeout is added or increased.

Raw data: `baselines/2026-11-06-euler434.json`. Reproducible program, kernel,
verification and neighbour controls: `experiments/euler434-*`.
