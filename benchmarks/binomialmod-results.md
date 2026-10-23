# binomialmod array calls (#428)

Apple M5, Node v24.15.0. Three sequential fresh processes per main variant;
medians below. The scalar baseline uses main `5c0eaeb6` (its binomial code
is unchanged from `961ae3de`). The generic intermediate used the shared
`mapScalarArrays` path and one modulus check per call, before adding
`storedBinomial`. The final variant also prepares the cache once per stored
array call and writes through `IntegerCells`.

Inputs: 2,000,000 integers N=8,000,001..10,000,000, K=N//3, modulus 1,000,000,007.
Input preparation and the initial scalar cache build are outside the warm timer.
The timed expression includes the result sum. Every sample checks checksum
`999868997833556`; the lifted benchmark also checks a small broadcast grid
against exact `binomial` arithmetic.

| Variant | Warm call and sum | Relative to scalar |
| --- | ---: | ---: |
| Original scalar loop | 7872.31 ms | 1x |
| Generic array mapping, per-call modulus check | 373.80 ms | 21.1x |
| Stored array batch, one cache extension | 118.72 ms | 66.3x |

The stored batch is 3.1x faster than generic array mapping. Cold cache build
through N=10,000,000 remains about 3.52 s (baseline 3.43 s). Cache storage was
not changed; the process heap immediately after construction is about 1.0 GB
in this harness and depends on GC timing.

The original issue range N=1000..2,000,000 was also checked in separate fresh
processes: lifted and scalar results both equal `998880163050603`.
These single samples took 165.23 ms lifted and 8051.52 ms scalar with a ready
cache; these are not three-sample medians.

Raw results are in `baselines/2026-10-23-binomialmod-*.jsonl`.

Reproduce after building:

```sh
node benchmarks/binomialmod.mjs
node benchmarks/binomialmod.mjs --mode=scalar --runtime=/path/to/baseline/packages/interpreter/out/index.js
node benchmarks/binomialmod.mjs --size=1999001 --limit=2000000 --samples=1
node benchmarks/binomialmod.mjs --mode=scalar --size=1999001 --limit=2000000 --samples=1
```

Verification: focused array, arithmetic, interruption, operation catalogue,
shape and language-inference tests, plus the workspace build. Full `npm test`
and corpus audits were not run. Broader runs of the affected test files also
found existing failures, reproduced on unmodified main: the shape catalogue
is missing lowerindex/upperindex/factorsieve samples, and three value-facts
expectations for scans/reductions are stale. Those are outside #428.
