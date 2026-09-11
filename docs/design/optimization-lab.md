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

## 6. Tensor row/column copies: repeated benefit

The mean profile pointed to `coordinates` inside `tensorEntries`. Every copied
cell allocated a coordinate array and advanced a generator before reading its
value. The new inner loop computes coordinates directly into the row's existing
coordinate buffer. Frame iteration is unchanged. Unusual host mutations that
change cell rank use the old coordinate mapping. Foreign `.items` getters still
run before the `.shape` read used for offsets; storage is checked between rows.

This review found a correctness error in checkpoint `03fd034`: its owned-array
constructor copied the cell shape and broke the alias between yielded rows and
their iterator. A host function changing the first row's dimension produced
lengths `[3, 3]`, while pre-storage runtime `d03c2bd` produced `[3, 1]`. The new
test failed before the repair. The internal constructor now retains that
runtime-owned shape, while storing separate dimension values for validation.
If a callback installs shape getters, metadata construction uses descriptors
and falls back without reading them. A second live comparison and permanent
test confirm the same four getter reads as `d03c2bd`. JS snapshot construction
still copies the caller's shape before passing it to the internal constructor.

Five-sample comparisons against `d03c2bd`, unchanged demos and ordinary host
inputs, all at square 512:

| Demo | First pair, baseline → candidate | Repeat, baseline → candidate |
| --- | ---: | ---: |
| DeepML 004 row mean | 12.2 → 4.1 ms | 12.3 → 4.2 ms |
| DeepML 004 column mean | 12.6 → 4.2 ms | 12.8 → 4.2 ms |

The row and column standalone runs used opposite runtime orders. The row
comparison repeated with reversed order in the full suite. Their cold process
medians improved by only about 5–6%, because startup and setup still dominate.
At square 128 the full suite's warm row/column times fell from 1.3/1.4 to
0.8/0.9 ms. Small square-8 results remain around 0.1 ms.

Ordinary-input matvec at 512 fell from 26.4 to 19.1 ms in the full suite, without
requiring a host snapshot. With copied snapshot inputs, the cumulative storage
plus copy changes were 26.3 to 9.7 ms; cold medians 175.6 to 160.9 ms and peak
RSS 273 to 190 MiB. These snapshot results include the earlier sum fusion and
must not be presented as the isolated coordinate-loop gain.

The remaining large ordinary-input controls were Euler 10.8 to 11.5 ms,
k-means 41.0 to 42.4 ms, matrix multiplication 321.6 to 315.6 ms and gradient
descent 75.4 to 78.4 ms. No speedup is claimed for these controls. A short
two-file test run overlapped part of the full comparison; standalone row/column
and snapshot comparisons had no concurrent test workload. The k-means fallback
and named-snapshot costs from section 4 remain unresolved. Coordinate copying
repairs the earlier mean regression but does not settle those other costs.

The independent tensor-copy test covers 78 combinations of three shapes
(including empty dimensions), reordered frame axes, all cell ranks and both
ordinary/private inputs. It groups elements using nested JS coordinate loops
rather than the interpreter's linear decoder. Additional tests cover shared
shape mutation, accessor read counts and changed cell rank. All 457 JS tests
passed. All 164 demo files passed with zero failures.
The six N=200,000 judge smoke checks passed: restaurant 2350.2 ms, rooms
1855.1, playlist 460.8, books 184.1, bounded-sum 792.9 and sum 162.6.
These single cold samples are regression smoke checks, not speedup claims.
[Raw comparisons](../../benchmarks/baselines/2026-09-11-tensor-coordinate-copy.json).

Decision: keep the coordinate-copy change and shape-alias repair. Continue with
the lazy fallback cost, private readers that preserve named caches, and the
remaining measured scalar/indexing and transpose paths before generated loops.

## 7. Matrix transpose coordinates: kept

A fresh `dffc395` CPU profile of DeepML 015 at 2,048 rows put 22.1% of samples
in the transpose reader and 17.9% in its coordinate decoder. Transpose
materialization also appeared separately. The k-means profile instead showed
17.2% GC, 6.5% broadcast-array construction and 1.4% stride construction, with
execution-task handling spread across several functions. These are sampled
profiles including startup, not precise cost partitions or speedup predictions.
Reproduce with `node --cpu-prof benchmarks/numerical-demos.mjs --worker=gradient
--scale=2 --samples=30` or the k-means worker with 40 samples.

The transpose reader previously allocated output coordinates and then a second
source-coordinate array on every read. For a matrix it now retains the two
coordinate numbers, clears and reuses the first local array, and writes them in
permutation order. Other ranks keep their original path. No scratch array is
shared between calls, so a host getter can reenter the reader safely. Source
shape reads, permutation reads and lazy cell access keep their order. `itemAt`
remains live after `.items` has separately cached a materialization.

Five-sample results on unchanged DeepML 015, ordinary host inputs:

| Rows / features / steps | Baseline warm | Candidate warm |
| --- | ---: | ---: |
| 2,048 / 8 / 20, first comparison to d03c2bd | 75.3 ms | 59.4 ms |
| 2,048 / 8 / 20, isolated comparison to dffc395 | 83.1 ms | 66.4 ms |
| 2,048 / 32 / 1, dffc395 | 15.6 ms | 11.6 ms |
| 2,048 / 2 / 80, dffc395 | 96.0 ms | 77.3 ms |

The default isolated run had cold-process scheduling outliers up to 643 ms;
do not infer a cold speedup from that run. With two features and 80 steps, cold
medians were 244.6 to 229.9 ms and peak RSS 378 to 358 MiB. Memory did not
improve uniformly: the first default pair's peaks were 207 to 212 MiB.
The narrow/long case also improved in an earlier opposite-order run
(98.3 to 79.5 ms); the saved full report is the repeat above.

The harness now accepts `--features` and `--steps`; defaults remain 8 and 20.
Each pair still varies rows through 16/256/2,048. The independent one-hot
reference accounts for uneven or empty feature groups. At 32 features and one
step, it exposed an oracle bug: `Math.round` rounded 0.03125 to 0.0313, whereas
both Rank versions correctly returned tie-to-even 0.0312. The oracle now handles
ties explicitly, and failures print actual and expected values. A zero-step,
32-feature worker also passed. This was a benchmark correction, not a Rank bug.

Four new tests cover rectangular and empty matrices, explicit permutations,
exact host getter order, reentrant reads, and live versus materialized values.
All 461 JS tests and all 164 demo files passed.
[Raw comparisons and profile summaries](../../benchmarks/baselines/2026-09-11-transpose-copy.json).

Decision: keep the local coordinate reuse. For k-means, investigate small lazy
array construction/cache allocations rather than assuming the private-storage
lookup explains the whole regression. Keep named-cache semantics as a gate.

## 8. Short-vector result caches: rejected for added complexity

Broadcast arithmetic allocated a Map even for two-element vectors. The first
prototype stored indices 0 and 1 in local slots for every array. K-means improved,
but the extra per-element branches hurt million-element integer reductions:
chain 94.45 to 113.61 ms, named 94.94 to 112.69 ms, and reused 136.05 to
155.55 ms. That general version was rejected; its patch is retained in
`benchmarks/experiments/general-two-slot-cache.patch`.

The second prototype selects the slot reader only for rank-one shapes of at
most two cells. Larger arrays retain their Map reader without slot branches.
Unusual indices on a short vector allocate a Map on demand. Both paths preserve
cached zero/false values, failed-read retries, NaN keys, and the separate
materialized-items cache. Four new tests cover these behaviors.

Five-sample k-means comparisons at 2,048 points were 43.00 to 40.67 ms against
the before-cache runtime, and 42.00 to 40.93 ms against the pre-storage runtime.
The corresponding large integer controls for the limited version were 90.05,
91.27 and 130.41 ms; real chain reduction was 82.01 to 84.78 ms. These controls
reject the general version's large regression, not establish a universal gain.
[Raw isolated runs](../../benchmarks/baselines/2026-09-11-small-vector-cache.json).

A completed full ordinary-input comparison against d03c2bd also passed all
numerical oracles: largest-size warm medians were Euler 10.9 to 11.0 ms,
matvec 26.5 to 19.6, k-means 42.5 to 40.8, row mean 12.6 to 4.1,
column mean 13.6 to 4.3, matmul 330.7 to 329.2 and gradient 80.2 to 64.0.
These are cumulative changes, not cache-only gains. Its full JSON output was
truncated during collection; these figures are from the surviving summary.
K-means peak RSS increased from 368.8 to 405.6 MiB in that run, so the earlier
isolated RSS decreases do not establish a memory improvement.

Decision: reject both versions. The user clarified the acceptance rule: a small
speedup is insufficient when it adds complexity; small gains are acceptable
when the code also becomes simpler. About 5% in one workload does not justify
two reader paths, extra cache state and a special fallback for unusual indices.
Production code was restored to the original Map implementation. Keep the four
behavior tests and measured results. Named snapshot reduction overhead and the
earlier k-means slowdown remain open.

After rollback, all 465 JS tests passed, including the four new cache tests.
The 164-file demo run passed before rollback; it is not a post-rollback result.

## 9. Scalar matrix multiplication profile

After the cache rollback, a 12-sample DeepML 009 worker at 64 square took
316.7–324.2 ms warm. The CPU profile attributed 16.5% of self samples to
execution-stack advancement, 13.2% to the suspended `mapResult` continuation,
12.1% to GC, 5.5% to selector dispatch and 2.8% to `atArray`.
[Profile summary and reproduction command](../../benchmarks/baselines/2026-09-11-matmul-profile.json).
Startup is included; these percentages do not predict an optimization's gain.

This changes the next experiment: inspect shared expression-result composition
before adding specialized multidimensional selectors. The arithmetic operands
`A i k` and `B k j` already have synchronous application evaluators, but the
enclosing arithmetic still uses the general task path. A common composition
mechanism may avoid suspension for completed operands while retaining the
existing execution stack for actual Rank calls. Test evaluation order, errors,
deep recursion and cancellation before measuring it. Do not assume an indexing
expression cannot contain a function merely because its names look like indices.

## 10. Completed arithmetic composition: promising, not accepted yet

The general binary-expression evaluator now composes `Evaluation` results with
`flatMapResult`. This seven-line helper invokes the continuation immediately for
a completed operand and uses the existing execution stack for a suspended one.
The right operand is still evaluated after the left, and an optional step after
both. Special syntax, including `pad`, keeps its existing evaluator. No numeric
types, selector kinds or matrix sizes are guessed. The direct-expression path
for ordinary scalar arithmetic remains unchanged.

Five-sample comparisons against dffc395, using unchanged demo sources:

| Workload | Before warm | After warm | Repeat before | Repeat after |
| --- | ---: | ---: | ---: | ---: |
| DeepML 009, 64-square matmul | 315.4 ms | 133.8 ms | 340.3 ms | 143.1 ms |
| DeepML 009, 24-square matmul | 18.4 ms | 8.9 ms | 20.1 ms | 8.7 ms |

The second run reversed the initial version order. At 64 square, its cold
medians were 499.7 to 296.3 ms and peak RSS 380.0 to 179.0 MiB. K-means at
2,048 points improved from 43.8 to 31.8 ms warm and 220.5 to 202.5 ms cold.
These workloads do not use transpose, so dffc395 is the before-composition
runtime for these comparisons. The full suite also includes the earlier matrix
transpose change: gradient 82.2 to 64.6 ms is therefore a cumulative result.

Other largest-size warm controls were Euler 11.2 to 11.1 ms, matvec 19.9 to
19.1, row mean 4.3 to 4.1 and column mean 4.4 to 4.1. Do not infer small gains
from these controls. Cold matvec increased 167.5 to 171.7 ms; not every cold
or memory measurement improved.
[First matmul comparison](../../benchmarks/baselines/2026-09-11-expression-composition-matmul.json)
and [full repeat](../../benchmarks/baselines/2026-09-11-expression-composition-full.json).

All 470 JS tests passed. New tests assert that selector arithmetic returns a
completed result, that continuations run once in order, and that operand failure
or cancellation prevents the continuation and closes the suspended operand.
Rank-level side effects and first-error behavior are checked too. The full
suite includes 100,000-frame recursion, million-call tail recursion, memoization,
resource cleanup and error-location tests.

All 164 demo files and the six judge-scale correctness/timeout checks passed.
However, bounded-sum took 928.3 ms. An immediate paired check was 815.3 ms
before versus 925.4 ms after: a roughly 13% regression, despite passing the
timeout. A variant using `mapResult` for the final operand took 913.9 ms;
a larger `mapPair` helper with reused right/operation closures took 919.1 ms.
Neither revision removed this cost, so those revisions were dropped.
[Judge smoke results](../../benchmarks/baselines/2026-09-11-expression-composition-judge.json).

Decision: retain the first, smallest prototype only as a worktree experiment.
It is not ready for acceptance or main. Investigate the suspended-operand path
and repeat the bounded-sum comparison before accepting the numerical gains.
No short-vector cache specialization was restored.

## 11. Operand collection and unary extrema: bounded-sum recovery

The mixed expression `Prefix r - Starts min` exposed another unconditional
task boundary. Unary extrema collected their source operands through a generator
and then suspended around ordinary synchronous reads and native calls.

`mapExecution` now collects completed operands directly. At the first suspended
operand it returns a continuation carrying the already collected prefix; later
operands are evaluated in order without replay. Unary extrema compose collection,
source application and invocation using the same `flatMapResult` helper as
arithmetic. They still resolve `min`/`max` after the source, check the function,
and suspend for Rank-defined replacements. There is no multiset-specific path.

Changing operand collection alone gave 902.5 ms for bounded-sum and did not fix
the earlier 815 to 925 ms regression. With unary extrema composed too, a cold
ABBA comparison at N=200,000 was 865.8 ms before, 631.8 and 636.3 after, and
821.3 before. A subsequent six-task run gave 632.9 ms. This removes the measured
regression and improves on the pre-composition runtime by about 23–27% in these
pairs. [Bounded-sum comparisons](../../benchmarks/baselines/2026-09-11-composed-extrema-bounded.json).

The full numerical repeat preserved the larger gains: matmul at 64 square
329.7 to 145.2 ms warm, k-means at 2,048 points 42.1 to 33.4. Controls were
Euler 11.2 to 11.0 ms, matvec 18.6 to 19.2, row mean 4.2 to 4.2 and column
mean 4.1 to 4.3. Gradient 81.0 to 63.9 includes the earlier transpose change.
Matmul peak RSS was 369.6 to 271.0 MiB, a smaller decrease than the prior run;
do not promise a fixed memory reduction.
[Full numerical report](../../benchmarks/baselines/2026-09-11-composed-extrema-full.json).

All 473 JS tests passed. Added tests cover synchronous and empty collection,
the first suspension with no replay, cancellation before later operands, and
re-resolving a shadowed extremum on the same prepared expression. Existing
recursion, resource and diagnostic tests also passed. All six N=200,000 judge
checks passed; their single cold times are smoke checks, not speedup estimates
for every CSES task.
[Judge report](../../benchmarks/baselines/2026-09-11-composed-extrema-judge.json).

All 164 demo files passed after the final change. Decision: keep the combined
composition change. It retains the large numerical gain and removes the
bounded-sum regression through shared evaluation machinery. This completes the
acceptance check left open in section 10; named snapshot costs remain separate.

## 12. Named snapshot controls after execution changes

Repeated the 81-case array suite against d03c2bd after the composition changes.
At one million real elements, named reduction was 96.9 to 106.6 ms and reused
reduction 124.5 to 142.8 ms. Integer cases improved instead. These aggregate
runs include different warmed code and heap histories, so they do not isolate
the cost of private storage.
[Full refresh](../../benchmarks/baselines/2026-09-11-named-snapshot-refresh.json).

The harness now accepts `--only`, `--kind` and `--size` filters. Defaults are
unchanged, and unknown cases/types/sizes are rejected. A focused real-only
candidate-first repeat gave 97.3 to 102.2 ms for named reduction and 127.7 to
127.1 for reused reduction. A short harness validation overlapped that baseline
process, so treat it as diagnostic rather than clean acceptance evidence.
[Focused diagnostic](../../benchmarks/baselines/2026-09-11-named-snapshot-focused.json).

A separate, uncontended before-first pair with explicit GC outside each measured
operation gave 82.2 to 85.7 ms and 111.4 to 114.9 ms respectively. Both used
five samples, the same inputs, and exact result checks. This supports a remaining
roughly 3–4% cost under those conditions, not a universal 15% regression.
[GC-controlled pair](../../benchmarks/baselines/2026-09-11-named-snapshot-gc.json).

Reproduce the focused candidate with `node --expose-gc benchmarks/arrays.mjs
--fusion --storage=snapshot --json --kind=real --size=1000000
--only=namedreduce,reusedreduce`; add `--module=/path/to/interpreter/out/index.js`
for the baseline. The older runtime lacks the snapshot constructor, so its
input is a copied ordinary array. This compares the supported input paths,
not two implementations of the same private-storage contract.

No production code changed in this step. Do not add a second lazy-producer
registry merely to chase this small residual cost: it would need recursive
validation and exact preservation of named caches. Keep these controls for
future fusion or alias-analysis experiments. The remaining cost is recorded;
it has not been eliminated.

## 13. Generated binary-sum loop: rejected for limited benefit

Built a generated JS loop for the existing private, single-binary `sum` plan.
It handled `+`, `-` and `*`, inlined primitive mixed/BigInt arithmetic, retained
the zero seed and left-fold order, and deferred invalid-summand errors until
arithmetic reads completed. Eligibility and same-shape checks remained in the
ordinary planner. Only whitelisted operator tokens entered generated source;
Rank names and input text did not. Each prepared expression cached compilation,
with fallback if the host prohibited `Function` construction.

Compared against a clean build of 972651f, five samples, unchanged DeepML 001
with snapshot input, opposite initial version orders:

| Matrix | Before warm | Generated warm | Repeat before | Repeat generated |
| --- | ---: | ---: | ---: | ---: |
| 128 square | 1.2 ms | 1.2 ms | 1.2 ms | 1.2 ms |
| 512 square | 9.89 ms | 9.00 ms | 9.80 ms | 8.35 ms |

At 512 square, cold medians including compilation were 164.1 to 159.9 ms,
then 164.6 to 157.5 ms. Peak RSS was unchanged in the first pair and slightly
higher in the second. The prototype only activates for private inputs; it does
not provide a generated path for arbitrary host arrays or user-function loops.
[Raw comparisons](../../benchmarks/baselines/2026-09-11-generated-binary-sum.json).

All 476 JS tests passed with the prototype. Three extra tests covered large
BigInts, mixed types, rounding order, empty sums, NaN, arithmetic-error precedence,
operator rejection and disabled dynamic code. They are retained with the
[rejected patch](../../benchmarks/experiments/generated-binary-sum.patch).

Decision: roll back the generator and its integration. A 9–15% warm improvement
in this eligible case, and about 3–4% cold improvement, do not justify a second
arithmetic implementation and dynamic-compilation fallback. The simpler common
execution changes delivered broader and larger gains. Revisit code generation
only if a larger measured loop can amortize this complexity; this experiment
does not establish that general JIT compilation is ineffective.

After rollback all 473 JS tests passed, and the interpreter source diff against
972651f was empty. No generated-code path remains in the runtime.
