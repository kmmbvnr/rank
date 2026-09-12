# Flat segment trees: scalar combine specialization

The current flat tree specializes a narrow class of pure Rank functions.
On the four-integer max-subarray workload, it now builds and executes queries
and updates faster than the ordinary record tree, while retaining compact
storage. The [initial baseline](flat-segment-results.md) records the previous
implementation and its construction overhead.

## Changes

- Repeated initialization encodes one record and doubles its bytes across the buffer.
- Tree allocation skips record initialization and copies the leaf buffer directly.
- A single `return record` with integer field reads, integer literals, unary signs,
  `+`, `-`, `*`, and standard binary `min`/`max` can compile to a JavaScript scalar kernel.
- Build and traversal use scalar scratch arrays instead of records and maps at each merge.
- Updates stage packed ancestors and commit only after all storage bounds checks pass.

The compiler proves an integer-only schema and exact output fields. It rejects
memoization, arbitrary calls, captures, mutation, mixed fields, and unsupported
expressions. Builtin bindings and the interpreter call-depth budget are checked
before entering a compiled traversal. Shadowed builtins and CSP restrictions
retain ordinary Rank execution. Function instances keep separate closure guards.

Query accumulators remain arbitrary-precision integers, including results that
exceed int64. Only stored nodes narrow to int64. Returned records preserve field
order, and reads still have copy semantics. BigInt arithmetic, query scratch
arrays, and public result records still allocate; this is not zero-allocation
execution or an LLVM backend.

## Measurements

Apple M5, Node v24.15.0, macOS arm64; five fresh-process samples per row.
Tables show medians after warmup. Each size uses 10,000 inclusive range queries
and 5,000 point updates with the same four-field max-subarray combine as the
initial baseline. Each sample checks linear oracles and checksums. Explicit GC
runs outside the timed sections; automatic GC is included.

Rank rows use an actual Rank function, with specialization enabled for flat
storage. The harness calls the same host tree API in every variant. Parsing
and outer Rank loop/selector overhead are excluded. Memory is post-GC
heapUsed + arrayBuffers relative to the warmed runtime, after releasing input.
It is a retained-memory delta, not peak memory; small baseline GC differences
can put it slightly below the exact buffer payload.

### 65,536 elements

| Combine / storage | Input ms | Build ms | 10k queries ms | 5k updates ms | Tree MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| js-boxed | 14.8 | 24.7 | 56.9 | 25.9 | 59.33 |
| js-flat | 18.2 | 34.8 | 44.8 | 44.0 | 4.09 |
| rank-boxed | 16.2 | 188.0 | 365.4 | 227.9 | 67.07 |
| rank-flat | 19.7 | 8.2 | 15.5 | 16.4 | 4.07 |

[Raw samples](../../benchmarks/baselines/2026-09-12-flat-segment-speed-65536.json).

### 262,144 elements

| Combine / storage | Input ms | Build ms | 10k queries ms | 5k updates ms | Tree MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| js-boxed | 82.4 | 84.4 | 67.4 | 37.1 | 235.52 |
| js-flat | 67.0 | 119.6 | 51.2 | 47.9 | 16.46 |
| rank-boxed | 69.7 | 723.4 | 439.6 | 294.0 | 269.55 |
| rank-flat | 69.5 | 30.3 | 18.1 | 19.1 | 16.44 |

[Raw samples](../../benchmarks/baselines/2026-09-12-flat-segment-speed-262144.json).

### Specialization disabled, same current implementation

This control uses `--compiled=false` with 262,144 elements. It keeps the buffer
initialization improvements but disables scalar function compilation. The
checksums and final states match the compiled run.

| Rank combine / storage | Build ms | 10k queries ms | 5k updates ms |
| --- | ---: | ---: | ---: |
| rank-boxed | 717.3 | 439.8 | 295.6 |
| rank-flat | 739.6 | 397.2 | 257.3 |

[Raw control samples](../../benchmarks/baselines/2026-09-12-flat-segment-fallback-262144.json).

At the large size, the compiled flat tree is about 24 times faster to build
and query, and 15 times faster to update, than the ordinary Rank record tree
in the same comparison. Relative to flat storage with compilation disabled,
the gains are also large. Removing intermediate record construction and Rank
evaluation at each merge accounts for the main change; buffer copying alone
does not produce this speedup.

The JavaScript callback control has no Rank function metadata, so it cannot
use the kernel. Its flat build and updates remain slower than boxed storage.
Unsupported Rank functions have the same limitation. These results establish
an improvement for the supported workload, not every user-defined monoid.

One small-size ordinary Rank query sample was an outlier; raw samples retain
it. The large-size results were more consistent. A preliminary run overlapping
the test suite was discarded and is not included in these files.

## Validation

The full workspace tests passed: 62 language, 1,106 interpreter, and 74 CLI
tests. Two further guard tests were then added; the focused set of 34 flat
storage, combine, and segment tests passed. Checks cover no internal record
materialization, noncommutative order, output field order, overflow atomicity,
wide query results, global and captured builtin shadowing, call-depth limits,
CSP fallback, and byte initialization including negative zero and empty records.

## Reproduce

```sh
npm run build
node benchmarks/flat-segment.mjs > /tmp/flat-speed-65536.json
node benchmarks/flat-segment.mjs --size=262144 > /tmp/flat-speed-262144.json
node benchmarks/flat-segment.mjs --size=262144 --compiled=false > /tmp/flat-fallback-262144.json
```

Run benchmarks without a simultaneous build or test suite. Raw results include
the benchmark and runtime hashes. The benchmark passes the actual Rank operation
object to the tree so the same specialization used by Rank syntax is available.
