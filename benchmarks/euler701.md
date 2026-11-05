# Euler 701: runtime costs and batched frontier DP

Issue: https://github.com/kmmbvnr/rank/issues/520

The default 7×7 board now finishes in minutes and gives
`13.510998363327158`, or `13.51099836` rounded to eight decimal places.
Its exact weighted numerator is `7606015899310446`, with denominator `2^49`.

## Runtime changes first

The original demo is retained in `fixtures/euler701-original.ra` so runtime
improvements can be measured independently from the algorithm rewrite.

| Original demo, 5×5 | Before | Runtime changes only |
| --- | ---: | ---: |
| Mac, compiled | 17.000 s | 10.132 s |
| Intel, compiled | 85.437 s | 51.307 s |
| Mac, compilation disabled | 15.005 s | 15.153 s |

These are individual fresh-process samples, not medians. Both hosts used Node
v24.15.0. The Intel host is an i7-10750H. Its comparison series ran while the
separate full reference-mode validation was active; absolute timings vary with
load. Earlier Intel runtime-only 5×5 measurements were around 43 s.

Two general changes are implemented:

* `shl` and `shr` lower into the existing tensor DAG, with scalar temporaries
  shared by the expression emitter. A decode or encode followed by a reduction
  can avoid intermediate arrays. BigInts remain exact, negative counts retain
  their ordinary errors, and shifts cannot overwrite an input buffer before
  all cells succeed. This extends existing IR rather than adding a separate
  Euler-specific compiler path. It is not a full SSA migration.
* `min axis` and `max axis` over completed Int32 storage fold directly into a
  typed output. The runtime no longer builds and validates a temporary array
  per row. This path also works with compilation disabled. Host readers,
  empty-axis errors, custom reducers, cancellation and non-Int32 domains keep
  their existing behavior.

A 100,000×7 Int32 `min axis 1` probe dropped from 93 to 6 ms on Mac and from
249 to 9 ms on Intel with compilation disabled. The old path reported 100,000
computed frame cells; the new path reports zero and keeps typed output.

Unconditional shift fusion was a measurable regression for one large shift
of completed typed storage followed by `sum`: roughly 27→39 ms on Intel.
The final cost rule keeps this case on the existing native word-pair kernel
above the existing dense-array threshold. Small arrays and composed graphs
still fuse. The native path deliberately retains its intermediate buffer
when it is faster; memory and time are different measurements.

## What the profile showed

The original 5×5 CPU profile spent 18.3% of self samples in GC. Array creation,
derived readers, rank dispatch, binding and COW copies were spread over many
other frames. The three index helpers (`indexKey`, `indexGet`, `indexSet`)
accounted for only 84 of 13,347 self samples, about 0.63%; this is not an
inclusive timing of all keyed-application dispatch.

The original demo compiled no loops: its enclosing loops encounter `new
index`, the state loop encounters unsupported array/scalar lowering, and the
binary-branch loop contains `findall`. Consequently even seven-element
expressions repeatedly pass through interpretation and completion machinery.
`shl … sum` was an additional tensor-compilation gap, now fixed.

In the unmodified 5×5 demo, diagnostics report 283,093 COW copies and
1,584,032 copied cells, both before and after the runtime changes. The runtime
fix improves execution time; it does not solve those aliasing costs.

## Separate solution rewrite

The demo has one loop, over cells. The `blank` and `paint` functions apply
the empty and filled transitions to all states as arrays; `coalesce` merges
the results. Singleton selectors retain column shapes without a state-count
reshape. Labels use the first frontier
position of each region; sizes are carried per occupied frontier position.
The best area includes open regions, so states whose smaller closed maxima
are already subsumed can merge. The shorter board side is the frontier.

One integer key packs labels, sizes and the best area. Sorting, marking run
starts, prefix summing their marks, and `sum by` combine equal states using
existing language operations. There is no per-state `new index` lookup or
state-by-state array mutation. Transition bindings are assigned once inside
the function. Names use English words and every Rank source line is at most
40 characters.

| Final demo | Mac compiled | Mac reference | Intel compiled | Intel reference |
| --- | ---: | ---: | ---: | ---: |
| 5×5 | 0.661 s | 0.965 s | 1.871 s | 2.771 s |
| 6×6 | 7.739 s | 13.099 s | 21.694 s | 37.847 s |
| 7×7 | 129.783 s | 240.923 s | 335.677 s | 636.578 s |

The full compiled run peaked at about 2,524 MiB RSS on Mac and 2,099 MiB on
Intel. Reference runs peaked at 2,684 MiB on Mac and 2,176 MiB on Intel. The rewritten demo
reports zero COW copies and zero typed-array unpackings; that does **not**
mean zero allocations. Whole-state matrices, sorting scratch, key buffers and
normal completion boundaries still allocate substantial memory.

The packed representation accepts positive sides, a shorter side at most
seven, and at most 63 cells. Invalid dimensions raise an explicit error.

## Handwritten JS comparison: memory is not inherent to the DP

A subsequent direct JS implementation is in `euler701-js.mjs`. It uses the
same frontier states, canonical labels, best-so-far state and empty/filled
transitions. All 49 per-cell state counts match the instrumented Rank run,
including the peak of 1,355,090 states. Both produce the exact numerator
`7606015899310446`. Cases 2×2 through 7×7 also check known exact totals and
probability mass.

| Full 7×7, fresh process | Mac time | Mac peak RSS | Intel time | Intel peak RSS |
| --- | ---: | ---: | ---: | ---: |
| Rank compiled, prior uninstrumented run | 129.8 s | 2,524 MiB | 335.7 s | 2,099 MiB |
| Direct JS, sample 1 | 1.93 s | 487 MiB | 3.68 s | 207 MiB |
| Direct JS, sample 2 | 1.99 s | 477 MiB | 3.74 s | 221 MiB |

The algorithm is shared, but this is not a literal translation of every array
expression. JS streams each transition through seven-cell scratch arrays,
stores labels in Uint32 and the packed areas/best in exact Float64 integers,
and radix-sorts those two fields. All integer fields and counts fit exactly
for at most 49 cells; this benchmark does not implement Rank's general
arbitrary-integer semantics or its larger permitted grids. Thus the timing
ratio includes representation, transition fusion and sorting differences,
not only interpreter dispatch.

At peak state count, JS needs 25.8 MiB for the current packed state table. Its
conservative tally of the old state, both candidate branches, both radix
position buffers, merged output and histogram peaks at 118.5 MiB. This tally
counts some scratch whose lifetime need not overlap the merge. Actual RSS is
higher because it also includes the VM, allocations awaiting collection and
allocator-retained pages. Forcing GC after every JS cell reduced Mac RSS to
375 MiB and took 2.11 s; those forced-GC results are diagnostic, not the main
comparison.

`euler701-memory.mjs` samples Rank storage and process memory at transition
boundaries. The instrumented full run took 130.3 s and peaked at 2,862 MiB RSS
(observation changes allocation/collection timing). At the last cell's input,
the current state alone occupies 129.2 MiB: labels use BigInt64, sizes Int32,
and best/ways BigInt64. Tags and sizes are expanded to N×7 matrices, whereas
JS keeps the equivalent information packed throughout the transition.

The sampled ArrayBuffer high-water mark is 947.9 MiB, at the final key stage.
It includes current and temporary buffers plus buffers awaiting GC; it is
not a retained-live-memory measurement. The sampled heap-used maximum is
473.0 MiB at another stage. The 69-bit combined Rank key exceeds signed Int64
storage and is boxed; the final 2,710,180-candidate key array and the unique
keys were observed as boxed arrays. Row masks, both transition branches,
shifted area matrices, concat/copy operations and sorting add further
allocations. Their lifetime and completion boundaries are the next compiler
and runtime optimization targets. Peak RSS must not be described as the
amount of memory intrinsically required by 1.36 million states.

Reproduce with `node benchmarks/euler701-js.mjs 7` and
`node benchmarks/euler701-memory.mjs 7`; optional JS GC diagnostics use
`node --expose-gc benchmarks/euler701-js.mjs 7 --gc`. Raw traces, repeats and
per-cell equivalence checks are in `baselines/2026-11-05-euler701/memory/`.

## Remaining implementation weaknesses and interface question

The reference path still pays substantial per-cell reader and rank overhead.
Record fields and several array operations remain compiler boundaries.
The intended source-level control is explicit: `X = Expr` completes and
retains a result; `X' = Expr` preserves a plan and repeated demand recomputes.
Do not automatically erase ordinary materialization boundaries or memoize
plans. Any future SSA work should preserve that visible execution model;
users should be able to inspect passes and allocations. Buffer reuse must
preserve aliases and failure behavior. This task changes only demo helpers
and indexing syntax, not compiler lifetime decisions.

No new library primitive was required or added. One candidate to discuss is
`Keys unique .indexed` in `sequences`, returning distinct values in first
appearance order and a same-shaped inverse group-index array. Then weights
could use `Weights sum by Groups` without sorting wide keys first. The open
questions are whether the result should be a tuple or record, whether to
start with rank-1 inputs, and how its memory contract should be exposed.
This is a proposal, not implemented syntax.

## Reproduce and verify

Build with `node node_modules/typescript/bin/tsc -b tsconfig.build.json`, then:

```sh
node benchmarks/euler701.mjs 5 compiled
node benchmarks/euler701.mjs 7 compiled
node benchmarks/euler701.mjs 7 reference
node benchmarks/euler701.mjs --kernels
RANK_SOURCE=benchmarks/fixtures/euler701-original.ra \
  node benchmarks/euler701.mjs 5 compiled
```

`RANK_ROOT` selects a separately built runtime; `PROFILE` optionally writes a
Node CPU profile. The original runtime comparison used a copy of the prechange
interpreter output. Raw results and compressed profiles are in
`baselines/2026-11-05-euler701/`.

Correctness checks include independent exhaustive flood fill of binary boards
up to 12 cells, rectangular transposes and one-dimensional cases, comparison
against the original DP, exact total probability mass, packed integer boundary
values, errors, alias preservation, builtin replacement and cancellation.
The native Rank demo test also checks 2×2 and 4×4.

Verification: TypeScript build, semantic boundaries, application-form checks,
11 script tests, focused runtime suites and the native Rank demo test pass.
The final Intel selection passes 74 tests in four files.

The ordinary interpreter run excluded `types`, `differential` and `nurikabe`.
It passed 12,329 tests in 575 files and found four pre-existing diagnostics expectations in `tensor-bounds` (one),
`runtime-diagnostics` (one), and `tensor-compound` (two). The same three files
were rerun against a separate copy of the prechange source: the identical
four assertions fail there, with 62 other tests passing in both copies.
No unrelated test or runtime changes were made to hide those failures.
See the baseline/current failure logs beside the raw measurements.
The exhaustive type, differential and Nurikabe audits were not started.

## Readability follow-up

The loop now names all three stages explicitly:

```rank
for Cell in 0 till Cells
  Row = Cell mod Span
  Empty = State blank Row
  Filled = State paint Row
  State = Empty coalesce Filled
end
```

`Count` and four explicit column reshapes were removed using singleton
selectors (`Tags # (array Row)`); the reduction result uses `reshape # 1`.
Existing `rank` can also assemble a column when a row helper returns a
one-element vector. `First min rank 1` alone returns shape N, while the
following helper gives N×1 (also for an empty leading frame):

```rank
fun Values minimum
  return array (Values min)
end
Root = First minimum rank 1
```

No new keep-dimensions modifier was added. The demo uses the existing chain
`Root = First min rank 1 reshape # 1` without a separate row helper.

Before replacing the axis fold with the requested `rank` chain, the simplified
demo on Mac took 0.682 s for 5×5, 7.447 s for 6×6, and
145.366 s / 2,404 MiB RSS for 7×7. The full result and exact numerator remain
unchanged. These are individual measurements; the prior 7×7 sample was
129.783 s, so this readability refactor is not claimed as a speedup.
The 30 focused Euler tests and the native Rank test pass. Intel 6×6 took
21.776 s and retained the exact numerator `738221900249`. Raw samples
are in `baselines/2026-11-05-euler701/readability/`.
The final `Root = First min rank 1 reshape # 1` variant was rechecked at
6×6: 9.048 s, exact numerator `738221900249`. This syntax change is not
claimed as a performance improvement; its raw sample is `mac6-rank-chain.json`.
Research and the proposed classification interface are tracked in #528:
https://github.com/kmmbvnr/rank/issues/528
