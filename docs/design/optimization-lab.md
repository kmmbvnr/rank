# Optimization experiments, September 2026

This log records the autonomous pass through the [roadmap](performance-roadmap.md).
The starting runtime is `f257042`. Work is on `perf/demo-roadmap` in a separate
worktree. Unrelated Euler additions in the main checkout are outside this pass.

## 1. Unchanged numerical demos: baseline collected

Run `npm run bench:numerical`. To compare a built checkout, add
`-- --baseline=/absolute/path`. The harness calls the functions from the unchanged
DeepML files and runs the unchanged Euler source with `--limit`. It checks every
answer against a JS loop or closed-form reference. Matrix multiplication also
checks the result shape. Lazy outputs are forced inside the compute timer.

Five warm samples follow one first call and two warmups. Five fresh processes
measure cold execution. Cold timing includes Node startup, imports, input setup,
the independent reference calculation and validation; it is not pure interpreter
time. Euler's warm samples also include parsing. Other warm samples time function
calls. Peak RSS includes the whole process; the final heap snapshot is not an
allocation count. Baseline/candidate cold process order alternates by sample.
Warm samples are grouped by runtime, with version order reversed at alternate
sizes; repeat comparisons in reverse order before accepting small gains.

Apple M5, Node 24.15.0. [Raw baseline](../../benchmarks/baselines/2026-09-11-numerical-demos-before.json):

| Unchanged demo | Input sizes | Warm medians, ms |
| --- | --- | --- |
| Euler 006 | Limit 100 / 20,000 / 200,000 | 0.5 / 2.2 / 15.5 |
| DeepML 004, rows | square 8 / 128 / 512 | 0.1 / 1.4 / 12.5 |
| DeepML 004, columns | square 8 / 128 / 512 | 0.1 / 1.4 / 13.0 |
| DeepML 009 | square 4 / 24 / 64 | 0.3 / 18.3 / 314.8 |
| DeepML 015 | 16 / 256 / 2,048 rows, 8 features, 20 steps | 1.2 / 9.8 / 75.1 |

CPU profiles of the largest cases identify different costs:

- Euler: scalar `power` and `evaluateBinary`, plus sequence generator layers.
  The named `Squares` is a lazy sequence, not an allocated arithmetic array.
  Removing array temporaries alone would not help this source.
- Matrix mean: `coordinates` and `tensorEntries` dominate sampled compute.
- Interpreted matrix multiplication: execution-task advancement, generator
  allocation/GC and selectors dominate. Compact storage alone cannot remove them.
- Gradient descent: transpose coordinates, transpose materialization and file
  discovery occur repeatedly. These deserve experiments before code generation.

Profiles are diagnostic samples, not speed comparisons. Reproduce a profile with
`node --cpu-prof benchmarks/numerical-demos.mjs --worker=gradient --scale=2`.
Other worker names are `euler`, `row`, `column` and `matmul`.

## 2. Sequence numeric kernels: benefit reproduced

Hypothesis: selecting the existing arithmetic kernel for sequences, as already
done for arrays, avoids repeated scalar dispatch. A guarded nonnegative BigInt
power can also bypass real-domain checks. Negative or real powers must retain
the existing error path. This is a smaller first experiment than cross-statement
fusion and directly matches Euler's profile.

Two paired comparisons used five warm samples per size. Euler at 200,000 fell
from 15.7 to 11.0 ms, then from 15.5 to 11.4 ms with the runtime order reversed:
26–30% less warm time. The second comparison's cold process median fell only 4%;
startup and setup remain in that measurement. At Limit 100 the second warm pair
was unchanged. The first pair was slightly slower at this small size.

The full numerical control comparison ranged from 5.7% faster to 8.2% slower
(the slower case was row mean at 512 square). No gain is claimed for these
controls. Their cold medians ranged from 2.3% faster to 1.4% slower.

Raw results: [first Euler pair](../../benchmarks/baselines/2026-09-11-sequence-kernel-euler-first.json),
[full reversed-order pair](../../benchmarks/baselines/2026-09-11-sequence-kernel-numerical.json).
All 432 JS tests and 164 demo files passed. New tests cover nonnegative integer
powers, exact large integers, negative/real-domain failures, empty sequences,
mixed arithmetic, both scalar sides, zipped sequences and repeated named sums.
The [row-mean repeat](../../benchmarks/baselines/2026-09-11-sequence-kernel-row-repeat.json)
reversed order: 15.3 to 15.0 ms at 512 square. The earlier 8% slowdown did not
repeat; absolute times rose for both runtimes. No row-mean speedup is claimed.

Scalar controls also passed. Five-sample extrema/alias controls ranged from
3.7% faster to 4.0% slower; playlist was 0.8% slower. Recursion `tree` was
37.4 ms in both versions; tail calls were 22.7 to 22.6 ms and accumulator tail
calls 25.8 ms in both. Ordinary calls were 14.8 to 15.4 ms. Memo manual/fresh
medians were 129.4/83.5 to 128.6/84.2 ms; cached calls were 0.2 ms in both.

All six CSES-scale checks passed at 200,000. One cold baseline/candidate pair
(ms): restaurant 2704.8/2624.9, rooms 2120.6/2061.8, playlist 541.4/511.8,
books 203.6/198.6, bounded-sum 935.7/914.9, sum 192.5/189.4. Single samples
are smoke checks, not evidence of an improvement. Source and benchmark changes
are kept; broader fusion remains conditional on a matching demo workload.

## Remaining experiments

The independent matvec oracle found a correctness bug in DeepML 001:
`Row * B sum` parses as `Row * (B sum)`. The official example returned nested
rows `[3, 6]` and `[6, 12]` instead of `[5, 10]`. Its Rank test returned a tensor
of false values, which the scalar-boolean assertion mechanism did not reject.
The demo is corrected to `(Row * B) sum` in a separate correctness commit, with
an internal JS test comparing exact scalar result items. This change is not an
interpreter optimization and is not counted as a speedup. Future matvec timing
uses the same corrected source against both runtimes, with source hashes saved.
Other array-valued demo assertions still need a separate correctness audit.
Correction commit: `96d1dc2`. The independent JS test passed. The corrected
matvec baseline at square sizes 8/128/512 was 0.1/2.4/26.5 ms warm; largest
peak RSS was 278.3 MiB. [Raw samples](../../benchmarks/baselines/2026-09-11-matvec-corrected-before.json).

## 3. Builtin-sum fusion: faster prototype rejected on correctness

The prototype shared arithmetic-plan construction with `+ reduce`, resolved
`sum` after preparing operands, and checked its identity against the builtin.
Only a transient inline arithmetic result could be fused. A shadowed function,
lazy input, named cached intermediate or different broadcast shape retained
ordinary execution. Sum kept its integer-zero seed and deferred summand type
errors until all arithmetic reads finished, as the materializing builtin does.

Two comparisons of the same corrected DeepML 001 source gave:

| Square size | First pair, before / prototype ms | Second pair, before / prototype ms |
| --- | --- | --- |
| 128 | 2.5 / 1.5 | 2.5 / 1.5 |
| 512 | 26.3 / 13.2 | 26.1 / 13.4 |

At 512 square, peak process RSS fell from 279 to 180 MiB, then from 276 to
178 MiB. These are prototype results, **not shipped improvements**.
[First matvec pair](../../benchmarks/baselines/2026-09-11-fused-sum-matvec-first.json),
[full second pair](../../benchmarks/baselines/2026-09-11-fused-sum-numerical-first.json).

The new k-means control uses unchanged DeepML 017, two known clusters and
independently checked centroids at 16/256/2,048 points. Its lazy `D * D` takes
the fallback. At 2,048 points it rose from 41.8 to 43.2 ms, then from 40.7 to
42.4 ms. Bypassing generic function application on the builtin fallback did
not remove the slowdown: another pair was 41.4 to 43.5 ms. The plan itself
still costs work before falling back. [First k-means pair](../../benchmarks/baselines/2026-09-11-fused-sum-kmeans-first.json),
[fallback experiment](../../benchmarks/baselines/2026-09-11-fused-sum-fallback-repeat.json).

All 81 array controls passed against both runtimes. Million-element named
intermediates changed by -2.5% to -0.6%; twice-used intermediates by -1.8% to
+0.1%. Inline mixed reduction was 8.3% slower in this pair, while integer was
1.0% slower and real 4.3% faster. At 100 elements, the real named control rose
from 34.8 to 39.3 microseconds. These samples do not settle the older fusion
regression report. [Full raw array controls](../../benchmarks/baselines/2026-09-11-fused-sum-array-controls.json).

The rejection came from a host Proxy test. The eligibility check calls
`Object.getOwnPropertyDescriptor(input, 'items')`. That call can execute a
Proxy trap and change the array. A one-element example returned `200n` in the
prototype and `2n` in ordinary execution. The six earlier correctness tests,
438 JS tests and 164 demo files had not covered this trap. The added test failed
before rollback and passed afterward.

Both production source files were restored to their committed versions and
rebuilt. Post-rollback `npm test` passed 439 JS tests, including six permanent
sum semantics tests; the fresh demo run passed all 164 files. The [rejected patch](../../benchmarks/experiments/fused-sum-unsafe.patch)
is saved for inspection only; it is not runtime code and must not be applied
without fixing its eligibility check. The k-means harness and raw results stay.

The existing `+ reduce` fusion uses the same descriptor probe. A separate live
check after rollback also returned `200n` for `(A * 2) + reduce` versus `2n` for
a named intermediate on the same kind of Proxy. This is an open pre-existing
correctness issue, not repaired by rolling back the sum extension.

Next prerequisite: identify runtime-owned array objects through private identity
metadata before inspecting storage. Unknown host objects must use the ordinary
path without extra descriptor or `has` traps. Origin alone is not immutability:
validate storage/prototype changes between calls without invoking user hooks.
An explicit host snapshot constructor could provide the same contract to JS
callers. Compact numeric storage can use this boundary too. Fix the older
reduction gate before trying the sum patch again.

Continue with builtin-sum fusion where it matches measured array workloads,
compact numeric storage, measured indexing/transpose paths, guarded generated
loops, and finally conservative mutation/alias analysis. Record failed attempts
here and remove their production code. No blanket performance claim follows
from the baseline or from a passing timeout.

## 4. Private storage: correctness repaired, performance costs remain

The next prototype identifies owned arrays in a private WeakMap before inspecting
their descriptors. Unknown objects, including proxies around owned arrays, take
the ordinary path without extra property probes. This repairs the existing
`+ reduce` example that returned 200 instead of 2. Numeric Rank literals and
materialized sequences receive private backing arrays. JS callers can request a
shallow copy with `createArraySnapshot`; existing host objects remain supported.
The [storage contract](array-storage.md) explains exposure, mutation and files.

Reading public `.items` disables the proof permanently. It also replaces the
original getter with a data field when configurable. Sealed and host-replaced
getters remain intact. The proof checks kind, shape, storage and prototype
descriptors without invoking callbacks. A row-copy loop revalidates between
iterations because its Rank body can mutate the next row's source.

Builtin `sum` now shares the inline arithmetic plan with operator reduction.
It preserves the BigInt-zero seed, floating-point order, arithmetic-error timing,
and resolution of a shadowed `sum`. Named intermediates retain their ordinary
caches. The common single-binary plan avoids allocating instruction-value arrays.
This is a worktree checkpoint, not approval to merge the whole prototype.

Measurements use the unchanged corrected DeepML 001 function, five warm samples
and five cold processes per size. The new `--storage=snapshot` mode copies inputs
for both runtimes; the baseline receives ordinary copies. Oracles use the input
formula rather than reading `.items` and accidentally exposing candidate storage.
Warm timing excludes construction; cold timing includes it.

At square 512, snapshot matvec was 26.0 to 14.9 ms in one pair, then 26.3 to
15.3 ms after the exposure change. The latter peak RSS was 277 to 208 MiB;
cold medians were 177.0 to 170.2 ms. At square 128, the latter warm pair was
2.4 to 1.9 ms. At square 8 it was about 0.08 to 0.09 ms. These results require
private inputs; ordinary JS matvec was 26.7 to 26.2 ms, not a comparable gain.

Costs are still visible in the full ordinary-input comparison:

| Largest control | Baseline, ms | Prototype, ms |
| --- | ---: | ---: |
| Euler 006 | 10.6 | 11.0 |
| DeepML 017 k-means | 41.0 | 43.4 |
| DeepML 004 rows | 12.2 | 13.2 |
| DeepML 004 columns | 12.6 | 13.4 |
| DeepML 009 matrix multiplication | 313.1 | 313.8 |
| DeepML 015 gradient descent | 76.3 | 79.1 |

The lazy k-means slowdown has repeated across variants. Do not describe this
prototype as a general acceleration. Its fallback plan and per-cell row branch
remain candidates for removal or revision before delivery.

The 81 snapshot array controls also expose a cost. Million-element named
reductions initially rose 22%; converting the exposed getter to a data field
reduced this to 7–15% in the next run. Twice-used values were still 5–9% slower.
Inline reduction was 10% faster for integer, 11% faster for real and 2% faster
for mixed values in that run. V8 diagnostics on Node 24.15.0 showed dictionary
properties for these per-object accessors. Replacing the literal constructor
with `Object.defineProperties` or `Object.create` did not retain fast properties
after the first instance. Those constructor alternatives were not added.

Other rejected variants:

- Branding every copied row, including unknown-host rows, slowed ordinary
  matvec from 26.6 to 30.4 ms. Only rows copied from validated private storage
  are now branded.
- Checking source eligibility once before the row loop let internal `.items`
  reads expose the matrix. Later calls lost fusion: snapshot matvec reached
  32.0 ms. Private internal reads and per-row validation replaced this variant.
- Bypassing the generic sum application alone did not fix lazy fallback cost.
  The specialized binary plan reduced, but did not remove, that cost.

Raw evidence: [development variants](../../benchmarks/baselines/2026-09-11-owned-arrays-development.json),
[first ordinary-input prototype](../../benchmarks/baselines/2026-09-11-owned-arrays-first-prototype.json),
[array controls and final snapshot matvec](../../benchmarks/baselines/2026-09-11-owned-array-controls.json),
[final ordinary-input numerical pair](../../benchmarks/baselines/2026-09-11-owned-arrays-plain-final.json).
These files identify the base revision; candidate changes were uncommitted.

All 451 JS tests passed before the final added sealed/proxy test; the 12-test
storage file passed afterward. Six CSES smoke checks at N=200,000 passed:
restaurant 2369.5 ms, rooms 1835.8, playlist 456.7, books 182.2, bounded-sum
798.2, sum 165.4. The immediately preceding main run was respectively 2362.6,
1851.9, 456.0, 183.8, 793.2 and 161.7 ms. These are single cold samples, not
speedup claims. The full worktree demo run passed 164 files with zero failures.

Next experiments: compact private real/boolean buffers, avoiding coordinate
generators in measured row/column copies, and prepared private readers that
retain named lazy caches. Test each independently; do not combine their gains
with this checkpoint until repeated comparisons cover the resulting code.

## 5. Compact real/boolean buffers: rejected and rolled back

Baseline: private-storage checkpoint `03fd034`. The prototype copied homogeneous
numeric inputs of at least 256 cells into `Float64Array`, or booleans into
`Uint8Array`. Small and mixed arrays, and all BigInts, kept generic storage.
Public exposure converted the buffer back to an ordinary mutable array and
released the typed buffer. No change to integer precision was attempted.

The new `node --expose-gc benchmarks/storage.mjs` checks construction and first
exposure separately, at 100 and one million cells for real, boolean, integer
and mixed values. It measures retained memory after GC, before validation.
Pass `--module=/path/to/packages/interpreter/out/index.js` to select a runtime.
The original host source is allocated before timing and remains live in both
versions. This is a boundary-cost benchmark, not a Rank compute benchmark.

At one million cells, private real storage retained about 8 MB in both versions:
the old JS backing array already stored these numbers compactly. The prototype
moved those bytes from the JS heap to an ArrayBuffer. Boolean storage fell from
8 MB to 1 MB, excluding small object metadata. Neither type gained faster
construction. Real creation rose from 4.1 to 7.9 ms; boolean creation from
4.3 to 8.8 ms after improving conversion.

The first prototype used `Uint8Array.from` with a callback and `Array.from` on
exposure. Boolean creation took 35.6 ms and creation plus exposure 48.3 ms.
Preallocated conversion loops reduced these to 8.8 and 10.5 ms. Real creation
plus exposure fell from 18.2 to 10.1 ms, still above the baseline's 4.1 ms.
Integer and mixed creation/exposure remained around 4.4–4.6 ms. Small cases
were around hundredths of a millisecond and do not justify a speed claim.

Unchanged numerical demos, snapshot inputs, five samples per size:

| Largest case | Baseline warm, ms | Compact warm, ms |
| --- | ---: | ---: |
| DeepML 001 matvec, first pair | 16.3 | 17.0 |
| DeepML 001 matvec, reversed order | 16.5 | 17.1 |
| DeepML 004 row mean | 14.3 | 16.5 |
| DeepML 004 column mean | 14.2 | 17.2 |

At 512 square, matvec's second peak RSS rose from 187 to 195 MiB. Row mean
rose from 183 to 255 MiB; column mean from 182 to 256 MiB. The row consumer
exposes each copied temporary, so conversion creates extra buffers rather than
removing work. This is not evidence that typed arrays are always slower; it is
evidence against enabling this representation in the current producer/consumer
paths. The two matvec cold medians in the second pair were 166.5 and 173.1 ms.

Decision: restore production `array-storage.ts` to `03fd034`. Keep the conversion
benchmark, representation-independent round-trip test, [raw results](../../benchmarks/baselines/2026-09-11-compact-storage.json)
and [rejected patch](../../benchmarks/experiments/compact-storage.patch). All 453
JS tests passed on the first prototype and after rollback. The post-rollback
demo run passed 164 files with zero failures; production source matches `03fd034`.
The previous private-storage checkpoint still
has its own unresolved regressions; this rollback does not resolve them.

Revisit buffers only when consumers can read private backing storage without
boxing every temporary row. A long-lived boolean table might justify a measured
memory/speed tradeoff; none of these unchanged demos establishes that case.
For integer storage, any later bounded representation needs tagged promotion:
retain arbitrary BigInts, check each operation before truncating to 64 bits, and
promote the whole mutable buffer when a result or assigned value exceeds its
range. Never use a wrapping typed-array store as the overflow check. Real values
and nested/file values also require promotion to their appropriate generic
representation. This design is deferred until a workload justifies conversion
and promotion costs.
