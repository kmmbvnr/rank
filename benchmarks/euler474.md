# Euler 474: compact matrix rows and bounded table construction

The initial full compiled CPU profile took 86.993 s. About 37.5 s was in the `Integer32Items.slice` adapter: selecting a matrix row boxed each Int32 cell as BigInt and produced a BigInt64 copy. Selector preparation and gathering were also substantial. The main program performs about 78,500 prime steps over 5,000 unit residues.

## General runtime fix

Partial scalar addressing of a completed numeric array now takes a native copy of its physical Int32 cells. It preserves compact storage and avoids per-cell boxing and widening. BigInt64 and real row copies keep their existing behavior. A row of 4,000 compact integers owns 16,000 bytes rather than widening to 32,000 bytes.

The row remains independent: retaining a small row does not retain the entire parent buffer or cause a later overlapping parent write to copy the matrix. An earlier shared-row prototype ran faster, but was rejected because those memory costs can be large in other programs. Existing explicitly shared slice operations are unchanged. No Number-mode threshold or language semantics changed.

With the original Rank program and CPU profiling enabled in both runs, the selected runtime change reduced full compiled elapsed time from 86.993 to 33.576 s, preserving **9690646731515010**. Peak RSS in these individual profiled runs was 935.5 versus 1053 MiB, so this is not a claim of lower whole-process RSS from the runtime change alone. The physical row allocation is halved and the boxing work is removed; process GC behavior remains variable. The rejected shared-row prototype took 30.407 s and 952.6 MiB.

## Program changes and correctness

The multiplication-permutation table is built in blocks of 256 rows. It retains its 25 million Int32 entries at the default input, but avoids full-size intermediate arrays. Unit positions use the regular ordering of units modulo powers of 2 and 5. The one-step permutation is a lazy name and is evaluated only when the binary geometric sum needs it. Helpers use at most one loop each, with no nested Rank loops; lines fit 40 columns. Factorization uses the existing library.

The old reduction assumed both valuations of D were strictly below its decimal digit count. This missed the statement example F(12!,12)=11: the old program returned zero. The new reduction caps extracted valuations at the digit count and includes remaining powers of 2 or 5 in the unit DP when appropriate. Units are selected by gcd with the actual modulus, including pure powers of 2, pure powers of 5 and modulus 1. Zero and tiny factorials are covered as well.

Small oracle tests enumerate actual divisors of factorials and cover saturated valuations, trailing zero, pure-prime-power moduli and N=0/1. All three numeric backends retain the existing imported examples and the added statement example. A separate C++ oracle constructs permutations on demand and reduces every addition, without a quadratic table or a deferred growth budget. It confirms the full answer **9690646731515010** and F(12!,12)=11.

## Execution lanes and measurements

The default still performs hundreds of millions of residue updates. It stays in the explicit full-scale lane, with a selected compiled golden test budget of 180 seconds. Its small fixture remains in ordinary corpus audits. No exhaustive audit or full npm test is used here.

Fresh-process controls use N=10000: original source/runtime, original source with compact row copies, and the final program/runtime. Comparisons alternate their order. Both hosts have background activity; Intel also runs a separate benchmark controller and a ZFS scrub. These are loaded-host observations, not idle-machine timings.

On Mac, the final default built-runtime runs completed in 37.497 s compiled / 686 MiB and 39.273 s reference / 812 MiB. These individual runs are separate from the profiled runtime ablation above. The block constructor trades some elapsed time for bounded temporary storage; no universal optimality is claimed for its block size.


## Paired controls and final verification

N=10000, medians of three alternating fresh-process comparisons:

| Host / mode | Original seconds / MiB | Compact rows only seconds / MiB | Final seconds / MiB |
| --- | ---: | ---: | ---: |
| Mac compiled | 1.525 / 759.5 | 0.808 / 739.2 | 1.014 / 553.7 |
| Mac reference | 1.558 / 729.7 | 1.089 / 750.5 | 1.357 / 569.0 |
| Intel compiled | 4.189 / 616.1 | 2.365 / 674.1 | 3.369 / 491.8 |
| Intel reference | 4.086 / 605.7 | 2.224 / 625.5 | 2.948 / 467.6 |

The final program trades some runtime relative to the runtime-only repair for lower temporary-table memory and broader correct input handling. The reference samples are noisy under background load; no universal RSS reduction is claimed for the runtime-only change.

On loaded Intel, full built-runtime completion took **120.361 s / 677.7 MiB compiled**, and **120.788 s / 696.8 MiB reference**. The separate source-level golden passed in **48.793 s on Mac** and **156.359 s on Intel**, within its explicit 180-second budget.

**205 focused checks in 11 files passed on each host.** The imported fixture differential selected one case per host and passed all three embedded test blocks. The separate full golden selected one case per host (56 other cases skipped). TypeScript source/test projects, semantic-boundary and application-form checks, and five exclusion-catalogue checks passed on Mac. No exhaustive audit or full npm test was run.

The independent C++ oracle also confirms N=10000, D=65432 gives 9468684253405479. Reproduce paired controls with `node benchmarks/euler474-compare.mjs /path/to/frozen/interpreter/out/index.js`; the frozen baseline needs its matching language package. Run `node benchmarks/euler474.mjs compiled 1000000` or `reference` for the full program, optionally setting `RANK474_EXPECTED=9690646731515010`. Build the native oracle with `c++ -O3 -std=c++17 benchmarks/experiments/euler474-oracle.cpp`.

Selected raw measurements, rejected variants, verification logs and source hashes are retained in [the baseline record](baselines/2026-11-08-euler474.json). The old shared-row prototype is recorded as rejected; it is not the delivered runtime behavior.
