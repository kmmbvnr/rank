# Euler 254: compiled reductions and factorial remainder pruning

The original default returns 8184523820510, but its hot region does not compile
as a whole. Computed integer powers block the publishing backend; array sums,
pointwise array temporaries and a writable local snapshot block other region
variants. The powers table also contains values beyond Number's safe range,
causing repeated read-buffer rejection even for small inputs. The result is
about 1.52 million small compiled-loop invocations surrounded by interpretation.

The mathematical search already uses a useful bound: represent F in factorial
base, enumerate only decimal numbers with the required digit sum, and stop when
the count of nines exceeds the best total length. Keep this search and the full
Top=150 input.

## General compiler changes

- Lower `A sum` over tracked rank-one integer arrays inside both exact and
  private Number loops. Fuse `+`, `-` and `*`, for example `(A * B) sum`, without
  constructing a pointwise temporary. Scalars and singleton vectors broadcast;
  empty reductions have integer zero. Check every Number intermediate and
  replay overflow exactly. Shape checks and scalar evaluation retain their
  original order. Unsupported ranks, reals, missing values, lazy storage,
  array divisions and callable operands retain existing execution paths.
- Lower explicit `A copy` for named dense integer arrays in private Number
  regions, retaining independent storage and the original shape. Ordinary local
  aliases still use the existing fallback; this does not remove the COW guard.
- Include existing array-rank contracts in deferred-write admission. A conflicting
  rank must fall back before private execution, so errors retain their assignment
  location and preceding writes rather than failing during final publication.

Number precision, the 64-cell admission threshold, the probe cap, ordinary `=`
and explicit deferred bindings are unchanged. The `.NA` probe confirmed that
existing storage guards already reject masked inputs; no extra mask guard was
needed or retained.

## Demo changes

Use an ordinary helper for each requested digit sum. Overflow on a large i then
replays that call rather than all earlier search work. Traverse the few decimal
positions needed for the next F using scalar quotients, without a 23-cell
pointwise temporary. Generate decimal powers with multiplication so the same
helper has an exact publishing backend as well as Number execution.

Build one array of canonical digit counts for all 9! remainders, using eight
vector gather/arithmetic stages. Reuse one ten-cell digit buffer and take an
explicit copy only when a new best is found. Decode the full factorial digit
counts only when the cached length can match or beat the best. Preserve the
original lexicographic tie-break and use `(C * Dd) sum` for the digit score.

The search still visits **1,519,534 candidates**, but full digit decompositions
fall from **1,519,534 to 694**. The retained count table has 362,880 entries;
preparation temporaries belong to its helper. An alternative storing lengths,
scores and tie-break keys in three tables was rejected: it used more storage
without improving the compiled result.

## Measurements

Apple M5, macOS arm64, Node 24.15.0. Serial fresh processes, three alternating
samples per row, imports excluded; parsing, preparation, evaluation and diagnostics
included. External host load was uncontrolled; timings differed substantially
between cohorts.
RSS observations are process maxima, not retained-memory measurements.

The same final demo source, changing only the interpreter build:

| runtime | median ms | range ms |
|---|---:|---:|
| parent 8ce578df | 12446.463 | 12317.732–13090.958 |
| compiler changes | 641.647 | 633.972–666.094 |

That is about **19.4x** from the general compiler changes on the same program.
The standalone dot-product control (20,000 reductions of 64 cells) improved from
362.194 ms to 198.487 ms, about **1.8x**. Its source is
[loop-sum-dot.ra](experiments/loop-sum-dot.ra).

The initial, lighter-load cohort measured the original demo at median 39111.940 ms
and a manually scalarized helper at 435.010 ms. Do not combine that cohort with
the final measurements into a precise end-to-end ratio. Manual scalarization
alone also failed to improve reference execution consistently.

One adjacent full-default reference pair after the final compiled/control cohort
measured the original source at **127354.816 ms** and the final source at
**30443.279 ms**. Earlier single observations were 48722.327 ms for the original
and 18828.021 ms for the pruned prototype. The algorithmic change helps reference
execution too; these pairs are not a universal speedup factor under fixed load.

Unchanged compiled controls, three samples each, median milliseconds:

| workload | parent | compiler changes |
|---|---:|---:|
| Euler 250 | 576.099 | 554.401 |
| Euler 251 | 6354.775 | 6308.475 |
| Euler 252 | 4817.351 | 4599.867 |
| Euler 253 | 1519.398 | 1472.435 |

Their ranges overlap; no material control regression was observed.
Raw samples, diagnostics, source snapshots and hashes:
[baseline](baselines/2026-10-29-euler254.json).

## Verification

- Forced TypeScript source and test builds passed. Fresh runtime JavaScript hashes
  match the benchmarked build.
- 23 new regression tests pass; 17 fail on the unchanged parent. Existing focused
  loop/compiler suites pass. The 27 missing-cell tests also pass.
- The ordinary interpreter run plus the corrected temporary checkout's manual
  rerun exercised 9,268 tests: 9,240 passed and the same 28 failure names as the
  parent remained. Initially the temporary checkout lacked the manual directory;
  mounting it and rerunning all 298 manual checks resolved that environment error.
- Independent ascending search over n verifies Top=0..20 in both engines: 42 runs.
- Every one of the 362,880 cache entries matches direct factorial decomposition
  in both engines.
- Both complete fixture blocks pass in both engines: nine program runs, including
  Top=150. The default assertion was retained, and both 254 paths were restored
  to ordinary corpus audits.
- Scoped differential and type audits pass for both files, as do both CLI checks.
  Exhaustive corpus and Nurikabe audits were not run.

After building the chosen checkout, reproduce with:

```sh
node benchmarks/euler254-digitfactorials.mjs
node benchmarks/euler254-digitfactorials.mjs --reference
node benchmarks/euler254-digitfactorials.mjs --fixture
node benchmarks/euler254-digitfactorials.mjs --fixture --reference
node benchmarks/experiments/euler254-oracle.mjs
node benchmarks/experiments/euler254-table-oracle.mjs
node benchmarks/euler254-digitfactorials.mjs --source=benchmarks/experiments/loop-sum-dot.ra --Top=1 --expect=1706880000
```

Use `--runtime=/absolute/path/to/packages/interpreter/out/index.js` to compare
separately built parent and candidate checkouts with the same harness/source.
