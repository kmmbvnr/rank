# Euler 549: segmented factorial-divisibility sieve

Base: `1585538ebaf2c99b7f3f50d5b178b94694332724`.
Full input N=100000000, exact answer **476001479068717**.

## Program

For n with prime-power factors p^a, s(n) is the maximum of the least m
satisfying v_p(m!) >= a. The old program stores the largest prime factor
of every n, then raises the entries for higher powers. Its full dense table
alone contains 100000001 integers.

The new program processes independent blocks of 1048576 integers. It visits
only prime powers with base p <= sqrt(N), updates their factorial thresholds,
and divides one p out of a residual array for each applicable power p^a.
After these divisions, each residual is either 1 or its only prime factor
above sqrt(N). The answer for each cell is the maximum of its threshold and
residual. The blocks start at 2, so s(1) is excluded. Block sums are independent
scalar ranked calls; the Rank source contains one explicit loop and every line
fits 40 columns. There is no full-size prime list or full-size result table.

Thresholds are prepared with broadcast Legendre valuations and rowwise
`lowerindex`. Writing m=p*q gives v_p(m!)=q+floor(q/p)+floor(q/p^2)+... .
Only q <= bit_length(N) is needed. Larger prime bases can share the final
lookup row: their threshold is p*a. This replaces 40 bisection rounds with
30 valuation terms per round and removes fixed exponent limits.

## Shared implementation

- Number slices stream discarded `A Slots min/max Scalar` transforms directly,
  preserving snapshots for unequal overlapping ranges. Native word guards,
  exact overflow replay, scalar demand and result ownership remain in place.
  The vector RHS handler retains real arrays; an early type guard prevents
  failed integer lowering from registering a real destination as integer.
- Vector extrema cell expressions now retain conditional precedence when
  embedded in sums and other arithmetic. Previously the new segmented program
  compiled to the wrong answer 451791360: `sum + condition ? a : b` was emitted
  instead of `sum + (condition ? a : b)`. Integer and real regression cases
  check this independently of Euler 549.
- Reference execution has a native same-selection Int32 extrema write without
  a generated function or RHS snapshot. It requires a ready scalar, identical
  linear source/destination addressing, a standard builtin and trusted storage.
  Aliases retain ordinary COW. Budget, inspection, opaque polling, mismatched
  selections, wide/real storage and shared buffers keep ordinary dispatch.

No syntax, Number admission threshold or language evaluation rule changes.

## Measurements

Node v24.15.0, Apple M5 arm64 and Intel i7-10750H x64. Fresh processes, exact
answer checked per sample; execution includes parsing but excludes interpreter
imports. RSS is the process high-water mark. Three alternating compiled pairs
per host; three new reference samples per host. The three old Mac reference
samples were retained from the earlier same-session baseline pairs. Intel old
reference is one completed control, not a median; an earlier 180-second run
timed out, then the longer bounded control completed. Intel samples reported
no other Node processes; load averages are retained with the raw data.

| Host/mode | Old seconds | New seconds | Old RSS MiB | New RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac compiled | 3.663 | 2.155 | 1147.3 | 276.5 |
| Mac reference | 74.931 | 4.270 | 853.0 | 358.2 |
| Intel compiled | 8.598 | 5.734 | 1128.2 | 266.7 |
| Intel reference | 226.311* | 15.738 | 830.1* | 350.8 |

*One old Intel reference control. Other primary figures are medians of three.
Old-source/new-runtime compiled controls remain near baseline, confirming that
the program rewrite supplies the main speedup. The unchanged new source cannot
serve as an old-runtime performance control because of the precedence bug above.

Single Mac block-size experiments (compiled/reference seconds and MiB):

| Cells/block | Compiled seconds / RSS | Reference seconds / RSS |
| ---: | ---: | ---: |
| 65536 | 2.072 / 321.4 | 60.135 / 657.9 |
| 262144 | 2.108 / 252.6 | 14.458 / 455.3 |
| 1048576 | 2.152 / 269.6 | 4.258 / 358.8 |
| 4194304 | 2.954 / 378.2 | 2.821 / 396.1 |

The chosen block keeps the compiled path fast and reduces reference dispatch
without the larger block's memory and compiled-time cost. These are single
controls, not repeated medians. Rejected whole-table variants retained one
loop but raised reference RSS to 1.6-1.8 GiB; they were not adopted.

## Verification

TypeScript build, 499 focused checks on Mac and Intel, and two filtered Mac
differential cases. Independent factorial-residue fixtures cover small bounds,
prime-power boundaries, empty bounds and block sizes 1/7/16/64. Full golden
answers pass on Number, exact and reference backends. Other focused tests cover
real range writes, snapshots, reverse/overlapping selections, widening, scalar
demand, budgets, and vector extrema precedence. The default demo is restored
to ordinary corpus execution. Full npm test and exhaustive audits were not run.

```sh
node benchmarks/euler549.mjs compiled
node benchmarks/euler549.mjs reference
node benchmarks/euler549.mjs compiled 1000
node benchmarks/euler549.mjs compiled 100000000 benchmarks/fixtures/euler549-original.ra
```

`RANK549_RUNTIME` selects another built interpreter; `RANK549_EXPECTED` checks
an answer. Diagnostics/profiles are separate optional runs. Raw results are in
`baselines/2026-11-09-euler549.json`.
