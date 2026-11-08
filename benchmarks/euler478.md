# Euler 478: bounded intermediates and scalar division in tensor recipes

The original program already used compiled array loops. The main improvements are in the Rank program: keep only exponent residues, avoid a stored slope array and its slices, flatten the prime-power sieve into one loop, and scope sieve/counting temporaries inside helpers. There is still a complete grouped Moebius inversion; the input and mathematical answer have not changed.

The full result is **59510340** at N=10,000,000. The primitive triple count is **831907565456419587823**. It needs exact wide arithmetic, while the subsequent exponents need only residues modulo phi(11^8)=194871710. Reducing the scalar half-count before broadcasting avoids a large array of unnecessarily wide intermediates. This is an explicit program rewrite, not an implicit algebraic reassociation in the compiler.

## Program and compiler changes

The sieve visits small prime powers with one cursor loop. Each prime changes the sign and totient once; its powers remove the cofactor, and square multiples have zero Moebius sign. The remaining cofactor is either one or a single large prime. The helper returns only the Moebius prefix and totients. A second helper accumulates coprime lattice counts from distinct quotients, using a range instead of gathering a prefix of a full stored slope vector. Each helper has one loop, there are no nested Rank loops, and all Rank lines fit 40 columns. Existing `primes`, `scan`, `unique`, `isqrt` and `powmod` operations are used. The bounded `factorsieve` library table cannot directly replace a sieve to 10 million.

The general compiler repair admits known, nonzero integer scalar `//` and `mod` inside tensor recipes. For example, `(Input + (Scale // Divisor)) sum` can now fuse instead of materializing the array arithmetic through the fallback path. It uses the existing exact floor-division and signed-remainder helpers. Zero divisors and broader numeric domains retain the previous path, preserving eager errors even for an empty array. Folded scalar values are refreshed on each binding; this does not freeze mutable globals or change Number-mode thresholds.

This compiler change has no demonstrated speed gain on Euler 478 itself. The four-way controls below put the final runtime about 3% behind the new program on the previous runtime on both hosts. The general expression probe separately confirms useful fusion: 12 reductions over one million elements took 99.50 → 56.81 ms on Mac and 258.98 → 171.59 ms on Intel, with 0 → 12 tensor entries. Those are single warmed-process pairs, not idle-host medians or a universal speedup claim. Process RSS was effectively unchanged for that probe.

## Controlled full-input measurements

Both hosts had background activity. Intel showed substantial disk wait (about 27% in one observation), so these are loaded-host comparisons. We alternated original/final ordering over three fresh-process compiled rounds. Reference results are one fresh process per variant. No test suite ran alongside our own timed comparisons on the same host.

Baseline interpreter and matching language output were frozen from 755a1a78. Four variants separate program and runtime changes. Values are seconds / peak RSS MiB; compiled rows are medians of three runs, reference rows are individual samples.

| Host / mode | Original source/runtime | Runtime repair only | Program rewrite only | Final source/runtime |
| --- | ---: | ---: | ---: | ---: |
| Mac compiled | 5.042 / 1935.9 | 5.056 / 1869.0 | 3.445 / 916.2 | 3.546 / 916.7 |
| Intel compiled | 13.804 / 1389.7 | 14.085 / 1351.4 | 7.632 / 727.6 | 7.847 / 727.7 |
| Mac reference | 5.480 / 1833.3 | 5.143 / 1861.0 | 4.225 / 1384.2 | 4.276 / 1516.4 |
| Intel reference | 15.113 / 1277.3 | 15.214 / 1303.0 | 11.810 / 847.9 | 12.019 / 809.5 |

The final compiled workload is about 30% faster on Mac and 43% faster on Intel, with roughly half the peak RSS. Reference also improves overall on both hosts, although allocator/GC variation is visible between equivalent reference-runtime variants. No general RSS reduction is attributed to the compiler repair alone.

Early single runs were much noisier: the original Mac program took 9.587 s / 1778.9 MiB and a scoped prototype with the compiler repair took 2.980 s / 822.5 MiB. These exploratory samples are retained in the raw record but are not the basis of the final speed claim. An exponent-only rewrite and a range-only variant were also tried before the helper rewrite; none changes the default problem size.

## Verification and execution lanes

459 focused checks in 19 files passed on each host. They cover scalar division/remainder signs, wide integers, refreshed bindings, zero divisors on empty/nonempty arrays, broader numeric fallback, aliasing, tensor cache/retention, compound updates, range writes and Number loops. The compound-tensor tests now disable the competing integer-loop tier so their existing kernel assertions exercise the intended backend; the previous entry-count mismatch was reproduced on the frozen baseline.

Euler-specific tests independently enumerate primitive triples and coprime lattice points at N=1,2,3,4,5,7,9,10,16,20 across all three numeric backends. They check every small totient and lattice-count entry, rather than only the final residue. The existing statement examples, including N=500, remain unchanged. The full compiled golden checks the answer, exact primitive count, totient sum **30396356427242**, H(1) equal to that sum, and H(N)=1. It passed in 4.172 s on Mac and 7.817 s on Intel under the test runner.

A separate C++ oracle uses a linear sieve, grouped scalar lattice loops and an exact 128-bit primitive count. It confirms the full answer and all full-scale quantities above. The filtered differential selected the main program and its fixture: two cases and two embedded test blocks passed on each host. Source/test TypeScript builds, semantic-boundary and application-form checks, and five exclusion-catalogue checks passed on Mac. No full npm test or exhaustive audit was run.

The main program is restored to ordinary corpus audits. Its small fixture stays there. The focused full-input golden has a 60-second budget.

## Reproduction

Build matching language and interpreter output. Run `node benchmarks/euler478.mjs compiled 10000000` or `reference`, optionally setting `RANK478_EXPECTED=59510340`. For the four-way controls, use `node benchmarks/euler478-compare.mjs /absolute/frozen/interpreter/out/index.js 3 10000000 1`; the last two arguments select input size and reference rounds. The frozen interpreter needs its matching language dependency.

Run `node benchmarks/experiments/euler478-scalar-division.mjs` for the separate general-expression probe; `RANK478_RUNTIME` selects a frozen `index.js` file URL. Its optional arguments are input size, repetition count and `//` or `mod`. Build the independent oracle with `c++ -O3 -std=c++17 benchmarks/experiments/euler478-oracle.cpp`; run it with `10000000`.

[Selected raw measurements and verification logs](baselines/2026-11-08-euler478.json) include source/runtime hashes, elapsed and CPU times, load, process memory, exploratory samples and both hosts' results.
