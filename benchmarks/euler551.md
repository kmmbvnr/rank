# Euler 551: sound row hoisting and unit-boundary transitions

Base: `8a026d9ef513af57ba32cc59b6d15209674bb69e`.
[Statement](https://projecteuler.net/problem=551): a(0)=a(1)=1 and, for n>=1,
a(n+1)=a(n)+digit_sum(a(n)). Full a(10^15)=**73597483551591773**.

## Compiler correctness

The original program returned **70549705357605360** with Number loops on both
Mac and Intel; exact/reference execution returned the correct value. Its tables
matched cell-for-cell between engines. The error was in the final greedy loop:
the generated row base for `Table D Sum R` was hoisted before an inner loop,
even though `Sum += 1` occurred later inside that loop's conditional branch.

A scope previously collected writes only as statements were lowered. Reads
before a later write could therefore mistake a mutable coordinate for an
invariant. Number loop scopes now collect assignments, unpack bindings and
nested-loop bindings over the entire body before lowering any accesses.
Definitely-assigned state remains separate. Truly invariant row bases and bounds
checks keep their existing optimizations; this neither disables Number loops
nor changes admission/copy thresholds.

Regressions cover ordinary, conditional and nested later updates, read and write
addresses, and the located error after a coordinate becomes invalid. Existing
matrix multiplication, cube and Gaussian-elimination cases still hoist valid
row bases. The unchanged original full program is a golden regression in all
three backends, so the demo rewrite cannot hide a remaining compiler error.

## Program

The original tables simulate carries out of 10000-sized blocks, then compose
10 blocks at each decimal level. The new program starts at unit boundaries.
For a high-part digit sum c and overshoot r:

- r>=1: crossing one unit takes zero steps and leaves r-1;
- r=0, c>0: one sequence step leaves c-1;
- c=r=0: an unused sentinel entry, as the sequence starts at value 1.

Thus two broadcast arrays construct the complete base transition; the iterative
bootstrap, low-digit array and final tail simulation disappear. Decimal
composition retains the same counting formula, including zero-step transitions
after overshoot. A list of records retains one pair of matrices per level,
avoiding repeated copies of a growing 3D cube. A short loop over ten digits
builds each level; `repeat` stages compose levels and perform greedy selection.
The Rank program has one explicit loop and all lines fit 40 columns.

For positive N, put d=digits(N) and M=36*d. Since digits(M)<=d+2, values below
M*N have digit sum at most 9*(2*d+2)<=M. Induction bounds a(N) by M*N. Its digit
length supplies a sufficient number of levels and a safe carry width; fixed
limits 13/117 are removed. N=0 still returns 1. Unit boundaries finish all
remaining steps for positive N without a separate tail loop.

## Measurements

Node v24.15.0, Apple M5 arm64 and Intel i7-10750H x64. Five alternating fresh
process pairs per engine, scale and host. **Both primary source variants use
the repaired compiler** and every result is checked. The pre-fix wrong-answer
runs are separate correctness controls, not performance baselines. Timing
includes parsing/execution and excludes importing the interpreter. RSS is the
process high-water mark. Intel samples had no other Node processes; loads are
retained in the raw data.

Full N=10^15:

| Host/mode | Old seconds | New seconds | Old RSS MiB | New RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac compiled | 0.526 | 0.236 | 280.3 | 205.7 |
| Mac reference | 0.523 | 0.270 | 274.5 | 257.2 |
| Intel compiled | 1.315 | 0.593 | 249.4 | 195.1 |
| Intel reference | 1.272 | 0.674 | 239.0 | 240.5 |

Actual unchanged `_test.ra`, asserting a(9) and a(10^6) in one module run:

| Host/mode | Old seconds | New seconds | Old RSS MiB | New RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac compiled | 0.927 | 0.171 | 286.7 | 187.6 |
| Mac reference | 0.956 | 0.171 | 289.0 | 196.3 |
| Intel compiled | 2.241 | 0.427 | 261.9 | 173.7 |
| Intel reference | 2.365 | 0.434 | 262.2 | 183.0 |

All figures are medians of five. Full Intel reference memory is effectively
unchanged: old samples 236.7-240.0 MiB, new 237.7-242.3 MiB. Do not describe
that case as a memory saving. Other primary medians are lower.

## Verification and reproduction

TypeScript build; 612 focused checks on each host; two filtered Mac differential
cases. Tests compare literal digit-sum iteration through a million, direct
block-transition simulation including overshoot, the unchanged original full
program, and a separate BigInt decimal-block oracle at N=10^16 (beyond Number
precision). Number, exact and reference results all match. Full npm test and
exhaustive audits were not run.

```sh
node benchmarks/euler551.mjs compiled
node benchmarks/euler551.mjs reference
node benchmarks/euler551.mjs compiled fixture demos/euler/551_sumofdigitssequence_test.ra
RANK551_MODULE=benchmarks/fixtures/euler551-original.ra node benchmarks/euler551.mjs compiled fixture demos/euler/551_sumofdigitssequence_test.ra
node benchmarks/euler551-oracle.mjs
```

`RANK551_RUNTIME` selects a built interpreter; `RANK551_EXPECTED` checks the
answer (`passed` for the fixture). Diagnostics/profiles are separate optional
runs. Raw samples: `baselines/2026-11-09-euler551.json`.
