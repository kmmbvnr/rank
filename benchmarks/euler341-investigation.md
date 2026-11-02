# Euler 341: Golomb sequence investigation

## Scope and conclusion

Issue #447 still lists `341_golomb.ra` and its default test as unfinished.
The next task in the ascending unfinished list is 341. The first sections record the research stage. Production implementation and
verification are recorded in the delivery section below.
Experiments use the isolated, built runtime from commit `90cd13c5`, not the
shared working tree, which contains unrelated compiler work. Main advanced
to `179ccf1e` during the investigation; these results retain the pinned runtime.

Both the compiler and the algorithm have substantial headroom. A private
compiler experiment speeds up the unchanged demo by about 22–24 times.
A run-block algorithm with the existing `index` structure is faster still,
uses less memory, needs no guessed capacity, and also helps reference execution.

The full answer is **56098610614277014** in every completed full sample.

## Original implementation

The original program allocates `12 * Count` cells, generates Golomb terms
using `g(i) = 1 + g(i - g(g(i-1)))`, then walks the generated terms again.
For `Count = 1000000`, the buffer has 12,000,000 cells. The weighted-prefix
walk reaches roughly 10.1 million indices. The second pass locates each cube
inside a block of the sequence using the cumulative sums

- `S(k) = sum(i=1..k, g(i))`;
- `P(k) = sum(i=1..k, i*g(i))`;
- `g(x) = S(k-1) + ceil((x-P(k-1))/k)` when `P(k-1) < x <= P(k)`.

Both original loops compile. The expensive path is therefore not simply a
missing compiler for array indexing. Cube values and weighted prefixes exceed
`Number.MAX_SAFE_INTEGER`; a diagnostic full run records three Number
attempts/overflows and falls back to publishing exact loops. The function's
fresh-array prefix has only a Number attempt. The existing mixed-scalar
analysis also forces names used by loop/branch conditions into checked Number
registers, which prevents these large counters from staying exact BigInts in
a private Number-array region.

## General compiler experiment

`experiments/euler341-mixed-prototype.patch` changes **generated output in an
isolated runtime only**. It is an exploratory patch, not a production fix:

1. Keep iteration sources/bounds, cell addresses and stored numeric cells in
   the checked Number dependency set; allow predicate-only integers to be wide.
2. Emit boolean expressions referencing wide registers through exact scalar
   lowering, including loop and branch predicates.
3. After a failed fresh-array function-prefix attempt, try a mixed-register
   plan before returning to ordinary execution.

The unchanged program then completes in one mixed private region. The initial
Number attempt fails at the oversized cube bound before buffer construction;
the mixed attempt uses checked Number indices/cells and BigInt counters. This
retains the speculative replay model rather than rounding large integers.

Four boundary programs compare compiled/reference results for a predicate
crossing 2^53, a wide counter used in a computed array address, a range whose
bounds exceed 2^53, and a wide cell store. These pass in the private experiment.
This is **not** full validation of a production compiler change. A source-level
implementation needs focused tests for cancellation, partial failure state,
repeated calls, aliases, real/boolean expressions, range controls and fallback
ordering before delivery. The original thresholds and copy-cost policy are
unchanged.

The prototype is general: no Euler filename, helper name or Golomb recurrence
is recognized by the compiler.

## Algorithm experiments

| Variant | Change |
| --- | --- |
| original | Two full walks, `12 * Count` preallocated cells |
| stream | Construct each needed term during the query walk; remove the first walk |
| runs | Store the small Golomb prefix needed to describe runs, but advance weighted prefixes one index at a time |
| blocks | Advance weighted prefixes over an entire equal-value run, using a small preallocated prefix |
| blocks-index | Same block arithmetic, using the existing `index` structure instead of a capacity guess |

The `runs` and array `blocks` variants use `Count + 3` as an experimental
capacity, verified on the tested inputs but without a general bound proof.
They should not be copied into production with that unexplained assumption.
`blocks-index` removes this concern and is the preferred algorithm candidate.

Golomb's self-description means value `v` repeats `g(v)` times. If the previous
run ends at `a`, the next run ends at `b = a + g(v)`. Its complete contribution
is `v*(b-a)` to S and `v*(T(b)-T(a))` to P, where `T(k)=k*(k+1)/2`.
We generate only `g(v)` values needed to describe those runs, using the same
recurrence in a small index. The default needs **25,639 stored values**, and
the last complete run ends at index **10,105,600**.

For a cube x within the current run, set

```
z = T(a) + floor((x - previousP - 1)/v)
k = floor((isqrt(8*z + 1) + 1)/2)
```

Then k is the first weighted-prefix index reaching x. The original ceiling
formula gives `g(x)` without visiting all preceding indices. All arithmetic
is integer, including the square root; no floating cube or square-root
approximation is used.

The self-referential prefix and ordered run traversal remain explicit loops.
This is a compact sequential recurrence; replacing it with a materialized
array of all 10 million terms would undo the memory advantage. The experimental
Rank source still needs normal style cleanup before a production change.

The existing exact scalar-function compiler already compiles the complete
`blocks-index` helper, including its locally created index. A captured kernel
contains `newStructure("index")`, exact scalar arithmetic and nested loops.
Consequently the compiler prototype is not required for this algorithm to
be fast. Array-backed variants currently use a different compilation path;
the table does not imply that maps are intrinsically faster than arrays.

## Measurements

Node 24.15.0, Apple M5 arm64 and Intel i7-10750H x86_64. Each main entry is the
median of three alternating serial fresh-process executions per host.
Elapsed time includes parse/compile/execute, excludes imports/process startup.
Memory is whole-process peak RSS, not incremental allocation or retained heap.
Background activity was not controlled; compare the large differences, not
small RSS changes. All full samples assert the answer.

| Variant | Mac seconds | Mac peak MiB | Intel seconds | Intel peak MiB |
| --- | ---: | ---: | ---: | ---: |
| Original, pinned compiler | 11.789 | 223.2 | 29.562 | 212.1 |
| Original, compiler experiment | 0.530 | 221.6 | 1.250 | 209.6 |
| Stream, pinned compiler | 1.670 | 316.9 | — | — |
| Runs, pinned compiler | 0.828 | 194.6 | 1.817 | 183.9 |
| Array blocks, pinned compiler | 0.383 | 192.4 | — | — |
| Index blocks, pinned compiler | **0.222** | **179.1** | **0.578** | **168.0** |

The compiler-only gain is about 22.3x Mac / 23.6x Intel; its normal-run RSS is
roughly unchanged. The preferred algorithm gives about 53.1x / 51.2x, with
44 MiB less peak RSS on both hosts. Simply removing the first walk improves
speed but **increases** measured peak memory, so it is not the preferred fix.

An initial code-capturing diagnostic run reported 477 MiB for the original.
That run retains generated kernels and is not the comparable memory baseline;
use the uninstrumented series above for memory claims.

On Mac, three reference runs of `blocks-index` give **2.501 s / 180.5 MiB**
median for the full default. The original full reference was stopped after
20 seconds; there is no completed full-reference baseline. At Count=10000,
the reference medians are original **0.309 s**, index blocks **0.167 s**.
Those reduced times include fixed parsing overhead and are not a full-size
speedup estimate. Intel full reference for index blocks completes in **6.378 s /
168.2 MiB** (one sample).

The existing default-test assertion `1000000 term = 6137` completes unchanged:
Mac compiled **0.133 s / 164.0 MiB**, reference **1.548 s / 182.2 MiB** (one
sample each). That test is a good candidate to remove from execution exclusions.
On Intel the same assertion takes **0.299 s compiled**, **3.544 s reference**
(one sample each); fixture timeout margins should be checked under normal
worker concurrency. Its direct recurrence helper does not need the cube-sum
algorithm rewrite.

## Verification and reproduction

`euler341-verify.mjs` checks five algorithm variants with compilation both on
and off against a direct, million-cell Golomb recurrence, looking up each cube
for Counts 1..101, plus the existing Count=1000 golden. This gives **1020
assertions per verification run**. Five larger Counts (127, 256, 999, 1001,
10000) also compare the original per-index algorithm with run inversion in
both engines (20 executions), followed by four compiler-boundary programs in
both engines. Verification passed on Mac for both pinned and experimental
runtimes, and on Intel for the pinned runtime. All completed full benchmarks
assert the known complete answer. Zero/negative inputs have not been specified
or claimed equivalent; the original Count=0 path cannot write `G 1` into its
empty buffer.

No full suite, exhaustive audit, production build or production compiler
validation is claimed for this investigation. It changes only research
artifacts. Raw results, checks and runtime hashes are in
`baselines/2026-11-02-euler341-investigation.json`.

```
RANK341_RUNTIME=/path/to/isolated/packages/interpreter/out/index.js \
  node benchmarks/euler341-investigation.mjs original compiled 1000000
RANK341_RUNTIME=/path/to/isolated/packages/interpreter/out/index.js \
  node benchmarks/euler341-investigation.mjs blocks-index compiled 1000000
RANK341_RUNTIME=/path/to/isolated/packages/interpreter/out/index.js \
  node benchmarks/euler341-investigation.mjs blocks-index reference 1000000
RANK341_RUNTIME=/path/to/isolated/packages/interpreter/out/index.js \
  node benchmarks/euler341-investigation.mjs term reference 1000000
RANK341_RUNTIME=/path/to/isolated/packages/interpreter/out/index.js \
  node benchmarks/euler341-verify.mjs
```

## Research recommendation

Implement and validate the general mixed-predicate/function-prefix support,
retain its benefit for other array programs, and independently adopt the
compact index-block demo after style cleanup. Add small boundary cases and a
full compiled golden to ordinary tests; enable the existing millionth-term
fixture. Revisit the full-demo exclusion using both execution modes rather
than equating the compiled result with reference performance. Update #447 after implementation and verification are authorized and completed.
The user subsequently authorized all of these changes; see delivery below.


## Production delivery

Implemented the general compiler support in TypeScript, with no Euler-specific
recognition. The mixed-register fallback now covers fresh-array function
prefixes as well as ordinary compiled loops. Predicate-only counters can be
BigInts; iteration bounds, dimensions, addresses and stored cells retain their
checked Number dependencies. Mixed boolean lowering also keeps audited exact
consumers such as `bit` and `binary` on their existing guarded fast path. Three
existing exact-consumer tests caught an initial lost optimization; it was
corrected before delivery and two combined-predicate cases now cover that seam.

The production demo uses constant-value Golomb runs and a dynamic `index` of
25,639 values, with exact triangular inversion for each cube. The original
`term` helper and CLI interface are retained. Addressing and postfix operations
use Rank's usual precedence: unnecessary outer parentheses are removed, and
the previous run length is named to avoid nested parentheses. Every line of
the production demo and fixtures is at most 40 characters with at most one pair
of parentheses. Remaining sequential loops generate the self-referential
prefix and consume cubes in order. Empty cube sums (Counts 0 and 1) return 0;
the positive-domain term helper retains its existing behavior.

Both `341_golomb.ra` and `341_golomb_default_test.ra` are removed from execution
exclusions. Their eligibility is checked by the exclusions metadata tests.
The full compiled and reference cube sums and the unchanged millionth term
are covered by ordinary tests. No full suite or exhaustive audit was run.

### Final measurements

Three alternating serial fresh-process samples on each host; same timing/RSS
method as above, without diagnostic observers. Final sources were built in a
clean isolation from `179ccf1e` plus only this task's changes. Concurrent ACMP
commits in the shared checkout do not affect the measured compiler sources.
Raw samples and final source/runtime hashes are in
`baselines/2026-11-02-euler341-delivery.json`.

| Full workload | Mac seconds | Mac peak MiB | Intel seconds | Intel peak MiB |
| --- | ---: | ---: | ---: | ---: |
| Original source and compiler | 13.976 | 224.9 | 30.202 | 212.6 |
| Original source, corrected compiler | 0.633 | 221.7 | 1.243 | 210.0 |
| Production demo, corrected compiler | **0.251** | **177.2** | **0.599** | **167.3** |
| Production demo, reference | 2.923 | 182.2 | 6.429 | 167.0 |

The final demo is about **55.7x faster on Mac / 50.4x on Intel**, with peak RSS
lower by **47.7 / 45.3 MiB**. The compiler-only change is about **22.1x / 24.3x**
faster on the unchanged array program, with broadly unchanged peak RSS. Those
are independent gains, not factors to multiply together. The later baseline
Mac time was higher than the earlier research series; the paired delivery
series is used for final comparisons. Background activity remains a limitation.

### Final verification

- Mac: **631 focused tests in 14 files pass**, covering mixed predicates,
  private function prefixes, exact consumers, Number loops/indices/aliases,
  vector bounds, loop control, modular folds and Euler 338/341. After the final
  parenthesis-only demo cleanup, the five Euler 341 tests pass again.
- Intel: **68 focused tests in four files pass**, including full compiled and
  reference answers, the original array recurrence with the new mixed compiler,
  exact consumers and the shared semantic boundary cases.
- New semantic coverage includes scalar overflow after private cell stores,
  signed counters crossing 2^53, loop/branch predicates, short-circuiting,
  real/boolean operands, exact native predicates, numeric range/address/store
  fallback, exact failure locations, COW snapshots, repeated safe/wide/empty
  calls, changing captures, unused deferred failures, cancellation and finally.
- The production helper passes **204 small-input assertions** per host against
  the direct sequence/fixture golden in both modes, plus larger-input comparisons against the old weighted
  walk (20 executions) and four mixed boundary programs in both modes.
- The main unit oracle also checks Count=0 and the millionth Golomb term in
  both modes. Full benchmarks assert **56098610614277014** in all 24 samples.
- Langium generation and TypeScript project build pass. The three CLI test
  cases contain nine successful assertions; all three exclusion metadata tests
  pass. Intel also runs the new full-answer tests with explicit timeout margins
  for diagnostic/reference overhead.

Reproduce the final program with the benchmark worker's `production` variant,
and its independent checks with `node benchmarks/euler341-verify.mjs production`.
The generated-JavaScript prototype patch is retained as historical research;
the production TypeScript implementation includes the exact-consumer repair
and regression tests and is the authoritative implementation.
