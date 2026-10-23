# Euler 333: recursive accumulators and layered counting (#363)

Measured on 2026-10-23, Apple M5, Node v24.15.0. The runtime is unchanged
from `413eded7`; all variants run on that same runtime. Samples are fresh
processes, executed sequentially with alternating variant order. No builds
or tests ran during completed timing samples. Other host activity is not
controlled.

## General mechanism first

The existing `counter` is already an explicit shared sparse accumulator.
Passing it through the original recursive search preserves branch updates
without copying a dense array. The benchmark retains both the original
array traversal and this counter variant. A focused test verifies sharing
across recursive branches and independence of separately created counters,
with compilation both enabled and disabled.

Expanding last-use array transfer alone is insufficient here. Self-rebinding,
loop continuations and ownership on return all need proof; an ordinary array
parameter must retain value semantics. Even without copies, the original
full traversal makes 183,872,640 calls and reaches 40,549,125 nonempty leaves.
The counter experiment removes copying but retains that traversal. No new
mutable-array semantics or interpreter optimization was added.

## Measurements

Medians of three ordinary fresh-process samples:

| Variant | Limit | Solve time | Answer |
| --- | ---: | ---: | ---: |
| Original recursive array | 10,000 | 4,445 ms | 24853 |
| Recursive shared counter | 10,000 | 2,464 ms | 24853 |
| Layered dense rows | 10,000 | 31.8 ms | 24853 |
| Layered dense rows | 1,000,000 | 1,219 ms | 3053105 |

At one million, separate original-array and shared-counter workers both hit
the 30-second timeout. Their full answers were not obtained in those Rank
runs, so no exact full-input speedup is claimed.

At 10,000 the counter experiment is 1.80x faster than the original; the final
layered algorithm is 140x faster. These local results are not portable timing
guarantees. The default layered runs range from 1.200 to 1.343 seconds.

Separate diagnostic runs at 10,000 record 60,428 whole-array CoW copies
(604,280,000 cells) for the original, and zero for both other variants. The
full layered diagnostic run also records zero CoW copies. Fresh row allocation
is still required and is outside the CoW counter.

## Layered recurrence

A special partition has at most one odd term: a power of three. Every other
term has a distinct, increasing exponent of two and a strictly decreasing
exponent of three. Let `F_p(n)` count partitions whose powers of three are
at most `p`, where `p` itself is a power of three.

- `F_p(0) = 1`, representing the empty partition.
- For positive even `n`, every term is even, so `F_p(n) = F_p(n / 2)`.
- For odd `n`, keep the preceding row's count. If `n >= p`, add the preceding
  row's count at `(n - p) / 2`: remove the unique odd term `p` and halve the
  remaining even terms, whose powers of three must be strictly smaller.

Ascending `n` makes each current-row half-sum available. The implementation
keeps the preceding row read-only and writes a fresh next row. It performs
`O(Limit log_3 Limit)` work with `O(Limit)` live table storage, instead of
returning a million-cell array through recursive branches. Counts remain
exact integers. `partitioncounts` excludes `Limit` and includes the empty
partition; `solve` still sums primes whose count is exactly one.

## Verification and reproduction

The benchmark checks every cell, including all million cells at the default
limit, against an independent native exhaustive traversal. Its separate sieve
checks the prime sum. Oracle work and this second table construction are
outside the solve timer. The original/counter variants exclude the empty
partition; their zero cell is normalized only for comparison.

The solve timer includes table allocation, compilation and prime selection.
Imports, parser initialization and helper definitions are excluded. Diagnostic
runs are separate from ordinary timing samples. CoW counters measure copied
cells, not total allocation or memory use. Full traversals have a 30-second
worker timeout; a timeout is not a completed execution measurement.

```sh
npm run build
npm test --workspace @arrrank/interpreter -- test/euler333.test.ts test/counter-gather.test.ts test/explicit-plan-demos.test.ts -t 'Euler 333|counter gather|special-partition'
node packages/cli/bin/cli.js check demos/euler/333_specialpartitions.ra
node packages/cli/bin/cli.js test demos/euler/333_specialpartitions_test.ra
node benchmarks/euler333.mjs --trials=3 --timeouts
```

The full workspace build passes. Targeted tests pass 30 cases (202 unrelated
cases skipped by the name filter); the Rank fixture and its CLI check pass,
and both execution-exclusion metadata tests pass. The default CLI run prints
`3053105`. Targeted tests compare every count at 23 limits around powers of
two and three, test zero/empty limits, repeated solves, independent saved tables and
zero CoW copies. Exhaustive corpus runs and the full npm test suite were not
run. The default remains excluded from uncompiled corpus execution.

[Raw measurements](baselines/2026-10-23-euler333.jsonl)
