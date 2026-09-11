# Array performance roadmap

Status: array benchmarks and the first numeric-kernel batch are implemented.
Fusion, packed storage and code generation remain proposed. Runtime behavior
remains the reference for every fast path.

## Goal

Make operations on whole arrays fast enough that interpreter dispatch is a small
part of their cost. Keep Rank syntax unchanged. Scalar algorithms such as DFS and
dynamic programming still need a separate execution-speed track.

J's [performance guide](https://www.jsoftware.com/help/jforc/performance_measurement__tip.htm)
describes packed arrays, integrated rank support and specialized compounds. These
are useful design directions, not evidence of Rank's current speed.

## Current costs

The interpreter already caches expression handlers, uses local slots and direct
call paths, and runs deep recursion on an explicit execution stack. Array work
still has costs that these changes do not remove:

- Array reduction and scan now use indexed loops. `+`, `-` and `*` select a guarded
  numeric callback once per operation; unsupported pairs use `evaluateBinary`.
- Lazy arithmetic avoids some intermediate allocations but retains callback chains
  and scalar dispatch. Laziness is not the same as a fused numeric loop.
- Axis reductions traverse by strides. Builtin `sum` over eager arrays no longer
  copies cells; lazy inputs and other reducers retain cell materialization.
- Ordinary arrays expose `RankValue[]`; byte arrays already have compact storage.

See [execution model](runtime-execution.md) for implemented runtime optimizations.

## Implementation order

1. **Measure array workloads.** Establish baselines for integer and real reduction,
   addition, arithmetic chains, chain plus reduction, prefix scan, sorting and row
   reduction. Include small inputs and a million elements. Keep scalar benchmarks.
2. **Specialize numeric kernels.** Select the operator and numeric path once per
   operation. Use direct loops for arithmetic and reductions, with the existing
   implementation as fallback. Traverse tensor cells by offsets without copying
   each cell. Measure type-detection costs on small and mixed inputs too.
3. **Fuse pure chains.** Represent supported arithmetic as a plan that can execute
   in one loop. Start with arithmetic followed by reduction. Preserve evaluation
   order, error timing and floating-point operation order; do not fuse arbitrary
   effectful callbacks. Check both one-shot and repeatedly consumed lazy results.
4. **Add packed numeric storage.** Start with real and boolean arrays. Design an
   exact integer representation with checked overflow and promotion separately.
   `Float64Array` cannot represent all Rank integers; `BigInt64Array` cannot hold
   arbitrary-size integers. Preserve shape, aliasing and mutation semantics.
5. **Prototype JS code generation for numeric plans.** Let V8 optimize generated
   loops. Compare compilation plus execution on cold runs and cached execution on
   warm runs. Cache by a guarded plan/type signature; retain a general fallback.
   Only expand to user functions if measurements justify the complexity.
6. **Analyze array mutation and aliases.** Add a conservative analysis after
   parsing, initially within one function. Distinguish single-use temporary
   results from arrays proven unchanged over the region being optimized. The
   absence of assignments through one name is insufficient: track aliases such
   as `B = A`, writes through other references, and escapes through containers,
   returns or closure captures. Treat unknown calls and host-provided values as
   potentially mutable unless a checked contract proves otherwise. When proof is
   incomplete, retain ordinary execution. No new keyword is planned.
   Use these proofs to explore fusion across named intermediates and removal of
   redundant reads or checks; buffer reuse additionally requires proof that no
   live alias can observe the old value. Preserve lazy read timing, errors and
   resource lifetimes. Add alias-mutation and escape tests, then benchmark
   one-shot and reused arrays, small inputs and analysis overhead before enabling
   each optimization. This step is proposed, not implemented.

Generating recursive JS calls directly would reintroduce the host stack limit.
Any function compiler must retain deep recursion, tail calls, closures, resource
cleanup and Rank source diagnostics. WASM/SIMD kernels are a later experiment once
packed storage exists and profiles identify a suitable workload.

## Stability during one operation

Rank execution is sequential. A synchronous, read-only numeric operation can
assume its inputs stay unchanged for that call if it invokes no user code,
effectful lazy readers or host hooks and uses no externally shared mutable
storage. This is a local guarantee, not a promise that the arrays are immutable
for their entire lifetime. An alias such as `B = A` does not by itself invalidate
the guarantee: something must execute a write through that alias.

Use this narrower proof before implementing the whole-function analysis in step 6:

- **Fusion (step 3):** compute `(A * 2 + B) + reduce` in one traversal without
  storing every intermediate element. Preserve arithmetic and reduction order.
  The source arrays may be mutable before and after the call.
- **Numeric kernels and packed storage (steps 2 and 4):** retain proven shape,
  storage and element-type facts for the duration of a kernel, and move redundant
  checks outside its loop. Stability alone does not prove that elements are
  numeric or homogeneous; establish those facts separately without changing read
  effects or error timing. Measure any validation pass, especially on small arrays.
- **Generated loops (step 5):** validate a plan's assumptions at entry and use them
  throughout that invocation. Revalidate on the next call; a cached plan does not
  make mutable input data permanent.

Aliases still matter when reusing an input buffer for output, moving work across
expressions, or caching results between calls. Those transformations need the
stronger mutation and escape analysis in step 6. Temporary-buffer reuse also
requires proof that no live reference can observe the overwritten contents.

Sequential execution does not make every read pure. Lazy callbacks, JS getters
and proxies can execute writes during access. Unknown inputs retain ordinary
execution unless their access contract proves the required properties. Tests
must cover these cases and mutations between successive calls.

Internal parallelism is a possible implementation detail, not a new source-level
execution model. Any future parallel kernel must prevent concurrent input writes
and preserve observable sequential behavior, including error handling and
floating-point reduction order. No parallel implementation or speedup is claimed
here.

## Benchmark commands

From a built checkout:

```sh
npm run build
node --expose-gc benchmarks/arrays.mjs --quick
node --expose-gc benchmarks/arrays.mjs
node --expose-gc benchmarks/arrays.mjs --json
node benchmarks/runtime.mjs
node benchmarks/memo.mjs
```

`--quick` checks all workloads with integer, real and mixed inputs at 100 elements with two
samples. The full run uses 100, 10,000 and 1,000,000 elements, two warmups per case
and five samples (63 cases). `--json` emits metadata and every sample for future comparisons.
Use the same harness against another built checkout:

```sh
node --expose-gc benchmarks/arrays.mjs --module=/path/to/checkout/packages/interpreter/out/index.js --json
```

Build that checkout first: the recorded Git revision does not prove compiled
output is current. Run comparisons on the same machine and Node version, without
other CPU-heavy work. Repeat runs before drawing conclusions.

## What the measurements mean

Inputs and independent JS expected results are built outside the timer. Parsing
and correctness assertions are excluded. Each timed call gets the same eager
input arrays and produces a fresh result; every result array is fully materialized
inside the timer. Assertions compare all output elements and shape after every
warmup and sample. Real inputs use exact quarter fractions to permit exact checks.
Mixed inputs alternate integers and reals, including an integer-to-real transition
inside reduction and scan. The initial baseline below predates these mixed cases.

The timer includes function dispatch, computation and output materialization.
These are warm-operation benchmarks, not parser, startup or input-generation tests.
Sorting uses deterministic repeated keys rather than presorted input. The row
case uses ten columns. Broader sort distributions and axis layouts are future cases.

Memory samples report changes in `heapUsed`, `arrayBuffers` and RSS immediately
around each timed call, with the result still live and validation not yet started.
With `--expose-gc`, GC runs before each sample, outside the timer. These deltas are
**not peak memory or total allocated bytes**; GC can run during a call and deltas
can be negative. RSS includes allocator reuse. Inputs and expected outputs remain
live throughout each case. Do not add array-buffer bytes to RSS.

## Initial local baseline

Measured on 2026-09-11, Apple M5, macOS arm64, Node 24.15.0 / V8
13.6.233.17-node.48, with `--expose-gc`. Runtime source revision:
`f7e10034ea147224e0faa001590835f017f69a7c`. The harness was still uncommitted
at measurement time; its recorded Git revision is the base checkout revision.
The harness and raw results are saved together in this change.

Median milliseconds for 1,000,000 elements (five samples after two warmups):

| Operation | Integer | Real |
| --- | ---: | ---: |
| Sum | 29.6 | 29.9 |
| Array addition | 189.2 | 168.8 |
| Multiply then add | 240.6 | 230.5 |
| Multiply, add, reduce | 243.7 | 250.5 |
| Prefix scan | 65.6 | 61.8 |
| Sort | 197.3 | 185.1 |
| Row sum (10 columns) | 80.7 | 75.0 |

[Raw results, all sizes and memory samples](../../benchmarks/baselines/2026-09-11-arrays.json)
are the baseline for later comparisons. The run started after unit tests finished;
other machine activity was not controlled. These are local observations, not
performance guarantees or speedup measurements. In this workload, the arithmetic
chain plus reduction costs much more than a plain sum; profiling is still needed
to separate dispatch, allocation and traversal costs.

## First numeric-kernel batch

Runtime commits: `07a2b71` and `f5ca982`. This batch covers `+`, `-` and `*` in array arithmetic,
reduction and scan. Scalar expression dispatch is unchanged. Array reductions use
indexed loops, including trailing rank-selected cells. Equal-shaped array pairs
skip broadcast-coordinate conversion but retain the existing per-index cache.
Other operators and nonnumeric values use the general implementation.
Kernel selection lives in the collection helper so the scalar binary dispatcher
retains its previous body.

The numeric callbacks guard each consumed pair. There is no whole-array type
prepass or cached type assumption: inputs can mix types, lazy readers can have
effects, and backing arrays can change. Integer arithmetic remains arbitrary-size
BigInt; mixed pairs convert to real at the same point as scalar evaluation.
Reduction starts with the first item, while builtin `sum` keeps its integer-zero
seed. Floating-point operations are not reassociated.

Axis traversal uses strides without allocating coordinate arrays per item.
Builtin `sum` reads eager cells directly, with an identity check to preserve
shadowed functions. Lazy cells still materialize before numeric validation, so a
later read error is not replaced by an earlier type error. Other axis reducers
keep their existing cell inputs. Packed storage and fused loops are not included.

The added JS tests compare collection results against scalar execution, including
large integers, mixed types, NaN, infinities and signed zero. They also cover
empty cells, rank-selected cells, broadcasting, shadowed `sum`, lazy read order,
partial consumption, cache behavior after mutation, fallback and Rank positions.

### Array measurements

Compared baseline `5bdacc2` with `f5ca982` on the same Apple M5 / Node 24.15.0
machine. Both checkouts were built first. Two sequential baseline/candidate pairs
ran after unit tests, with no assistant-launched tests or other benchmarks running
alongside them. Unrelated machine activity was not controlled. Each process used
the same 63-case harness, two warmups and five samples per case, with `--expose-gc`.

First pair, median milliseconds at 1,000,000 elements (before → after):

| Operation | Integer | Real |
| --- | ---: | ---: |
| Sum reduction | 25.9 → 7.9 | 25.3 → 8.0 |
| Array addition | 127.0 → 94.0 | 104.5 → 93.3 |
| Multiply then add | 173.3 → 125.5 | 153.7 → 106.8 |
| Multiply, add, reduce | 175.9 → 96.0 | 180.9 → 88.1 |
| Prefix scan | 53.2 → 25.4 | 55.3 → 20.5 |
| Sort | 158.9 → 168.2 | 157.0 → 159.0 |
| Row sum (10 columns) | 68.7 → 19.9 | 64.2 → 18.4 |

Both pairs showed faster million-element arithmetic and reductions. Sum reduction
was 3.1–3.9× faster for homogeneous numeric inputs; row sums were 3.3–3.5× faster.
Mixed-input reduction was 2.4–2.6× faster, scan 2.7–2.9× and row sums 3.4–3.5×.
This is not a claim that every array operation or size improved:

- Sort was about 1–6% slower across the million-element comparisons. Its algorithm
  was not changed; these runs do not establish the cause of the difference.
- At 100 elements, mixed sum reduction rose from 27/33 microseconds to 33/41
  microseconds (about 22–24% slower). This short-call cost remains unresolved.
- At 10,000 elements, real addition was 4% faster in one pair and 12% slower in
  the other. The per-sample spread is too wide to claim a gain there.

Heap deltas also moved in both directions. For example, integer sum reduction
fell from 57.6 to 37.7 MiB, but integer row sum rose from 19.5 to about 50 MiB;
real scan rose from 41.6 to about 80 MiB. These are retained heap changes around
the call, not allocation totals or peaks. A loop allocating less can trigger fewer
collections and leave a larger end-of-call delta. No blanket memory improvement
is claimed. The report retains RSS and array-buffer deltas as well.

[Raw array and scalar comparisons](../../benchmarks/baselines/2026-09-11-numeric-kernels.json)
contain both pairs, all sizes, per-sample timings and array memory measurements.
All 394 JS tests and the demo tests passed for this batch.

### Scalar checks

The unchanged `runtime.mjs` and `memo.mjs` ran twice against each version, in
separate Node processes, with each baseline followed by the candidate. Counted
summation measured 7.8/7.9 ms before and 7.8/7.7 ms after. Recursive tree calls
measured 37.6/37.9 ms before and 37.9/37.9 ms after. Across the scalar scenarios,
individual paired changes ranged from about 4% faster to 5% slower; this does not
establish a consistent scalar slowdown or guarantee identical speed.

The manual memo-cache workload measured 121.3/118.2 ms before and 123.7/119.5 ms
after (about 1–2% slower). Fresh memo functions stayed around 78 ms. Cached calls
rounded to 0.1 ms in both versions; that resolution is too low for a useful ratio.
These results do not show a scalar speedup, nor is one expected from this batch.

## Acceptance gates

- Compare fast and fallback results, including empty and mixed arrays, big integers,
  overflow boundaries, NaN, infinities, signed zero, broadcasting and axis errors.
- Test effects, lazy consumption, aliases and source positions where applicable.
- Run existing unit tests and demos, plus scalar runtime and memo benchmarks.
- Report measured time and memory changes, including regressions. Do not use noisy
  wall-clock thresholds as correctness tests or promise a fixed speedup.
- Extend benchmarks for packed storage and JIT before claiming those stages done.
