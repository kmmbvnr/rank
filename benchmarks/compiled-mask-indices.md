# Compiled numeric mask indices

The Number backend now lowers `Mask indices` for one-dimensional numeric
predicates and their private array stages. This lets a function build a mask,
collect its positions and update a fresh numeric array in one compiled region.
The implementation counts matches before reserving position storage, so a
sparse selection does not reserve one integer cell for every input cell.

Completed Boolean inputs and Boolean-only stages retain their native packed
word traversal. A preliminary unconditional lowering made a million-cell
sparse bitmap slower and unpacked it into bytes; that admission was removed.
The final bitmap control keeps the same native path in both revisions.

Ordinary array completion boundaries and builtin identity checks remain intact.
A bare finite sequence still produces the existing array-required error;
explicit completion permits the operation. Multidimensional coordinate results
retain native execution. Demand-budget runs also retain native traversal so a
speculative pass cannot change accounting or error timing. Existing inspection
and polling guards apply. Tests cover saved results, changing masks, empty
inputs, late failures, unused deferred masks, builtin replacement and reuse of
a compiled function under a later budget.

The baseline is `cd112cc9` (runtime identical to `ddae8f36`). Each control has
three alternating before/after pairs in fresh Node v24.15.0 processes on each
host. Timings include parsing and execution; peak RSS is captured before the
independent JavaScript oracle. The fused control performs 10,000 changing
128-cell mask operations and returns 11611375. The other controls select every
10,000th position from a million cells, twenty times, returning 990000000.

| Host / control | Before, ms | After, ms | Before RSS, MiB | After RSS, MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac, fused | 409.80 | 105.74 | 314.72 | 172.94 |
| Mac, bitmap | 94.37 | 94.42 | 169.70 | 169.80 |
| Mac, predicate | 324.06 | 289.40 | 248.44 | 171.84 |
| Intel, fused | 1302.06 | 260.43 | 288.86 | 161.71 |
| Intel, bitmap | 234.29 | 232.83 | 154.96 | 155.53 |
| Intel, predicate | 453.38 | 405.55 | 224.04 | 150.13 |

The larger predicate's Mac timing ranges overlap; its median alone does not
establish a reliable speedup. The small fused control demonstrates the dispatch
and staging benefit: 3.88–5.00 times faster, with 44–45% lower peak RSS. The completed-bitmap control checks the backend choice,
not a claimed optimization of the already packed native operation.

Verification includes 17 focused constructor cases and 557 affected tests
across 16 files on Mac and Intel. The interpreter source and test projects
pass TypeScript checks. Exhaustive corpus audits were not run.

Raw observations: [36 controls](baselines/2026-11-07-compiled-mask-indices.json).
Run from repository root, one process at a time:

```sh
node benchmarks/compiled-mask-indices.mjs fused
node benchmarks/compiled-mask-indices.mjs bitmap
node benchmarks/compiled-mask-indices.mjs predicate
```

Set `RANK_BENCH_RUNTIME` to a baseline interpreter `out/index.js` file URL for
the before runs.
