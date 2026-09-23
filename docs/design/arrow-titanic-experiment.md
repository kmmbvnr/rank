# Arrow table storage: Titanic experiment

This experiment takes the feature preparation from
[`demos/kaggle/001_titanic.ra`](../../demos/kaggle/001_titanic.ra): fill missing
`Age` and `Fare` with their medians, derive `Female` from `Sex`, and build a
four-column numeric matrix. The Kaggle CSV is not in the repository, so the
benchmark generates deterministic rows at two sizes.

The baseline builds the current Rank table representation with `ownedObject`
rows and an `ownedArray`. The candidate builds an Apache Arrow JS table from
the same source columns. Both prepare features in JavaScript. This is a storage
experiment, not an execution of the full Rank program.

## Results

Apple M5, Node v24.15.0, Apache Arrow JS v21.2.0, source revision `edcc859`,
2026-09-23. Each number is the median of five fresh processes per representation
and size; the run order alternated. The full numeric output matrices matched by
SHA-256, as did their checksums, lengths, and a later `Fare` scan.

| Rows | Representation | Build ms | Prepare ms | Fare scan ms | Table MiB | After preparation MiB |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 1,000 | Rank rows | 0.85 | 0.87 | 0.07 | 0.54 | 0.68 |
| 1,000 | Arrow | 2.23 | 1.60 | 0.13 | 0.19 | 0.31 |
| 100,000 | Rank rows | 56.47 | 34.20 | 4.78 | 51.06 | 64.81 |
| 100,000 | Arrow | 16.71 | 32.91 | 2.49 | 3.71 | 6.97 |

Build time starts with identical generated JavaScript columns and excludes
input generation. Preparation covers median calculation, filling missing
values, the derived column, and matrix construction. The `Fare` scan follows
preparation. Memory is the post-GC delta of `heapUsed + arrayBuffers` from
before input generation, after releasing the source column variable. It is
retained memory, not peak memory or total allocation. The last column includes
the output matrix and derived `Female` column.

At 100,000 rows, Arrow retained about 14 times less table memory, built about
3.4 times faster, and scanned `Fare` about 1.9 times faster. Preparation times
were close. At 1,000 rows, Arrow was slower in every timed phase. These results
do not measure CSV parsing, startup, the full Titanic program, joins, grouping,
or numerical kernels.

## Rank integration boundary

The current table interface exposes object rows. A column assignment reads
every row and writes its `entries` map; projections depend on revision tracking.
An Arrow-backed table would need to preserve missing fields, writes through
aliases, row identity, and cache invalidation. This benchmark supports further
work on large table storage. It does not establish that Arrow should replace
all Rank arrays or that a direct adapter is sufficient.

The [benchmark](../../benchmarks/arrow-titanic.mjs) is kept without a runtime
dependency on Arrow. In a separate checkout, build Rank, install the benchmark
package locally, then run it:

```sh
npm run build
npm install --no-save --package-lock=false apache-arrow@21.2.0
node benchmarks/arrow-titanic.mjs
```

The install command changes local `node_modules` only. Results may differ on a
later runtime or machine; compare the two representations within the same run.
