# Euler 425: bounded digit edits and packed immutable ropes

2026-11-06. Full answer **46479497324** is unchanged. The work reduces
allocation in both the program and the general rope runtime. It does not
change ordinary `=` materialization or lazy binding semantics.

## Program

Generate digit edits in batches of at most 262144 primes. Each undirected
edge is generated once, from its larger prime, and stored as
`High * Base + Low`. A boolean prime table replaces repeated membership
lookups. The largest actual prime determines the digit width, avoiding an
extra pass at powers of ten. Leading zeroes remain forbidden, including when
removing the first digit.

Completed edge batches are stored in an immutable `rope`, then copied and
sorted once. Repeated ordinary array concat copied the accumulated prefix;
using smaller batches alone made this substantially worse. Explicit ropes
keep strict assignments while avoiding that repeated materialization.

Union-find attaches the larger root to the smaller, so a component reaches
2 precisely when its root becomes 2. Edges sorted by their larger endpoint
also guarantee that endpoint's stored parent is already a root. Resolve the
smaller endpoint only when its parent is indirect. This reduces compiled
helper calls from 5684136 to 8559 at the full input. Parents are private to
the helper containing the edge loop, allowing the numeric loop to reuse
its fresh array. Each Rank function has at most one loop.

The batch size balances setup and temporary storage: 16K batches were much
slower; 1M batches used more memory without a clear speed advantage. These
are local measurements rather than a universal hardware threshold.

## General runtime capability

Integer `rope` snapshots now retain irregular blocks in Int32/BigInt64
storage rather than a boxed BigInt per cell. The existing 256-cell chunk
partition and arithmetic run compression remain observable through `chunks`
and `runs`. Every block is copied, so later mutation of the source cannot
change the snapshot.

Constructor-owned integer ropes can also fill the final packed array
directly during explicit completion. Slices, reversal and concatenation
preserve integer-width evidence. Values beyond signed Int64, mixed values,
empty ropes and oversized completion keep their existing paths. No Number
admission limit or exact-integer contract changes.

Budgeted, inspected and custom-polling execution retains ordinary demand;
native paths poll cancellation. Host readers and replaced sequence plans
cannot be bypassed. Shared input buffers decline the packed snapshot path;
SharedArrayBuffer need not exist in the browser environment.

## Measurements

Node v24.15.0; base `2824d94f`, matching language registry on both machines.
Three alternating fresh processes per variant. RSS is process peak memory,
not retained heap. Host load was uncontrolled; compare medians within each
host rather than absolute times across architectures.

| Full N=10000000 | Original | Source only | Source + runtime |
| --- | ---: | ---: | ---: |
| Mac compiled median | 3.774 s | 3.264 s | 2.963 s |
| Mac median peak RSS | 1500 MiB | 657 MiB | 610 MiB |
| Intel compiled median | 8.341 s | 8.474 s | 7.702 s |
| Intel median peak RSS | 697 MiB | 532 MiB | 516 MiB |

Source changes alone do not show a speed win on Intel, but reduce its memory.
The complete change improves median time by about 21% on Mac and 8% on Intel.
The old 33-second compiled exclusion was stale even before this work.

One full reference run on Mac: **31.743 -> 10.685 s**, peak RSS
**1531 -> 535 MiB**, with the same answer. This is a single run, not a median.
Full reference stays manual; the ordinary fixture remains bounded.

A separate one-million-cell irregular Int64 rope-construction control
isolates the runtime: Mac median **44.947 -> 6.386 ms**, median peak RSS
**180 -> 124 MiB**; Intel **127.272 -> 18.052 ms**, **174 -> 121 MiB**.
This control does not measure the complete Euler pipeline.

The paired source was followed by local-variable renames and selecting prime
flags before boolean inversion. Final-source verification is retained in
raw data separately. See [raw measurements](baselines/2026-11-06-euler425-followup.json).

## Verification and reproduction

- Independent oracle: string digit edits plus minimax Dijkstra, structurally
  separate from arithmetic edits and union-find. 22 limits from 0 through
  20000 across reference, exact compiled and Number compiled: 66 comparisons
  on each host. A separate oracle at one million gives **532658671**.
- Full answer checked on both hosts. Dedicated test asserts numeric loops,
  numeric helpers and native sequence copies, with no numeric replay.
- Six focused suites pass on both hosts: **94 tests**. Coverage includes rope
  snapshots, chunks/runs, range compression, signed Int64 extremes, slice and
  reverse completion, mutation, huge inputs, replaced readers/plans, demand,
  cancellation and environments without SharedArrayBuffer.
- TypeScript build passes. Exhaustive type/differential audits were not run.

Build with `node node_modules/typescript/bin/tsc -b tsconfig.build.json`.
From `packages/interpreter`, run:

```sh
node scripts/test.mjs test/euler425.test.ts test/packed-rope.test.ts \
  test/rope.test.ts test/sequence-retention.test.ts \
  test/concat-completion.test.ts test/concat-depth.test.ts
```

From the repository root, `node benchmarks/experiments/euler425-verify.mjs`
runs the oracle comparisons; `euler425-run.mjs` accepts execution mode,
limit and source path. `euler425-pairs.mjs` requires `RANK425_BASE_RUNTIME`
to point to an independently built baseline interpreter module file URL.
The raw data distinguishes original source/runtime, new source/old runtime,
and the complete change. `euler425-rope-control.mjs` accepts an optional
`RANK425_RUNTIME_ROOT` absolute out-directory path ending in `/`.
