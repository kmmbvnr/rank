# Issue #455 scalar mapping measurements

Apple M5, macOS arm64, Node v24.15.0. Baseline: `0e9149cd`.
Each case converts/maps a stored 256 × 256 real matrix and completes the result
with `copy`. The harness checks shape and every cell against a host oracle;
checksums are recorded separately from timing. Three fresh processes, two warmups
and five timed calls per case per process; the table uses the median of process
medians. Baseline and changed checkout were measured sequentially without a
concurrent build or test run. These are local microbenchmarks, not corpus results.

| Expression before `copy` | Before, ms | After, ms |
| --- | ---: | ---: |
| `A real` | TypeError | 2.018 |
| `A real rank 0` | 13.535 | 12.504 |
| `A sin` | 1.745 | 1.038 |
| `A sin rank 0` | 15.963 | 1.114 |
| `A floor` | 2.617 | 2.472 |
| `A ceil` | 1.239 | 1.355 |

Direct `real` is 6.7× faster than the old explicit-rank workaround on this input;
this compares two spellings, since direct conversion previously failed. The
unchanged explicit spelling has no substantial speedup. Reusing scalar batch
hooks makes `sin rank 0` 14.3× faster and direct `sin` 1.7× faster. `floor` is
close to baseline; `ceil` is about 9% slower in this run. No speedup is claimed
for those rounding functions.

The conversion change was checked independently with 18 conversion tests before
the math rank migration. The math migration was then checked with the math,
compiled trigonometry and rank/shape suites. Final validation passed the full
workspace build, 311 focused Vitest tests in 15 files, seven CLI ops tests and
the generated-reference test. The full test suite and long demo corpus were not
run. Static facts for an unknown function parameter remain conservative
(`unknown`); direct calls, aliases and explicit scalar ranks have shape and
element-type checks. K-means runs in both compilation modes.

Reproduce after building both checkouts:

```sh
node benchmarks/scalar-mapping.mjs --root=/path/to/baseline --baseline
node benchmarks/scalar-mapping.mjs
```

Raw timings and checksums are in `before.json` and `after.json`.
