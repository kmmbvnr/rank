# Euler 247: bounded stack and early child pruning

The original default program already compiles as one Number loop. Its remaining reference-mode cost is repeated scalar interpretation, binding access and array writes, rather than failed compilation or array materialization. No runtime/compiler changes are needed for this improvement.

The full input remains `Right=3`, `Up=3`, `Cap=1000000`, and the answer remains **782252**. The default assertion and the problem's `Right=1, Up=1 -> 50` example are retained. Root and asymmetric cases are added to the fixture.

## Change and bounds

The original depth-first traversal visits 1,564,505 nodes: 782,252 accepted squares and 782,253 immediately rejected children. Before enqueueing a child with lower-left corner `(a,b)`, the solver now checks `(a+Small)*(b+Small) <= 1`. This tests whether a square of side `Small` fits under the hyperbola, avoiding the visit and square root for rejected children. The existing computed-side check and epsilon remain.

The original two stack arrays each allocate one million cells. They now use `min(Cap, ceil(1/Small)+2)`, or 1250 cells for the default. With the existing right-then-up push order, pending right siblings correspond to upward steps along the active path. Each accepted upward step increases `Y` by at least `Small`, while `X >= 1` and a valid square has `Y < 1`. This bounds those ancestors by `1/Small`, plus a constant allowance for the current node and children. The observed peak stack length of 10 is evidence for this input, not the allocation rule. `Cap` and the `Cap*4` iteration budget are preserved.

The child-fit identity is mathematical; floating comparisons can round differently near a threshold. Full/default, the example, root and asymmetric cases are verified below. No claim is made for arbitrary extreme floating inputs beyond the original solver's numerical assumptions.

## Measurements

macOS arm64, Node v24.15.0, runtime parent `8a7e58f8`. Each cell is a median of three fresh sequential processes, including parsing/preparation and diagnostics, excluding runtime import. Peak RSS is the process high-water mark, not retained array size.

The investigation series captured process load before/after all 18 samples and found no process above 25% CPU at those endpoints:

| Variant | Compiled, s | Reference, s | Compiled RSS, MiB | Reference RSS, MiB |
|---|---:|---:|---:|---:|
| Original | 0.176595 | 5.189432 | 225.58 | 258.73 |
| Bounded stack only | 0.159638 | 5.185138 | 177.53 | 178.92 |
| Bounded stack and child pruning | **0.158781** | **3.327696** | **179.00** | **178.69** |

The selected variant is about **1.56x faster in reference mode**, with about **31% lower reference peak RSS** in this series. Compiled total time improves about **1.11x**, and compiled peak RSS about **21%**. The old issue table's 44–49 s reference times are not reproduced on this runtime and are not used as the baseline.

After a fresh Langium generation and TypeScript build from the same parent, final-source controls reproduce the result:

| Final delivery series | Compiled, s | Reference, s | Compiled RSS, MiB | Reference RSS, MiB |
|---|---:|---:|---:|---:|
| Original | 0.177918 | 5.245325 | 224.17 | 209.38 |
| Selected | 0.159413 | 3.339982 | 179.55 | 180.80 |

These are separate samples, not pooled with the investigation series. Several delivery endpoints show Terminal activity at 25–36% CPU; raw observations are retained and marked. The earlier investigation series supplies the speedup estimate. Neither series is an Intel or cross-platform claim.

A reference CPU profile distributes time across expression evaluation, operator dispatch, binding/frame operations and cell writes. Original diagnostics show no Number overflow, COW array copy or typed-cell unpacking. Reducing only stack capacity does not materially improve reference execution; child pruning does. An exploratory parent-node product precheck was slower than child pruning and was not selected.

## Verification and reproduction

- Fresh Langium generation and TypeScript project build pass. After main advanced with the parser change `b10c5de8`, generation/build, both fixture modes, both CLI checks and all four focused corpus checks were repeated successfully on that parent. Earlier timing series remain attributed to `8a7e58f8`.
- Both original assertions and the new root/asymmetric fixture block pass in compiled and reference modes (three blocks per mode).
- An independent rationalized-form geometric oracle checks eight index pairs. Original and selected solver agree in both engines: 32 investigation runs.
- A separate best-first max-heap oracle uses neither the target threshold nor DFS and verifies that the last of all 20 `(3,3)` paths has rank 782252.
- Filtered corpus differential/type audits, CLI checks for both files, execution-exclusion checks and JavaScript syntax checks are recorded in the raw artifact.
- Both files remain eligible for ordinary corpus execution. No exclusions, execution budgets, compiler safety checks or global thresholds change. No full interpreter-suite or Intel run is claimed.

After building:

```sh
node benchmarks/euler247-hyperbolasquares.mjs --variant=original
node benchmarks/euler247-hyperbolasquares.mjs
node benchmarks/euler247-hyperbolasquares.mjs --reference
node benchmarks/euler247-hyperbolasquares.mjs --fixture
node benchmarks/euler247-hyperbolasquares.mjs --fixture --reference
node benchmarks/experiments/euler247-geometric-oracle.mjs
node benchmarks/experiments/euler247-heap-oracle.mjs
```

Use `--variant=stack` for the allocation-only control, `--Right=1 --Up=1` for the example, and `--runtime=/absolute/path/packages/interpreter/out/index.js` for a separate built runtime. Sources, diagnostics, load snapshots and verification logs are in [the raw artifact](baselines/2026-10-28-euler247.json).
