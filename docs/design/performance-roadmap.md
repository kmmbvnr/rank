# Array performance roadmap

Status: proposed optimizations; benchmark harness implemented. No speedup targets
have been measured yet. Runtime behavior remains the reference for every fast path.

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

- `reduceCell` and `evaluateScan` dispatch through `evaluateBinary` per element.
- Lazy arithmetic avoids some intermediate allocations but retains callback chains
  and scalar dispatch. Laziness is not the same as a fused numeric loop.
- Axis reductions build temporary cell arrays and coordinate arrays.
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

Generating recursive JS calls directly would reintroduce the host stack limit.
Any function compiler must retain deep recursion, tail calls, closures, resource
cleanup and Rank source diagnostics. WASM/SIMD kernels are a later experiment once
packed storage exists and profiles identify a suitable workload.

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

`--quick` checks all workloads and both numeric types at 100 elements with two
samples. The full run uses 100, 10,000 and 1,000,000 elements, two warmups per case
and five samples. `--json` emits metadata and every sample for future comparisons.
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

## Acceptance gates

- Compare fast and fallback results, including empty and mixed arrays, big integers,
  overflow boundaries, NaN, infinities, signed zero, broadcasting and axis errors.
- Test effects, lazy consumption, aliases and source positions where applicable.
- Run existing unit tests and demos, plus scalar runtime and memo benchmarks.
- Report measured time and memory changes, including regressions. Do not use noisy
  wall-clock thresholds as correctness tests or promise a fixed speedup.
- Extend benchmarks for packed storage and JIT before claiming those stages done.
