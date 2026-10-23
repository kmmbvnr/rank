# Stored array paths (#427)

Baseline: `e4a46f92`. Apple M5, Node v24.15.0, macOS.
Each entry is the median of three fresh processes, in seconds. Samples include
parsing, array construction, five loop iterations, and printing the checksum.
The default input contains 4,998,000 integers; slices select 4,500,000 cells.

| Case | Baseline | Direct compact reads | + Slice block copies | + Concat block copies | Total speedup |
| --- | ---: | ---: | ---: | ---: | ---: |
| fill | 3.903 | 0.591 | 0.591 | 0.823 | 4.7x |
| fill-copy | 4.010 | 0.599 | 0.576 | 0.852 | 4.7x |
| computed | 1.676 | 1.665 | 1.688 | 1.912 | 0.9x |
| slice-vector | 4.552 | 4.647 | 1.375 | 1.402 | 3.2x |
| slice-matrix | 9.057 | 8.953 | 0.219 | 0.231 | 39.3x |
| concat | 6.490 | 3.103 | 3.088 | 0.230 | 28.3x |

Each stage was measured and checked separately. Direct compact reads remove
Proxy dispatch while retaining exact BigInt arithmetic. Slice copies use typed
buffer blocks at assignment and copy boundaries. Concat copies use the same
mechanism and convert boxed padding only after proving it fits the destination.
Block descriptors are streamed instead of stored once per matrix row.

The computed-array case is an unchanged control. Its stage medians varied from
1.66 to 1.91 seconds. A follow-up with five samples per version, alternating
baseline and final processes, measured 2.167 seconds before and 2.092 seconds after.
The changing machine load limits comparisons of small differences; this control
did not confirm a slowdown. No Euler 495 algorithm was
changed, and the full Euler 495 workload and its reported OOM were not rerun.

Every timed sample asserts its checksum: 74970000 for arithmetic, 22500000 for
slices, and 24990000 for concat. The regression tests cover values, shape, aliases,
source writes, overflow, reader replacement, mixed storage and cancellation.
Final validation: `npm run build`, 367 tests in 19 targeted interpreter files,
and `node scripts/check-semantic-boundaries.mjs`. The full test suite and corpus
were not run.

Reproduce:

```sh
npm run build
node benchmarks/array-storage-paths.mjs
# Small correctness check:
node benchmarks/array-storage-paths.mjs --rows=10 --columns=100 --samples=1
```

Raw samples for all stages, including checksums and end-of-run RSS (not peak
memory), are in `array-storage-paths-results.json`.
