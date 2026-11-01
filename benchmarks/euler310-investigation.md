# Euler 310: Nim Square

## Delivered implementation

The demo retains its array recurrence and uses a frequency-based count.
The compiler now lowers integer-array gathers from rank-one integer/real
sources (selectors may have multiple dimensions), scalar/vector `=` scatters
into rank-one integer/real arrays when the selection result is discarded,
and `first index where` over numeric vectors with boolean masks or direct
subject comparisons. Ordinary bindings retain their snapshots. Aliased scatter
selectors/RHS are copied before mutation; duplicate writes retain order.
Invalid indices, mask sizes, no matches and Number overflow replay normally.
Escaping scatter results and unsupported forms keep the ordinary path.

A related admission repair gives Number-only vector plans the same bounded
copy-cost probe as plans with an exact backend. Existing 64/262144-cell
heuristics and exact/reference replay remain in force. Range slices retain
their existing specialized lowering.

The demo uses an explicit `Seen not equal N` mask expression in its first-match
consumer. This avoids the temporary subject frame's reference COW copies,
while Number compilation fuses the predicate directly into the search. The
named K and V bindings are retained and published with their usual values.

### Delivery measurements

Three fresh serial processes per case, rotated order, Node 24.15.0. Median
parse + execute times, imports/startup excluded. Full input remains 100000;
every sample checks `2586528661783`.

| Host / case | Wall | CPU | Peak RSS |
| --- | ---: | ---: | ---: |
| Mac before, original | 4.387 s | 5.727 s | 562 MiB |
| Mac before, rewritten demo only | 2.435 s | 3.618 s | 699 MiB |
| Mac after, demo + compiler | 0.388 s | 0.514 s | 176 MiB |
| Intel before, original | 12.627 s | 16.379 s | 475 MiB |
| Intel before, rewritten demo only | 8.346 s | 11.531 s | 476 MiB |
| Intel after, demo + compiler | 0.916 s | 1.162 s | 162 MiB |
| Mac reference before, original | 13.427 s | 15.181 s | 722 MiB |
| Mac reference after, rewritten demo | 3.836 s | 5.317 s | 677 MiB |

The combined compiled improvement is about 11.3x on Mac and 13.8x on Intel,
with 69%/66% less peak RSS. Holding the rewritten demo fixed, compiler changes
alone give about 6.3x/9.1x. Reference improves about 3.5x, with a much smaller
memory reduction. Mac ranges remain broad for old/reference cases; new
compiled final-code samples are recorded separately below. Full reference remains audit-excluded.

Baseline is the preserved 4584dc82 build. A separate persistent-rope change
(d7ea45eb) reached main during this work; it is retained. The final complete
interpreter/language build was copied to Intel after timing and passed all
168 oracle comparisons again, plus three full-answer samples (median 0.916 s / 162 MiB).
Mac round 0 was conservatively discarded to avoid a possible overlap with
focused-test completion; an extra serial round replaces it. Accepted rounds
are 1/2/3 on Mac and 0/1/2 on Intel; raw discarded data are retained.
After the final pooled-operand lifetime fix, three fresh final-code compiled
samples per host replace the earlier after rows in the table. Old after rows
remain in the JSON as superseded data. The final code pins temporary gather
leaves while preparing subsequent operands, preventing scratch-buffer reuse
in expressions such as `(A Ix) + (A Jx)`. Both-host oracle checks were rerun.

### Delivered verification

- TypeScript workspace build passed.
- Nine focused suites passed all 409 tests, including 34 new selection tests
  covering pooled lifetimes and mask demand/error timing.
- 168 small-input comparisons per host: six variants, fourteen limits and both
  engines; every Grundy cell and answer agrees with the independent oracle.
- The demo fixture now covers 0, 1, 2, 4, 10 and the statement limit 29.
- Scoped type, differential and full-input compiled checks passed (3 tests);
  the full-input regression requires all three Number loops and no overflow.
- Scoped name facts, semantic-boundary, application-form and exclusion checks
  passed. No complete suite or exhaustive audit was run.

Delivery artifacts are `baselines/2026-11-01-euler310-delivery-*.json`.
To repeat the delivery series, preserve/build baseline 4584dc82 separately,
then run from this checkout:

```
node benchmarks/experiments/euler310-delivery.mjs /path/to/baseline/packages/interpreter/out/index.js /tmp/euler310-delivery.json all
```

## Earlier research and control experiments

Research on 2026-11-01 at `4584dc82`, following the first unfinished inventory
entry in [#447](https://github.com/kmmbvnr/rank/issues/447).
At that research stage the production demo and compiler were unchanged; the
`.ra` variants below are historical experiments, not the delivered demo.

The main bottleneck is missing whole-loop compilation of the array-based
Grundy recurrence. The mathematical DP is reasonable. A separate frequency
count improves the final combinatorial stage, especially in the reference
interpreter, but does not fix the main compiled-mode bottleneck.

## Measurements

Node v24.15.0 on Apple M5 and Intel i7-10750H (`root@jack.lan`). Three fresh
serial processes per case, with rotated case order. Imports/startup excluded;
parsing and execution included. The source is split before `Max =` to time the
Grundy recurrence and counting stage independently in the same interpreter.
RSS is the process high-water mark, including imported runtime. All full runs
assert the answer `2586528661783` for Limit=100000.

| Host / compiled variant | Median wall | Wall range | Median CPU | Peak RSS median |
| --- | ---: | ---: | ---: | ---: |
| Mac original | 8.010 s | 4.399–9.450 s | 9.529 s | 602 MiB |
| Mac scalar control | 0.265 s | 0.231–0.397 s | 0.408 s | 175 MiB |
| Mac scalar + histogram | 0.228 s | 0.196–0.248 s | 0.361 s | 172 MiB |
| Mac inline predicate + histogram | 3.830 s | 3.768–5.256 s | 5.433 s | 731 MiB |
| Intel original | 12.380 s | 12.370–12.640 s | 16.177 s | 473 MiB |
| Intel scalar control | 0.484 s | 0.479–0.498 s | 0.714 s | 160 MiB |
| Intel scalar + histogram | 0.434 s | 0.428–0.435 s | 0.642 s | 156 MiB |

The Mac was busy: final load averages were 4.94/3.71/3.52, with large timing
and GC/RSS variation. Do not treat the Mac ratio as a precise forecast. Intel
was steadier (final load 1.28/0.40/0.21); the scalar control is about 26x faster,
and the combined experiment about 29x faster, with roughly two thirds less
peak RSS. These are controls demonstrating the cost of current execution,
not measurements of an implemented array compiler optimization.

Mac original reference: median 13.803 s, 730 MiB. Keeping the original Grundy
code and replacing only counting with a histogram gave 9.412 s, 726 MiB,
with a broad 5.616–13.068 s range. The stage-specific result is clearer:
counting falls from 8.438 s to 0.088 s. The unchanged Grundy stage varied a
lot between these processes, so the total reference speedup is uncertain.
Full reference was deliberately run as a benchmark, not as an exhaustive audit.

Median compiled stage times:

| Host / variant | Grundy | Counting |
| --- | ---: | ---: |
| Mac original | 7.933 s | 0.078 s |
| Mac scalar | 0.205 s | 0.060 s |
| Mac scalar + histogram | 0.205 s | 0.023 s |
| Intel original | 12.258 s | 0.125 s |
| Intel scalar | 0.385 s | 0.103 s |
| Intel scalar + histogram | 0.385 s | 0.048 s |

## Why the original is slow

For each N, it creates square-move indices, gathers reachable Grundy values,
scatters a timestamp to `Seen`, builds a 128-cell boolean mask, and searches
for its first true cell. There are 21,032,170 square moves at the full input;
the maximum actual Grundy value is 74. Most of the work is mathematically
necessary for this DP, but the interpreter repeatedly prepares array
operations, bindings, masks and snapshots around it.

Original compiled diagnostics show:

- The Grundy loop has no compiled loop; only the two counting loops compile.
- 100000 individual tensor compilations and bulk writes.
- 12,800,000 computed mask cells.
- 41,819,061 typed cells published during Grundy computation.

The first recorded exact-loop rejection is `MaterializeExpression` in the
range binding. This diagnostic alone is misleading: Number lowering already
handles materialization and ranges. Instrumenting a copied runtime's rejection
path (outside production) reveals that Number lowering next fails on
`V = G (N - K * K)`, treating named vector K as an unavailable scalar. The
Number array emitter handles ranges and pointwise arithmetic but lacks this
non-contiguous gather. Removing the postfix `array` does not fix it.

There are two further independent blockers:

1. `Seen V = N`: general vector-index scatter is not lowered by the loop
   writer; its vector support currently covers arithmetic range slices.
2. `Seen first index where Missing`: the loop expression emitter has no
   `FirstIndexWhereExpression` lowering. Replacing only gather/scatter with
   scalar loops still fails here, in both exact and Number backends.

The scalar control performs identical square moves and timestamp writes,
then searches mex directly. It compiles as a single Number loop and creates
neither per-step arrays nor full boolean masks. This isolates execution cost
from an algorithmic change. The original counting code is retained in this
control.

## A separate counting improvement

[Problem 310](https://projecteuler.net/problem=310) counts unordered triples
of heap sizes including repeats. A position loses exactly when the three
Grundy values xor to zero.

Build `Freq` over all heap sizes 0..Limit. Let

```
Ordered = sum over a,b of Freq[a] * Freq[b] * Freq[a xor b]
```

with out-of-range values contributing zero. Burnside's lemma over the six
permutations of three heaps gives

```
Answer = (Ordered + (3 * (Limit + 1) + 2) * Freq[0]) / 6
```

The identity fixes `Ordered` triples. Each of the three transpositions fixes
`(Limit + 1) * Freq[0]`: the two equal heaps cancel in xor. Each of the two
three-cycles fixes `Freq[0]` triples with all heaps equal.

This replaces the prefix/suffix sweep's 100001 * 75 iterations by a single
frequency pass and 75 * 75 value pairs. No approximation is involved; all
full-input intermediate integers fit Number's safe range. It requires only
one frequency array instead of two, and is independent of the compiler work.

## Shorter mex syntax: a memory trap

Replacing the named mask and search by

```
G N = Seen first index where not equal N
```

is correct and faster than the original in this experiment, but raises peak
RSS. Diagnostics report 99999 COW copies of Seen, copying 12,799,872 cells.
The clause condition binds its subject in a temporary `LocalFrame`; array
snapshot ownership survives the immediate search and the next write must
copy. This version computes only about 2.67 million predicate cells instead
of a full mask per iteration, but retains the interpreter and snapshot costs.
It is not the recommended final performance solution.

A possible general reference improvement is a read-only borrowed subject for
proven pure immediate predicates. It would need separate alias/callback/error
checks; blindly suppressing snapshots would change language semantics.

## Recommended implementation scope

Preserve the compact array-oriented recurrence and implement reusable loop
support for typed gathers, vector-index scatter and first-match consumers.
Use the scalar control as a performance target, not as a reason to make all
Rank programs scalar.

Correctness boundaries matter:

- Ordinary `=` bindings K, V and Missing must keep their observable values,
  snapshots, evaluation order and error timing. Reuse private scratch where
  safe and publish final bindings; do not turn eager `=` into deferred plans.
- Gather indices must be validated with normal error order and shape rules.
- Scatter selectors and RHS must be prepared before stores, including aliased
  inputs, duplicates, invalid indices, empty selections and scalar expansion.
- First-match needs length/rank validation and the existing missing-value error.
  Fusing a mask cannot skip observable effects or change a named eager binding.
- Number overflow must replay with exact arithmetic; ordinary errors must
  preserve the same successful preceding stores, cancellation and inspection.
- The existing 128-cell Seen capacity suffices for this input (max 74), but is
  not a general mathematical bound for arbitrary CLI limits. Do not encode it
  in a compiler optimization.

Add the histogram counting improvement independently. A future array compiler
implementation needs its own correctness suite and fresh benchmarks before
claiming the control's speed or memory savings as delivered.

## Verification and reproduction

`euler310-verify.mjs` now checks 168 runs: six variants, fourteen limits from 0 to
1000, both compiled and reference. Every answer and every Grundy cell matches
an independent JS recurrence. Limits through 30 also use exhaustive heap
triples. The full JS oracle counts multiplicities by sorted Grundy triples
and binomial coefficients, independently of the Burnside formula, and gives
2586528661783. The repository fixture's 29 -> 1160 case is included.

These historical measurements preceded the implementation described above.
No full suite or exhaustive audit was run during research.

```
node benchmarks/experiments/euler310-verify.mjs
node benchmarks/euler310-investigation.mjs compiled 100000 original split
node benchmarks/euler310-investigation.mjs compiled 100000 histogram split
node benchmarks/experiments/euler310-series.mjs /tmp/euler310.json all
# For the shorter compiled series on Intel:
node benchmarks/experiments/euler310-series.mjs /tmp/euler310-intel.json compiled
```

Raw data: `baselines/2026-11-01-euler310-{mac,intel,verification}.json`.
