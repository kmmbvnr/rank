# Euler 223: mirrored trees and stored array consumers (#447)

Base: `006ed21b`, Apple M5, macOS arm64, Node v24.15.0. Both 223 inventory rows were unfinished when selected.

The delivered demo keeps the ternary-tree algorithm and array batches, removes mirrored subtrees, counts the long root chains algebraically, bounds side-branch seeds, and uses explicit ordinary `=` for arithmetic intermediates. The runtime uses packed mask words and integer gathers, and preserves native block copies instead of replacing them with scalar tensor emission. Existing fixture assertions are unchanged.

## Delivery measurements

All measurements use fresh processes without concurrent benchmark/test workers. Imports are excluded; parsing/preparation/execution are included. RSS is whole-process high water.

The **same shipping source** at the full Limit 25000000:

| Runtime | Compiled ms | Reference ms | Compiled RSS MiB | Reference RSS MiB |
|---|---:|---:|---:|---:|
| Parent runtime | 103315.63 | 116217.17 | 1926.86 | 2250.80 |
| Selected runtime | 13914.56 | 14914.62 | 1375.47 | 1331.64 |

Selected compiled is the median of three samples (13.886 / 14.440 / 13.915 seconds). Parent full executions and selected full reference are single samples. Every full answer is **61614848**. These show about **7.4x compiled / 7.8x reference** runtime improvement on the already corrected source; they are not ratios against the original uncorrected full demo, which was not executed.

The full existing fixture (Limits 100, 3000, 30000), three samples each, on the selected runtime:

| Source | Compiled ms | Reference ms |
|---|---:|---:|
| Captured original | 3912.02 | 2785.28 |
| Shipping | 261.80 | 217.12 |

This isolates the source change: about **14.9x / 12.8x** faster, with the same three assertions: 72, 3591, 45638.

## Why the original tree was slow

The original demo already counts `(1,b,b)` instead of walking its long first-child chain. But root `(1,1,1)` also generates `(3,1,3)` through its third child. Repeated third children are `(5,1,5)`, `(7,1,7)`, etc. This reflected chain alone has 6,249,999 nodes/levels at the default input; every sparse level still pays array construction and filtering overhead.

The odd-root tree now omits the initial third seed for `b=1`, and omits the third child whenever `A=B`, since its subtree mirrors the first. Retained nodes are counted directly, without counting both orientations and dividing afterward. The even tree is unchanged. Simply deleting the long chain would lose its side branches; symmetry removes the complete duplicate subtrees instead.

At Limit 30000, a native structural control visits 7,584 nonempty levels in the original tree (maximum depth 7,499), versus 145 (maximum depth 85) with symmetry. The canonical full native control reaches the same answer with 49,114,849 generated retained nodes; root chains add 12,499,999. It filters children before storing them and uses different storage, so its 2.90-second timing is not an interpreter-overhead ratio.

Side-branch initial perimeters are `12*b+5` and `12*b-5`. Only `b <= (Limit+5)//12` need seed arrays; the entire root-chain count remains algebraic. The intermediate expressions are explicitly eager in the demo. No deferred-binding semantics or ordinary completion boundaries were changed in the interpreter.

Initial research at Limit30000, three processes per variant/engine on the parent runtime: original 3678.15 / 2908.32 ms; symmetry alone 403.61 / 387.15 ms; symmetry plus explicit eager intermediates 280.31 / 275.90 ms. The initial eager canonical full prototype took 114.24 seconds. Raw initial results and captured source are in the investigation baseline.

## Runtime choices and rejected variants

1. `filter` now tries the existing `packedTruePositions` consumer before tensor/scalar mask traversal. Each selection still creates an independent positions snapshot; there is no mask-result cache. Replaced readers, changed shapes, opaque/lazy inputs and missing cells keep their guards and ordinary fallback behavior.
2. Explicit selection materialization gathers homogeneous Int32/BigInt64 cells directly into matching storage, retaining linear offsets/strides, exact values, uniform binding checks, cancellation and independent writable results. Empty results keep ordinary construction. Arbitrary-precision, missing, nested, real and opaque sources retain the ordinary path. The Float64 gather prototype did not establish an extra speed/memory benefit and was omitted.
3. A plain source `concat ... copy` over compatible completed numeric blocks now uses the existing native block-copy path for results at the existing 1024-cell dense minimum. The scalar tensor emitter previously turned Int32 loads into BigInt values and stored them one by one. Arithmetic over concatenations and lazy producers retain tensor lowering.
4. Applying the block preference to every size regressed tiny copies. The final choice is made during shape binding and keeps the cached tensor loop for small unchanged layouts. The 1000-copy probes below support reusing `DENSE_MIN_CELLS = 1024` output elements. **No Number-loop threshold was changed.**

A masks-only full candidate took 66.73 seconds compiled but 15.29 seconds reference. This discrepancy exposed the scalar concat-copy path and motivated the compiler admission repair, rather than declaring the mask optimization sufficient.

Three samples per case/policy; medians in ms. The numeric-gather candidate includes Float64, while the selected policy uses integer gathers and bounded concat dispatch:

| Workload | Parent | Packed positions | Numeric-gather candidate | Selected |
|---|---:|---:|---:|---:|
| Int32 filter | 270.27 | 153.57 | 116.51 | 114.11 |
| Int64 filter | 243.39 | 128.84 | 126.62 | 127.22 |
| Real filter | 261.25 | 139.27 | 140.66 | 143.63 |
| Empty filter | 213.78 | 100.65 | 100.49 | 100.20 |
| Canonical eager source, Limit 1m | 3559.98 | 2295.33 | 2215.34 | 869.92 |
| Shipping source, Limit 1m | 3227.24 | 2100.41 | 2065.58 | 778.90 |

Real filtering improves versus the parent through packed mask traversal; no extra real-gather speedup is claimed. Small differences between the packed-only and selected real cases remain visible in the data.

1000 repeated concat copies, three processes per size/version, output element count shown:

| Output cells | Parent ms | Selected ms |
|---|---:|---:|
| 4 | 103.15 | 103.72 |
| 16 | 104.82 | 102.77 |
| 128 | 107.47 | 105.30 |
| 256 | 109.23 | 108.07 |
| 512 | 111.88 | 111.83 |
| 1024 | 118.95 | 120.49 |
| 2048 | 129.90 | 123.25 |
| 8192 | 183.16 | 124.08 |

The unbounded candidate regressed 128-cell results from roughly 108 to 117 ms, with crossover near 1024 output cells. The selected policy preserves tiny cached kernels and improves larger copies. The rule is based on these Mac measurements and existing native-kernel admission, not a claim of an optimal threshold for every CPU.

## Unchanged Euler controls

Eight full unchanged demos, three fresh processes per version, every answer matches. Median ms:

| Euler | Parent | Selected |
|---|---:|---:|
| 023 | 394.73 | 394.50 |
| 088 | 790.26 | 787.74 |
| 125 | 197.51 | 194.81 |
| 166 | 1076.69 | 1013.98 |
| 185 | 599.65 | 593.69 |
| 213 | 1716.48 | 1702.73 |
| 214 | 1322.53 | 1325.07 |
| 221 | 1226.05 | 1242.48 |

No substantial general slowdown was observed on this Mac. Euler221's small positive difference has overlapping sample ranges. This is not an Intel comparison or proof for every workload.

## Verification

- TypeScript build and interpreter test typecheck pass.
- **256 focused tests / 11 files**, **9192 ordinary tests / 404 files** (one worker, 288.46 seconds), semantic-boundary/application-form checks, and one scoped fixture type audit plus one scoped fixture differential audit pass.
- The first two-worker ordinary attempt had seven timeouts, with 9185 tests passing and no assertion mismatches. All 171 tests in the seven affected files passed separately in 9.84 seconds; the entire serial rerun then passed without source changes. The cause of the parallel stalls is not established; this does not claim a clean parallel full-suite run.
- **300 independent oracle checks**: 30 small limits including 0–20, original/canonical/eager/shipping sources plus a shipping variant with seed windows of width 8, both compilation modes. Oracle enumerates sorted integer side pairs and directly checks the squared identity, without the tree transformations.
- Existing fixture passes in both modes; full selected source reaches 61614848 in both modes and matches the native structural control.
- Full default remains in the existing routine resource-exclusion catalogue (about 1.35 GiB peak RSS); it was explicitly verified separately. Scoped audits run the small fixture. No exhaustive corpus type/differential audit, Nurikabe, web/mobile/CLI suite or Intel run is claimed.

## Reproduction

Build the interpreter first; an alternate built runtime can be selected with `--runtime=/absolute/path/to/out/index.js`.

```sh
node benchmarks/euler223-almostright.mjs
node benchmarks/euler223-almostright.mjs --reference
node benchmarks/euler223-almostright.mjs --fixture
node benchmarks/euler223-almostright.mjs --fixture --original
node benchmarks/euler223-almostright.mjs --Limit=1000000
node benchmarks/experiments/euler223-mask-kernels.mjs --case=int32
node benchmarks/experiments/euler223-mask-kernels.mjs --case=real
node benchmarks/experiments/euler223-concat-copy.mjs --size=512
node benchmarks/experiments/euler223-oracle.mjs /absolute/path/to/out/index.js
node benchmarks/experiments/euler223-native.mjs 25000000
node benchmarks/experiments/euler223-controls.mjs /absolute/path/to/demos/euler/088_productsum_stack.ra /absolute/path/to/out/index.js
```

`--original` loads the captured original source from `baselines/2026-10-28-euler223-investigation.json`. The two canonical experiment sources intentionally retain old comments/counters to isolate the initial measurements. Policy comparisons, crossover probes, full/fixture/control samples, source/runtime hashes and verification are in `baselines/2026-10-28-euler223-delivery.json`; zero diagnostic counters are omitted except the documented coverage/storage counters.
