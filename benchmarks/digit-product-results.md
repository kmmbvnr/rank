# Digit-constrained Cartesian products

Measured on 2026-10-21, macOS arm64, Node v24.15.0. Baseline: `ec40f0fd`.
Three fresh processes per mode; medians below. Raw samples are in
`baselines/2026-10-21-digit-product.jsonl`.

The workload follows Euler 322's base-5 no-carry construction, using digit
caps `[4,0,2,1,3,2,2]` and `[2,4,1,3,2,2]`. Each side has 1,080 values.
Rank forms 1,166,400 sums, flattens the product, rejects integers whose
bitwise AND with `0b1010010101` is nonzero, and sums the survivors.
Independent BigInt enumeration checks the result `11306922115218`.

| Mode | Time (ms) | Peak process RSS (MiB) | Cached derived cells computed |
| --- | ---: | ---: | ---: |
| Fusion disabled | 1,133.27 | 631.34 | 3,499,200 |
| Previous tensor fusion | 404.82 | 326.48 | 1,166,400 |
| Product/reshape/filter fusion | 29.07 | 132.14 | 0 |

The candidate is about 13.9 times faster than the previous optimized path,
with about 60% lower peak process RSS. The previous path already fused the
mask and sum, but first materialized the outer product at reshape. The new
path computes the product value and predicate in one loop, retaining neither
the product nor the mask. Every candidate is still visited.

RSS includes the runtime, parser and dependencies; it is not the product's
retained storage size. Heap deltas in the raw samples are affected by GC and
are not used to estimate memory savings. Function declaration and input
construction precede timing; the first call's planning and code generation
are included. Diagnostics are enabled in every measured mode.

Reproduce after building both checkouts:

```sh
npx tsc -b tsconfig.build.json
node benchmarks/digit-product.mjs 3 --baseline /path/to/baseline-checkout
```

Without `--baseline`, the harness compares fusion disabled and enabled in the
current checkout. This generalized carry workload measures the new capability;
the corrected Euler 322 default already has only 4,800 low-digit candidates.

Fusion applies to private function expressions over proved integer storage
with total arithmetic (`+`, `-`, `*` and integer bitwise operations). Observable
readers, missing cells and potentially failing source arithmetic retain the
ordinary evaluation path. Standalone reshape behavior is unchanged.
