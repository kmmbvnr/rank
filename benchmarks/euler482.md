# Euler 482: exact windows and compact extreme scans

The program sums the perimeter and three integer incenter-to-vertex distances of every qualifying integer-sided triangle through perimeter 10,000,000. The full answer remains **1400824879147**. The input and final square/divisibility checks are retained; the improvements remove impossible candidates before constructing their temporary arrays.

## Completeness and exact bounds

Put x=s-a, y=s-b, z=s-c, with inradius r and vertex distances h_x,h_y,h_z. Then r^2=xyz/(x+y+z), and h_x^2=r^2+x^2. The half-angles sum to pi/2, so

`r = h_x h_y h_z / (xy+xz+yz-r^2)`.

The right side is rational. Also `(2r)^2 = 4h_x^2-(p-2a)^2` is an integer, hence 2r is an integer. Odd p would make its square 3 modulo 4, which is impossible. Thus p is even and r,x,y,z are integers. Enumerating integer Pythagorean legs therefore does not omit solutions with a fractional or irrational inradius. The small brute-force oracle independently enumerates all integer side lengths and does not assume this lemma.

The radius bound is now exact: `r <= isqrt(P^2 // 108)`. For fixed r,x and hypotenuse h_x, the least possible semiperimeter is `(r+h_x)^2/x`. A primitive triple `(r0,x0,h0)` therefore needs only scales

`k <= min(R//r0, H*x0//(r0+h0)^2)`, where H=P//2.

This inequality also implies h_x+r<=H and hence m<=isqrt(H) in Euclid's primitive-triple parameterization. Both orientations of each primitive triple are retained.

For x<=y<=z, first require x^2<=3r^2 and y>r^2/x. The perimeter condition becomes

`(2y-(H-x))^2 <= (H-x)^2 - 4H r^2/x`.

We compute the floor of this discriminant using integer quotient and remainder. Negative discriminants are discarded. If t is its integer square root, the lower bound is `ceil((H-x-t)/2)`. The upper bound is `min((r^2+r*h_x)//x, (H-x)//2)`, using z>=y. These are exact integer bounds, including endpoints. Existing `upperindex` batches locate the resulting windows in sorted `(r,x)` keys; a second merged query sort is no longer needed. Chunk boundaries also use `upperindex` on prefix counts instead of scanning a whole Boolean mask.

At the default input, retained leg records fall from **8349006 to 6483473**, and candidate pairs from **44598260 to 16249817**. The historical issue estimates were larger than the current baseline; the measured counts above are used here.

## Program and general runtime repair

Ordinary Rank functions scope triple construction, window preparation and chunk processing. A shared `expand` function labels ragged rows with prefix sums and `scan max`. There is only one explicit loop, in chunk processing; there are no nested Rank loops. Names describe the data, postfix operands are explicit, and all Rank lines fit 40 columns.

The existing native axis scan supported compact Int32 min/max prefixes, but the ordinary unranked spelling still used the per-cell callback path. Seedless rank-one standard min/max scans now reuse that backend. Binding identity and the original call implementation are checked; seeded, custom, non-Int32 and observed/cancellable paths keep their previous dispatch. Min/max results cannot widen beyond their Int32 inputs, so the axis backend writes directly to Int32 output instead of allocating Float64 scratch and copying it back. The output owns independent storage. No Number-mode threshold or language semantics changed.

During delivery, main gained separate compact accumulation, choice, prefix-sum and loop-admission changes. They are preserved. Final controls freeze **b82ce982** after those changes and measure only the additional Euler 482 work; earlier pre-integration samples are retained separately and are not the final baseline.

## Measurements

| Host | Mode | Change | Seconds | Peak MiB |
| --- | --- | --- | ---: | ---: |
| Mac | compiled | Original | 12.322 | 2803.3 |
| Mac | compiled | Runtime only | 8.493 | 2580.8 |
| Mac | compiled | Program only | 5.348 | 1364.4 |
| Mac | compiled | Both | 3.753 | 1306.0 |
| Mac | reference | Original | 13.811 | 2873.2 |
| Mac | reference | Runtime only | 10.097 | 2700.7 |
| Mac | reference | Program only | 6.080 | 1478.6 |
| Mac | reference | Both | 4.714 | 1370.8 |
| Intel | compiled | Original | 29.987 | 2041.5 |
| Intel | compiled | Runtime only | 20.889 | 1974.5 |
| Intel | compiled | Program only | 12.679 | 1008.6 |
| Intel | compiled | Both | 8.921 | 917.1 |
| Intel | reference | Original | 32.919 | 2054.6 |
| Intel | reference | Runtime only | 24.176 | 1998.2 |
| Intel | reference | Program only | 14.867 | 1023.0 |
| Intel | reference | Both | 10.969 | 976.1 |

Both hosts had background load, including substantial Intel disk wait (about 24% in one observation). Compiled comparisons use three alternating fresh-process rounds; reference variants are individual fresh-process samples. CPU time, load, source hashes, runtime kernel hashes and process peak RSS are retained. No own test suite ran alongside a timed comparison on the same host.

A separate uncompiled-prefix probe repeats a million-element standard `scan max` six times after two warmups. It demonstrates the general runtime path, rather than relying only on this Euler program. These are illustrative single warmed-process pairs, not universal speedup claims. Mac: 205.41 → 10.26 ms; peak 371.6 → 171.5 MiB. Intel: 485.50 → 26.01 ms; peak 354.2 → 158.1 MiB.

Smaller chunks (262144 and 1048576 versus the existing 4000000) did not materially lower Mac peak RSS or elapsed time. An opposite-parity ragged Euclid grid also gave no clear memory benefit. Neither variant is delivered; the simpler measured code is retained. A CPU profile identified selection/gather work and callback/array allocation as more important than the already batched binary search, so no speculative word-search specialization was added.

## Verification and reproduction

Focused verification passed on both hosts across 26 files (Mac: 668; Intel: 668 tests), including compact scans, widening, safe-integer buffer conversion, cancellation/budgets, custom operators, source independence, packed broadcasts and adjacent Euler 764/781 regressions. Both selected differential cases passed on each host. Source and test TypeScript builds and all five exclusion-catalog checks passed.

The independent C++ oracle builds per-radius adjacency lists with the original loose pair bounds and exact 128-bit intermediate products. It confirms **1400824879147** from **177851** triangles and independently observes the baseline record/pair counts. The JS small-case oracle enumerates all integer-sided triangles, including odd perimeters, and checks squared incenter distances directly. Window tests check Pythagorean distances, ordering, equal radii and exact perimeter inequalities rather than fixing an implementation-specific number of candidates. Statement and larger fixtures remain unchanged.

The main program is restored to ordinary corpus audits. A focused full-input golden has a 60-second budget. No full npm test or exhaustive audit was run.

Build matching language and interpreter output, then run `node benchmarks/euler482.mjs compiled 10000000` or `reference`, optionally with `RANK482_EXPECTED=1400824879147`. Four-way controls use `node benchmarks/euler482-compare.mjs /absolute/frozen/interpreter/out/index.js 3 10000000 1`; the frozen runtime needs its matching language package. The final argument selects reference rounds.

For the native prefix probe, use `node benchmarks/experiments/euler482-scan.mjs`; `RANK482_RUNTIME` selects a frozen index.js path or file URL. Optional arguments select input size, repetitions and min/max. Build the independent oracle with `c++ -O3 -std=c++17 benchmarks/experiments/euler482-oracle.cpp`; run it with `10000000`.

[Raw measurements, exploratory variants and verification logs](baselines/2026-11-08-euler482.json) retain the distinction between pre-integration and final controls.
