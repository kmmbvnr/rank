# Euler 529: exact polynomial extraction and private histograms

Baseline: `563c31e3`. The historical issue says about 100 seconds. Current
baseline controls are 32.06 seconds / 1235 MiB on Mac arm64 and 89.51 seconds /
853 MiB on Intel x64, with the unchanged full answer **23624465**.

## Diagnosis and source changes

The old program already used a sound finite automaton, minimization and
Berlekamp-Massey inference. Its final coefficient extraction retained a quadratic
reduction table and two real-valued halves of that table, plus quadratic
square-product index vectors. It then performed 60 quadratic squaring/reduction
steps. Existing `convolve ... mod Prime` makes these tables unnecessary.

The new program keeps the automaton and its counting interpretation. Small
bit-position and reversed-bit lookup tables replace the loops over every bit in
individual transitions. Breadth-first closure batches all ten digits; partition
refinement and recurrence state use bounded `repeat ... till`/`repeat` helpers.
There is **one explicit loop**, generating the initial counts. Every Rank line
fits 40 columns, the existing `--n` and `--sd` arguments are retained, and the
floating-point conversions and `linalg` dependency disappear.

For the default target, the raw automaton has 19683 reachable states plus its
sink, minimizes to 2817 classes, and supplies 5644 initial cumulative counts.
Berlekamp-Massey gives the same degree-2772 recurrence. If its coefficient vector
is Q with Q(0)=1, form

    P = (initial_terms * Q) mod x^degree.

Bostan-Mori extracts [x^N] P/Q: multiply each numerator and denominator by Q(-x),
retain the numerator parity matching N and the even denominator coefficients,
and halve N. The two products use the existing exact modular convolution,
not floating-point approximation or an external native extension. Its retained
polynomial storage is linear in the recurrence degree rather than quadratic.

The immutable source/destination vectors for the counting histogram are
completed once. Each DP step accumulates into a fresh vector and normalizes it
once, after the histogram. For the default, at most 18944 non-sink edges each
contribute less than Prime, so every positive intermediate is below 1.9e13:
exact in Number but potentially wider than Int32. Larger unsafe intermediates
still take the existing exact replay path. Reducing after each individual update
is correct too, but performed worse in the reference prototype.

Only the necessary prefix is generated for small N; no recurrence inference or
polynomial extraction is done when that prefix already contains the answer.
The generalized target-one case includes the endpoint 10^N (all its digits can
be covered by a sum-one substring). The identically zero target-zero sequence
also avoids trying to convolve an empty numerator.

## General compiler repair

Streamed integer histograms previously treated Int32 storage overflow like a
Number precision overflow. They could discard useful work even when the result
was still an exact safe integer. A private buffer now widens to Float64 through
`PrivateNumericArray.store`, keeping pool and owner references consistent.
The hot Int32 pass keeps a stable destination buffer. At the first wide result,
it retains completed stores, promotes outside that pass and resumes checked
arithmetic at the next cell. Compact RHS buffers stay guarded and disjoint;
the destination's Int32 bounds are not reused after promotion. A resumed cell
is neither skipped nor accumulated twice. Dirty marks are resolved after the
complete alias/rebinding proof, so already-dirty locals need no per-cell mode
branches.

Managed integer-array aliases also gain discarded accumulating vector writes.
Selectors, RHS and modulus complete before copy-on-write detachment. Existing
register/dirty modes publish rebindings correctly and preserve saved aliases.
The lowerer records which scatter sites have this ownership proof, rather than
removing the general rebound-selection guard. Escaping compound array results,
early control, table metadata, observable demand budgets and cancellation keep
their ordinary paths. Real accumulation and other unsupported owned slices are
not newly admitted. No compiler rule recognizes this demo or its constants.

The selected final DP uses a fresh normalized next vector. An earlier modular
histogram prototype exposed the alias restriction and remains covered by a
small carried-state histogram regression; it is not necessary to retain that
slower reference representation just to exercise the compiler repair.

## Measurements

Node v24.15.0 on Mac arm64 and Intel i7-10750H x64. Compiled comparisons alternate
three fresh-process pairs: original source on the frozen baseline runtime, and
new source on the new runtime. No own benchmark/test jobs overlap on a host.
Additional source/runtime cross-controls isolate the compiler contribution;
reference controls are single runs. Intel initially passed an idle check, but
a separate corpus benchmark subsequently competed for CPU; the package sensor
reached 100 C. Our continuous Intel benchmark was stopped without touching that
other job. Its timing records are **provisional**, not isolated comparisons;
final low-priority correctness checks still pass.

Final Mac medians (seconds / peak MiB):

| Execution | Original source / old runtime | New source / new runtime |
| --- | ---: | ---: |
| Compiled, three alternating pairs | 32.146 / 1236 | 4.286 / 602 |
| Reference, single runs | 9.799 / 1222 | 5.426 / 673 |

The compiled improvement is about 7.5x, with roughly half the peak RSS. The
reference path improves too, rather than relying on a new compiled-only layout.
Peak RSS includes the parser, runtime, temporary allocations and retained arrays.

Cross-controls: the new source on the old runtime takes **12.132 s / 613 MiB**;
the old source on the new runtime takes **24.121 s / 1197 MiB**. Thus the compiler
repair helps both representations; the new algorithm supplies most memory savings.

A 10-million-update histogram control checks the common non-widening case.
Across three process pairs, warmed scalar/vector medians are **14.67 / 10.83 ms**
on the old runtime and **9.31 / 10.72 ms** on the selected runtime. A discarded
always-checked version had regressed this workload; cursor resumption preserves
the fast narrow pass. Euler 526 also stays unchanged: **3.961 / 3.961 s** across
three process pairs, with the same full answer.

Under concurrent Intel load, the earlier prototype pairs observed original runs
of 95-109 s / about 850 MiB and new runs of 12.8-13.3 s / about 403 MiB. The final
runtime's asserted full validation is 12.53 s / 404 MiB at low priority. These
records establish successful execution but do not support a precise quiet-host
speedup; repeat the performance comparison when the unrelated workload ends.

Final validation: TypeScript interpreter/test builds pass. The selected 30-file
Mac run has **1134 passes and one inherited counter-only failure**:
`number-loop-slice`, discarded `mod` transform, expects one Number entry and
observes zero; value/error comparisons agree. It was already reproduced before
task 519 and was not weakened. All 28 demo and 33 owned-scatter tests pass on Mac.
The final Intel ownership/accumulation/transfer/polling selection has **263 passes**,
and its full default answer is asserted. The filtered Mac differential covers
both the main demo and fixture: **2 files and 2 embedded test blocks pass**.
The full default is consequently removed from corpus execution exclusions.

Exploratory controls on Mac:

* Bostan-Mori alone: about 10.95 s / 731 MiB. Phase markers place about 8.33 s
  in initial-count generation, 1.32 s in recurrence inference and 0.70 s in
  coefficient extraction; these are instrumented observations, not final medians.
* A private helper alone does not close the Int32/rebound-write gaps.
* Modular updates with old lowering: 18.11 s / 740 MiB. With the repairs, the
  intermediate prototype takes 3.35 s / 638 MiB, but retains the old nested-loop
  automaton/inference layout. The final array form improves reference execution
  and memory while following the one-loop style.
* Mapping transition columns separately did not beat broadcasting the small
  digit axis (4.65 versus 4.53 s, similar memory), so the simpler broadcast stays.

The original reference run is faster than its compiled run: do not describe
32 seconds as the fastest available old execution, or attribute the whole gain
to compiler changes. The cross-controls report this explicitly.

## Verification and reproduction

An independent semantic oracle enumerates every decimal integer through 10^5,
marks every digit belonging to every substring of the requested sum, and counts
fully covered integers. It uses no automaton, minimization, recurrence or
polynomial extraction. It covers targets 0, 1, 2, 4, 7 and 10, at exponents
0, 1, 2, 3 and 5, across both compiled backends and the interpreter.
For target one, binary decimal strings give the independent large-exponent
identity T(N)=2^N; the test checks N=10^18. Target zero tests the zero-degree
recurrence. The original target-four/N=2000 fixture remains 603612384.
The [official examples](https://projecteuler.net/problem=529), T(2)=9 and
T(5)=3492, are now embedded fixtures too. The full answer remains 23624465.

33 owned-scatter regressions cover repeated-key +=/-=/*=, modular writes,
Int32 widening followed by safe/unsafe updates, saved/input aliases, index and
shape errors, selector/RHS error order, mutable iteration, metadata, warm
budgets/cancellation, escaping results, and exact resumption before/on/after
1024-cell block boundaries. Existing accumulation, compound,
transfer, vector, convolution and polling suites are checked separately.

    node benchmarks/euler529.mjs compiled
    node benchmarks/euler529.mjs reference
    node benchmarks/euler529.mjs compiled 2000 4

From `packages/interpreter`:

    node scripts/test.mjs test/euler529.test.ts
    node scripts/test.mjs test/owned-scatter.test.ts
    node scripts/test.mjs test/differential.test.ts -t euler/529_tensum

Original source: `fixtures/euler529-original.ra`. Raw records and hashes:
`baselines/2026-11-09-euler529.json`. A frozen baseline runtime can be selected
with `RANK529_RUNTIME=/path/to/interpreter/out/index.js`; set
`RANK529_EXPECTED=23624465` for an asserted full-scale benchmark.
Full suites and exhaustive audits are not run as part of these focused checks.
