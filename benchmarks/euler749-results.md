# Euler 749: exact weighted axis sums and bounded digit counts

Issue: https://github.com/kmmbvnr/rank/issues/550

The default Length=16 answer remains `13459471903176422`.
Changes were evaluated in this order: language execution, temporary storage,
then the Rank solution's search.

## Full-input measurements

Baseline: main `709f87e3`, with original source in
`fixtures/euler749-original.ra`. Node v24.15.0; Apple M5 arm64 macOS and Intel
i7-10750H x64 Linux. Timings include parsing and execution. Each host ran
one baseline and three serial final fresh processes, with ordinary CPU affinity.
Other system load and CPU frequency were not controlled. Baseline variance
was not measured; the ratios below compare one baseline with a final median.

| Host | Baseline seconds | Final seconds, all runs | Median speedup | Baseline peak MiB | Final median peak MiB |
| --- | ---: | --- | ---: | ---: | ---: |
| Mac | 145.38 | 44.86 / 46.11 / 49.80 | 3.15x | 1714.66 | 1561.02 |
| Intel | 241.39 | 90.71 / 90.52 / 91.59 | 2.66x | 1782.21 | 1641.44 |

Every full run returned the same answer. Median peak RSS fell 9.0% on Mac
and 7.9% on Intel. This is a modest memory improvement: RSS measures the whole
process high-water mark, including the count-vector construction and managed
heap, rather than only live numeric buffers. The issue's older 134-second,
2.6-GB figures are not substituted for current measured baselines.

Raw samples and calculated medians are in `results/euler749/`. Exploratory
samples are kept separately and are not pooled into the primary series.

## Language execution and storage first

An original-source CPU profile at Length=12 put `mapStoredInt32Binary` first
among named self-sampling functions (1801 samples). Other expensive paths
included general integer maps, dense broadcasting, `expandOperand`, stored
reads, axis reduction and garbage collection. These samples identify array
passes and materialization as the target; they do not establish that a single
source expression accounts for all runtime. Profile summaries retain the
sample counts and locations. The later fusion profile used Length=10 and
must not be compared as a same-size speed measurement. A final Length=12
profile is also retained: stored reads (504 self samples) and operand expansion
(244) led the named paths, with weighted-axis sums at 187. Its diagnostics
recorded 19 accepted weighted reductions and 2763982 output cells. This final
profile included diagnostic counters, unlike the initial sampling run; its
timing is not part of the benchmark series.

The evaluator now recognizes `(A * Weights) sum axis N` and attempts a native
weighted-axis reduction before allocating the product. This is automatic:
the original Rank spelling needs no explicit batches, `matmul`, or new syntax.
It accepts stored rank-two integer matrices and singleton weights along the
other axis, in either multiplication order, including proven transpositions.

Small matrix entries may be stored as Int32 or Int64. Int64 words are checked
for signed small-integer representation without boxing every cell. An
absolute-product bound proves all products and partial sums fit signed Int64.
When the bound fits 2^53-1, the contraction uses exact Number arithmetic;
otherwise signed high/low-word arithmetic preserves coefficients above 2^53.
Bounds that fit Int32 produce compact output; other accepted sums use Int64.

With 2042975 vectors and nine digits, a full product has 18386775 cells:
140.28 MiB of 64-bit numeric payload before the reduction. The fused path
writes only the 2042975 sums (15.59 MiB for Int64), avoiding the full product
on each accepted pass. It still scans the matrix to establish its bounds.
This allocation reduction is larger than the measured peak RSS reduction.

Unsafe bounds, wide matrix cells, real values, unsupported shapes, opaque
readers and unproven storage retain the ordinary product/reduction path.
Demand budgets and inspection decline the fusion. Native cancellation uses
bounded checkpoints during preparation and contraction. Operand evaluation
is not repeated on fallback, and the native sum binding is checked again
after evaluating operands, so rebinding it during evaluation stays observable.
`RuntimeDiagnostics.weightedAxisSums` and `weightedAxisSumCells` expose use.

With the original Rank source, an exploratory Mac run of the final arithmetic
path took 71.91 seconds and 1661.20 MiB, versus the 145.38-second baseline.
An earlier wide-word-only kernel measured 69.61 seconds on Mac and 130.70
on Intel. These single runs show a substantial runtime-only gain, but are
not a controlled comparison between successive kernel variants. They must
not be presented as the full final speedup.

A source-only Mac control ran the final Rank solution on the baseline runtime:
49.30 seconds and 1935.23 MiB. The final combined median is 46.11 seconds and
1561.02 MiB. Thus most of the end-to-end speed improvement after pruning is
already available through the Rank changes; the language optimization has a
smaller timing effect on that reduced workload and saves about 19.3% of peak
RSS relative to this source-only control. The two gains interact and their
speedup ratios must not be multiplied. This is one exploratory Mac control,
not a claim about its variance or its effect on Intel.

## Rank solution changes

The count-vector construction, digit signatures, two candidate branches,
modulo-nine check, decimal-digit validation and deduplication remain.
Two mathematical reductions follow the language improvement:

* A positive count of a digit with `digit^Exponent > Limit` cannot contribute
  a valid candidate: its sum is already too large. Equality is retained,
  since `Sums - 1` may still be below Limit. As powers increase monotonically,
  the solution shrinks Counts, Ids and Mod9 only when the allowed digit count
  decreases. Signature and Sizes retain their original index space; Ids maps
  selected vectors back into it.
* For odd k, every digit satisfies `d^k = d (mod 3)`. Decimal n is congruent
  to its digit sum modulo 3. Thus its power sum cannot differ from n by one.
  Only even exponents 2 through 52 need testing, rather than 1 through 53.

The first reduction alone, retaining all 53 exponents, measured 53.18 seconds
on Mac and 98.36 on Intel with the improved runtime. It is an exploratory
intermediate, not the primary final series. The combined result above includes
both changes. The source adds no nested loop or manual memoization cache.

A deferred `Matrix' = Counts transpose` experiment took 85.13 seconds and
1560.78 MiB on Mac, slower than the selected eager version. It remains in
`experiments/euler749-lazy.ra` and is not part of the delivered solution.
The first Int32-only fusion experiment declined the actual Int64 matrices;
its 118.50-second result is retained as an unsuccessful trial, not evidence
of an applied optimization. Trials overlapped short diagnostic/test activity
and should not be treated as controlled marginal-effect measurements.

## Verification and reproduction

The TypeScript build passed. Mac and Intel each passed 214 focused tests in
ten files, including direct integer contraction oracles, exact overflow
fallbacks, physical/permuted layouts, changing sum bindings, demand budgets,
cancellation, stored reductions, negative axes and broadcast operations.
The Euler tests compare Length=0 through 4 against independent enumeration
of decimal numbers and all 53 powers, in both compilation modes, and preserve
the Length=6 example `2562701`.

The full default golden test passed on both hosts, asserting the exact answer
and use of weighted-axis sums. It took 78.04 seconds on Mac and 181.27 seconds
on Intel under the TypeScript/Vitest runner with diagnostics. An initial
Intel run exceeded the former 120-second test timeout (178.64 seconds);
the Euler 749 full-input case now has a 240-second limit and passed on repeat.
That timeout is separate from the approximately 91-second standalone runs.
No full ordinary suite or exhaustive audit was run.

Build from the repository root:

```sh
npm run langium:generate
node node_modules/typescript/bin/tsc -b tsconfig.build.json
EXPECTED=13459471903176422 node benchmarks/euler749.mjs
```

The driver takes Length as its first argument; `reference` as the second
disables compilation. `RANK_SOURCE` selects a source fixture, `PROFILE` writes
a Node CPU profile, and `DIAGNOSTICS=1` includes interpreter counters.

```sh
RANK_SOURCE=benchmarks/fixtures/euler749-original.ra \
  EXPECTED=13459471903176422 node benchmarks/euler749.mjs
PROFILE=/tmp/euler749.cpuprofile node benchmarks/euler749.mjs 12
```

Run focused checks from `packages/interpreter` through its package runner:

```sh
node scripts/test.mjs test/weighted-axis-sum.test.ts \
  test/euler749.test.ts test/compact-integer-matmul.test.ts \
  test/packed-column-broadcast.test.ts test/application-role-cache.test.ts \
  test/integer-axis-reduction.test.ts test/sum-axis-stored.test.ts \
  test/negative-axis.test.ts
node scripts/test.mjs test/full-scale-demos.test.ts -t 749
```
