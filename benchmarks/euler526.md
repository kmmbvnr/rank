# Euler 526: exact maxima and a flat sieve

Baseline: `f3edaa52`. The old default answer was correct, but its search was
not a general implementation of h(L). It searched only 16 residue classes
modulo 720720 and required all nine reduced cofactors to be prime. It returned
0 for both official examples, h(100)=417 and h(10^9)=4896292593.
The existing 10^11 fixture also underestimated the answer: the exact maximum is
**491010576113**, attained at n=99862006961, rather than 455559334569.

## Search and proof

Let M=720720 and D(r,j)=gcd(r+j,M), for 0<=j<9. All prime factors of D are at
most 13. Therefore the largest prime factor of n+j is at most (n+j)/D+13.
Writing W(r)=sum_j M/D(r,j), an integer upper bound for the score is

    B(n,r) = floor((n+8)*W(r)/M) + 117.

A one-dimensional prefix sum computes all residue weights without a
720720-by-9 matrix. The 16 maximal classes have weight 3575858; all other
classes have weight at most 3573778. For the default limit their upper bound
is 49586219336219492, below the answer 49601160286750947.

An initial search in the maximal classes provides a verified lower bound.
Its primality sieve flattens prime/row/offset tasks into **one explicit loop**;
each task writes one arithmetic progression. This avoids both nested Rank
loops and large broadcast/filter temporaries. The 262144-column working block
is bounded independently of L.

The initial result is returned only with a certificate covering unsearched
blocks, excluded residues, composite cofactors and tiny prime cofactors.
If C=(n+j)/D is composite, its largest prime factor is at most max(C/2,13).
Consequently B(n,r)+13-floor((n+j)/(2D)) bounds a candidate with that composite
cofactor. The tiny-prime exception is bounded by 9*(13*max(D)+8).

If the certificate fails, all residue classes whose bounds can improve the
best score are searched, in descending weight groups of 16. Bounds determine
which cofactors must be prime; only those receive small-prime sieving, and a
prime equal to the cofactor is never incorrectly rejected. Remaining candidates
are scored by their actual largest prime factors. The current best prunes
classes and blocks. `repeat ... till` carries this bounded search state without
another explicit loop. Very small limits use a direct rolling-factor sum.
All bounds use exact integers, including the wide default limit.

## General compiler changes

* Fresh array writes in straight-line helpers can share one private compiled
  prefix; no artificial wrapper loop is needed for ragged expansion.
* A scan nested in arithmetic is completed as a scan, rather than misread as a
  pointwise operation involving a scalar named `scan`.
* Leading scalar row selection works for integer, real and boolean arrays,
  preserving a fresh snapshot and row bounds.
* Contiguous broadcast blocks use a linear block/period address instead of
  decoding every axis for each cell; disjoint broadcast groups retain the
  general address calculation.
* Pure filtered integer indices can stream scalar fills without allocating the
  selected-key array. Aliases, metadata, observable budgets and polling retain
  their required ordinary paths. Compound writes and array RHS behavior remain
  covered separately.

These are language-wide lowering changes. The compiler does not recognize an
Euler filename, residue pattern, answer or numerical constant from this demo.

## Measurements

Node v24.15.0 on Mac arm64 and Intel i7-10750H x64. Compiled comparisons use
three alternating old/new pairs, separate processes and no overlapping local
benchmark/test jobs. Original sources are retained in `fixtures/euler526-original.ra`.
The new source with the frozen old runtime isolates the compiler contribution.
Raw records, hashes, CPU usage and peak RSS are in
`baselines/2026-11-09-euler526.json`.

Compiled medians (seconds / peak MiB):

| Host | Original source | Corrected flat source |
| --- | ---: | ---: |
| Mac arm64 | 5.943 / 522 | 3.971 / 358 |
| Intel x64 | 17.862 / 481 | 10.249 / 352 |

Both sources in this table use the new runtime, isolating the source rewrite.
The frozen baseline runtime on the **new** source takes 10.964 s / 559 MiB on
Mac and 30.625 s / 519 MiB on Intel. Thus the general compiler support is useful
for the selected flat representation too, not just the discarded tensor variant.
Initial baseline-original controls were 5.877 s / 522 MiB on Mac and
17.058 s / 487 MiB on Intel; do not interpret the small variation between
baseline-original observations as an improvement or regression by itself.

Single reference runs improve from 7.887 s / 661 MiB to 6.707 s / 590 MiB on Mac,
and from 24.824 s / 476 MiB to 21.808 s / 378 MiB on Intel. Peak RSS includes the
parser/runtime and is not the live DP/sieve size. Intel load was checked before
measurement; the paired-run load averages include our own preceding process.

Verification: TypeScript interpreter and test-project builds pass. On Mac,
619 of 620 selected compiler regressions pass; the one existing failure is
`number-loop-slice.test.ts`, "fuses a discarded slice transform with mod": it
expects one Number entry but observes zero, with value/error agreement intact.
It was already reproduced before task 519 and is not hidden or weakened here.
The 10 new demo tests pass on Mac; all 77 focused demo/new compiler tests pass
on Intel. The independent C++ oracle confirms 491010576113 in 0.401 s
(367597 candidates, 67 fully factored), without using that answer as a seed.
A filtered differential run covers the full demo and embedded fixture on Mac
and Intel; both files and both embedded test blocks pass. The default demo is
therefore removed from repeated-corpus execution exclusions. Full suites and
exhaustive audits were not run.

The discarded tensor sieve was slower in reference execution: 40.93 s / 935 MiB
on Mac and 100.05 s / 849 MiB on Intel. Its compiled Mac time was 6.71 s / 400 MiB.
The selected flat sieve avoids that regression. Increasing the tensor block to
524288 or 1048576 columns did not improve its time consistently and increased
memory in the largest case.

## Reproduction

    node benchmarks/euler526.mjs compiled 10000000000000000
    node benchmarks/euler526.mjs reference 10000000000000000
    node benchmarks/euler526.mjs compiled 100000000000

From `packages/interpreter`, use the package test runner:

    node scripts/test.mjs test/euler526.test.ts
    node scripts/test.mjs test/straight-line-array-prefix.test.ts
    node scripts/test.mjs test/number-loop-leading-rows.test.ts
    node scripts/test.mjs test/number-loop-filtered-fills.test.ts
    node scripts/test.mjs test/differential.test.ts -t euler/526_largestprime

The moderate-limit independent scalar oracle uses C++ uint128 arithmetic,
deterministic Miller-Rabin, complete trial division, and per-residue descending
search, without Rank tensors or ragged expansions:

    c++ -O3 -std=c++17 benchmarks/experiments/euler526-oracle.cpp -o /tmp/euler526-oracle
    /tmp/euler526-oracle 100000000000 99994514441

The optional witness seeds only a trial-division-verified lower bound.
An independent exhaustive largest-prime-factor sieve checks the demo at small
limits and both sides of the direct-search and wheel boundaries. Official
examples, the corrected 10^11 maximum and the full default are regression tests.
