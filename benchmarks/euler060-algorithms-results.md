# Euler 060 algorithm comparison

Measured 2026-10-25 on Apple M5 / Node v24.15.0. Three serial fresh processes
per case, reversing case order on alternate samples, with the same frozen
interpreter and language build for every case. Default compilation is enabled.
Execution includes parsing, both builds/searches and any explicit sieve setup.
Every run checks Upper = Answer = 26033.

## Compared algorithms

- `graph`: the preceding batched builder and generic undirected graph. Search
  snapshots neighbors, filters, indexes candidate membership and sorts each result.
- `lazy`: prepare values/scales, then check compatibility only in the current
  recursive candidate set, using batched forward/backward membership tests.
  This removes the graph but repeats checks and creates indexed candidate arrays.
- `bits`: build upper-triangular adjacency as one arbitrary-precision integer
  mask per vertex. Intersect candidates with `band`; visit the lowest set bit.
- `dense`: keep the original graph algorithm but explicitly build `primesieve`
  large enough for every concatenation in each build. Sieve preparation is timed.

All four use primes below 10000 to find an initial sum bound, then search all
eligible primes below that bound. They do not stop after the first five-clique or assume that
the globally minimal set is entirely below 10000.

## Results

Medians; memory columns are MiB. Peak RSS is the process high-water mark at the
end of execution, including imports and temporary allocations. Heap + external
is sampled after forced GC, with the interpreter and its variables still alive.
It excludes other native process memory and is not the size of the graph alone.

| Workload | Execute | Peak RSS | Heap + external after GC |
| --- | ---: | ---: | ---: |
| graph | 3.836 s | 624.4 | 78.4 |
| lazy | 5.864 s | 682.3 | 98.8 |
| bits | 2.583 s | 477.0 | 56.9 |
| dense | 7.739 s | 754.4 | 75.3 |
| graph-fixture | 4.055 s | 658.0 | 72.7 |
| bits-fixture | 2.877 s | 510.3 | 68.9 |

The selected bitset graph is **1.48x faster** than the preceding graph
(32.7% less execution time). Process peak RSS is about
24% lower, and live heap + external is about
27% lower in these samples. RSS varies with V8 allocation/GC; raw samples are
retained rather than treating any one run as an exact memory requirement.

The old fixture has eight tests; the selected fixture retains their semantic
coverage with the new representation and adds two tests (ten total). Both run
the complete default input once. Fixture timings therefore include the extra
small tests in the selected version.

## Why these two bitmaps differ

Unbounded `in primes` already uses a 4 KiB segmented bitmap with adaptive
membership. A full explicit odd-only sieve for the second build needs about
155 MiB for flags alone: the conservative concatenation bound is 2,603,226,032.
The original graph and interpreter allocations are additional. That setup loses
overall in this one-shot workload despite constant-time bitmap membership.

The selected adjacency bitmap indexes only 2862 candidate vertices, not all
integers up to the concatenation bound. Its worst-case raw row payload is about
1 MiB before BigInt/array overhead. Each compatible pair is stored only from
the smaller vertex to the larger one; traversal is ascending, so reverse edges
are unnecessary. `band` replaces neighbor snapshots, candidate indices and sorts.

## Verification

- Both the full program and fixture passed reference/compiled differential
  execution: exact answer 26033 and all ten embedded tests.
- Tests retain scalar-vs-batched compatibility across decimal boundaries,
  larger-prime edges, a cheaper clique after an earlier match, independent
  calls, no-clique bounds and concatenation boundaries. New tests cover clique
  sizes 1 through 4 and candidate bits above a machine word.
- Both name/type audit cases, semantic boundaries and application-form checks
  passed. No runtime, lane, exclusion, timeout or default-input changes.
- Historical collection/scalar/scope benchmarks now use the archived graph
  fixture so their original experiment remains reproducible; worker smokes pass.

## Reproduce

```sh
npx tsc -b tsconfig.build.json
node benchmarks/euler-prime-pairs.mjs --samples=3
```

Use `--runtime=/path/to/frozen/out/index.js` to freeze the runtime,
`--cases=graph,lazy,bits,dense` for main programs only, or `--engine=reference`.
The harness runs each sample with `--expose-gc`; GC is outside execution timing.
Run without concurrent builds, tests or profilers.

[Raw samples](baselines/2026-10-25-euler060-algorithms.json).
