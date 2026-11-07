# Euler 468: ordered carry timelines

The full F(11111111) answer remains **852950321** modulo 1000000993. The [statement examples](https://projecteuler.net/problem=468) retain F(11)=3132, F(1111)=706036312 and F(111111)=22156169.

## Program

The affine-map interpretation is retained. For each binomial coefficient, the largest B-smooth divisor changes only when B crosses a prime. Each prime contributes a map `(product, weighted product)`, with the gap to the next prime as its weight. Composing maps in prime order gives the sum over B. The program sums only through the middle binomial coefficient and uses symmetry.

The old program built a smallest-prime-factor sieve, factored all integers through N, sorted factor events into leaf timelines, and packed each affine pair into a wide integer. Every merge level then unpacked both components again.

The new leaves use Kummer's carry formula. For prime p, the possible carry boundaries alternate `N mod p + 1, p, N mod p + 1 + p, 2p, ...`. Higher-power boundaries already occur among these points, so evaluating carries there gives the exact prime exponent. The leaves are generated in order with array operations, removing the factor sieve, factor-event construction and initial global sort. Coincident boundaries are valid; the subsequent latest-event selection preserves their common value.

Products and weighted totals remain separate compact arrays. Private functions scope initialization and merge intermediates. Existing array `powmod` replaces manual binary exponentiation. Each function has at most one loop, there are no nested Rank loops, and the main body has none. Every Rank line is at most 40 columns. The empty N=0 sum now returns zero.

Primes through 30 retain a separate vector calculation, avoiding their very dense event timelines. This cutoff is retained from the original program; it is not claimed to be universally optimal. Timeline sorting and merging remain substantial full-scale work.

## General runtime allocation change

The stored integer mapper already computes safe wide results in a private Float64 scratch before publishing exact Int64 words. It now reuses that buffer for publication, reading each double before overwriting its bytes. The conversion has a separate, narrowly typed helper. A successful wide result avoids one additional allocation of **8 bytes per cell** and its separate destination buffer.

The safe-integer admission checks, arbitrary-precision fallback, narrow results, input storage, broadcasting, cancellation polling and error paths retain their contracts. This changes private storage after arithmetic has completed. It introduces no language feature or Number-mode threshold change.

An earlier version wrote integer words during arithmetic and was slower. An inline publication version and a separate conversion helper were compared directly in three alternating pairs; their median times differed by about 1%, within broad observed ranges. The final change is justified by the removed allocation, not by a universal speed claim.

## Verification and execution lanes

Independent TypeScript tests build actual binomial coefficients and their B-smooth divisors. They cover zero, one, odd/even inputs, both sides of the small-prime split and boundaries around 31 squared, including cancelling first-power boundaries with a nonzero higher-power carry. All three numeric backends retain those answers. The imported fixture also runs with changed N on all three backends. Word-publication checks cover signed safe-integer boundaries, late widening of a compact prefix, broadcasts, exact fallback and independence from later input writes.

**296 focused checks in 15 files passed on both Mac and Intel with the selected implementation.** The exact-name-filtered differential fixture passed on both hosts, one selected case each. TypeScript and semantic/application checks passed; exhaustive audits and the full npm test were not run.

A separate full compiled golden test preserves F(11111111)=852950321 and requires Number-loop execution without overflow replay. On Intel its source-level Vitest run passed in 311 seconds. Its explicit budget is 360 seconds; other full-scale test budgets are unchanged. Earlier 240-second and externally capped 300-second attempts are retained as failures/stopped observations. The remote source snapshot was also corrected before final verification after two source files were found to differ from the built output.

The default remains excluded from repeated corpus audits because it still needs minutes and about 3 GiB. The small fixture stays eligible, and the exclusion catalogue explicitly checks both lanes. An independent C++ oracle factors successive binomial ratios and updates an online segment tree; it agrees with the statement examples and full answer. It serves as a mathematical cross-check of the offline Rank timelines.

## Measurements

All rows below use N=1111111, medians of three alternating fresh-process pairs, and the explicit loaded-host lane. Background activity is retained with each sample.

| Host / mode | Before → after, seconds | Peak RSS MiB |
| --- | ---: | ---: |
| Mac compiled | 8.820 → 6.367 | 1140.2 → 801.9 |
| Mac reference | 9.891 → 6.597 | 1159.3 → 800.4 |
| Intel compiled | 24.955 → 17.385 | 873.2 → 623.2 |
| Intel reference | 27.451 → 18.260 | 863.4 → 651.7 |

These paired loaded-host results show lower elapsed time and peak RSS on both hosts. They do not establish idle-host performance or a universal runtime speedup.

For the five-million-cell primitive, native buffers at the end of the call fall from 95.44 to 57.29 MiB on both hosts: the 38.15 MiB difference is the removed output buffer. Median process peak RSS is:

| Host | Before → after, peak RSS MiB |
| --- | ---: |
| Mac | 194.2 → 150.6 |
| Intel | 188.4 → 149.4 |

Repeated-call exploratory controls did not consistently reduce RSS, because changing allocation pressure also changes GC scheduling. The byte saving per successful wide publication is exact; whole-program RSS is measured separately.

Full final built-runtime observations on Intel, one process per mode:

| Mode | Seconds | Peak RSS MiB |
| --- | ---: | ---: |
| Compiled | 205.983 | 3274.4 |
| Reference | 227.522 | 3097.9 |

Both full observations return 852950321. The 311-second source/Vitest golden uses a different entry path from the standalone built-runtime runner; its duration is not a compiled/reference timing ratio.

All program comparisons use fresh processes, alternating order and identical inputs within each pair. Timing covers execute, including parsing, analysis and evaluation; process startup and interpreter construction are outside the interval. RSS is the process-lifetime high-water mark. Native allocation/publication counters account for only part of total allocation work.

Both hosts had other activity. The default driver rejects competing processes and monitor failures. An explicit `RANK468_ALLOW_CPU_LOAD=true` lane records competing processes and labels the result as a loaded-host observation; it retains source-hash checks and rejects monitor failures. On Intel it still rejects active swap I/O. This lane supports observations under the recorded load, not idle-host timing claims. Intel also had a scheduled ZFS scrub and another benchmark controller. Those jobs were left running.

The full original Intel baseline was stopped after about 70 seconds to avoid exhausting memory: swap was full and the process had already reached an observed 4182.5 MiB RSS. It produced no answer or accepted full timing. The issue's older seven-minute / 5.9 GB estimate is historical, not a controlled full before/after measurement. A full Mac baseline was avoided because the 16 GiB machine was already under memory pressure.

Rejected CPU-overlap samples, failed/stopped runs, exploratory algorithm variants and the final results are retained in [2026-11-08-euler468.json](baselines/2026-11-08-euler468.json). An alternative carry matrix with row counts was also tried: at N=1111111 it took about 31 seconds compiled, while its eager reference variant took 42 seconds and 1708 MiB. That formulation and its experimental compiler hook were not selected.

## Reproduction

Build the language and interpreter, then run from the repository root:

```sh
# The runner defaults to the bounded N=111111.
node benchmarks/euler468.mjs compiled
node benchmarks/euler468.mjs reference
# Explicit full input; allow minutes and several GiB.
node benchmarks/euler468.mjs compiled 11111111
node benchmarks/euler468.mjs reference 11111111
node --expose-gc \
  benchmarks/experiments/euler468-word-buffers.mjs .
```

`RANK468_RUNTIME` selects a frozen interpreter build. The comparison driver takes the baseline build root, output JSONL, host and workload (`scaled-compiled`, `scaled-reference`, `same-source`, `compat-source`). All use N=1111111 and three alternating pairs. Source/runtime controls keep one source unchanged. Reusing an output file requires its accepted prefix, inputs and source hashes to match.

`RANK468_ALLOW_IO_WAIT=true` enables the disclosed ZFS-background lane with at least 95% idle plus I/O wait before Intel samples. The default quiet lane requires 98% idle CPU. `RANK468_ALLOW_CPU_LOAD=true` selects the separately labelled loaded-host lane. Every lane preserves source hashes and process monitoring.

The independent oracle is `benchmarks/experiments/euler468-oracle.cpp`; compile with a C++17 compiler and pass N. The word-buffer experiment requires `--expose-gc`, warms a small input, collects garbage, then checks one 5-million-cell result and reports native buffer usage and peak RSS. Timing and GC scheduling in that primitive experiment should be interpreted separately from whole-program memory behavior.
