# Queens across languages

Compare the two eight-queens demos with equivalent implementations using only the standard libraries of TypeScript/Node, Python and Ruby.

```sh
npx tsc -b tsconfig.build.json
node benchmarks/queens-languages.mjs > benchmarks/queens-languages-fused-results.json
```

Set `SAMPLES`, `PYTHON` or `RUBY` to override the sample count or executable paths. Node runs the TypeScript file with its built-in type stripping.

## Algorithms

- **Permutations:** enumerate all 40,320 permutations, require eight distinct values in `Q + Rows`, then check `Q - Rows`. Keep all accepted rows.
- **Prefixes:** keep full-width state rows. At each depth, combine occupied columns with the two diagonal projections into a blocked-column set. Collect flat parent/column indices, copy the selected parents and fill the next column. The Rank source is the optimized top-level demo.

The TypeScript permutation iterator is a recursive generator. Python uses `itertools.permutations`; Ruby uses `Array#permutation`. The latter two are native standard-library implementations. TypeScript uses `number` for the small exact integer coordinates; Rank uses its integer values. These are comparisons of the supplied implementations at N=8.

## Measurement

Each sample starts a fresh process, runs one warmup, then measures a calibrated batch targeting 200 ms and divides by its iteration count. Rank executes prepared statements from the actual demo files, with board output removed. Parsing, process startup, imports, output and result verification are excluded from all timings. All implementations retain the complete solutions and must return the same 92 placements in the same order as an independent scalar backtracking oracle.

Before integer membership-function fusion, Apple M5 / macOS arm64 five-sample medians were:

| Runtime | Permutations | Prefixes |
| --- | ---: | ---: |
| Rank / Node 24.15.0 | 1070.00 ms | 200.48 ms |
| TypeScript / Node 24.15.0 | 23.94 ms | 1.55 ms |
| Python 3.9.6 | 29.51 ms | 4.36 ms |
| Ruby 2.6.10 | 46.27 ms | 9.52 ms |

Raw samples, iteration counts, runtime versions and Rank source hashes are in [queens-languages-results.json](../queens-languages-results.json).

## Interpreter fusion

The prefix demo now benefits from compiling straight-line integer-vector arithmetic and `concat` into a membership kernel. Intermediate diagonal and concatenated arrays are not constructed. Ranked materialization can prepare that kernel once and reuse it across rows. The optimization guards storage, shapes and capture revisions; unsupported bodies and observable host readers use ordinary execution.

```sh
npx tsc -b tsconfig.build.json
node benchmarks/queens-fusion.mjs > benchmarks/queens-fusion-results.json
```

The same prefix demo and timer, with five fresh-process samples on Apple M5 / Node 24.15.0, give:

| Interpreter mode | Prefixes |
| --- | ---: |
| Both new optimizations disabled | 200.73 ms |
| Function fusion only | 66.56 ms |
| Function and ranked fusion | 31.88 ms |

Ranked rows are cached as private boolean buffers without writable-storage wrappers. This is a 6.30× improvement for this workload. The permutation demo's `unique len` predicate is outside this compiler's supported expressions. These measurements establish speed, not retained or peak memory savings.

Raw samples are in [queens-fusion-results.json](../queens-fusion-results.json). Set `RANK_ARRAY_COMPILATION=false` or `RANK_RANKED_ARRAY_COMPILATION=false` when running `queens-languages.mjs` to disable the corresponding optimization for Rank workers.

A fresh cross-language run of the final implementation gives:

| Runtime | Permutations | Prefixes |
| --- | ---: | ---: |
| Rank | 1047.61 ms | 32.00 ms |
| TypeScript | 24.28 ms | 1.54 ms |
| Python | 29.45 ms | 4.31 ms |
| Ruby | 45.92 ms | 9.52 ms |

See [queens-languages-fused-results.json](../queens-languages-fused-results.json) for all samples and runtime versions.
