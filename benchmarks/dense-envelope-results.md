# Dense convex-envelope DP (#349)

Euler 314 now produces `132.52756425686314` on Grid 250, rounding to
`132.52756426`. The demo also needed a correctness fix: its initial score
included the vertical boundary, but its initial length was zero. Initializing
`Length 0` from `Ys` restores the Grid 10 result `5.283358681334832` in both
compiled and ordinary execution.

Both benchmark variants execute the corrected candidate source. This keeps
the perimeter fix and its effect on Dinkelbach convergence out of the compiler
comparison. Baseline: `044c33bc`; candidate: `bf41ad55`, including integration
with main's #351 changes. Environment: Apple M5, Node v24.15.0. Two long corpus
audit workers were active during these measurements.

| Workload | Baseline | Candidate | Speedup |
| --- | ---: | ---: | ---: |
| Grid 10, median of 3 fresh processes | 494.85 ms | 205.27 ms | 2.41x |
| Grid 25, median of 3 fresh processes | 2811.23 ms | 351.42 ms | 8.00x |
| 64 x 64 real matrix, 4 update passes, median of 3 | 183.78 ms | 63.05 ms | 2.92x |
| Grid 250, one fresh process | process timeout at 60 s | 35.52 s | not established |

Each sample includes program parsing, compilation, allocation and execution;
the interpreter/parser is initialized before the sample. Oracle checks run
after timing. A separate instrumented Grid 250 run took 32.37 s and produced
the same answer. These observations do not establish a 30-second deadline.

After merging main's #350 (`93e846b7`), a further full verification with the
corpus audit workers stopped took **24.69 s**, producing the same answer.
The CLI test suite was still active. This is one verification sample, not a
latency guarantee.

The Grid 10 and 25 answers are checked against an independent exhaustive DP
that considers every predecessor instead of constructing an envelope. The
matrix case checks its final cell against `47.75`. Every full run asserts the
required eight-decimal Euler answer.

The refactor shares reader storage preparation and bounds checks, while keeping
the storage object live when a write replaces its packed buffer. Matrix readers
accept two scalar indices without allocating an index tuple per cell. Writes
retain their separate ownership and validation path. Real compound stores now
use the receiver's element type, so the envelope query can compile as a region.
Scalar functions support guarded real division/powers and real `floor`, and
loop calls can link real scalar arguments/results. The Number loop backend
remains integer-only.

On Grid 25, diagnostic compiled-loop entries fall from 56,494 to 100. This is
an execution-count observation, separate from the uninstrumented timing samples.
No general memory-saving claim is made; process peak RSS is recorded in the raw
samples, and the full baseline did not finish.

Reproduce after building both checkouts:

```sh
npm run langium:generate
npx tsc -b tsconfig.build.json
node benchmarks/dense-envelope.mjs --baseline=/path/to/baseline --grids=10,25 --trials=3
node benchmarks/dense-envelope.mjs --baseline=/path/to/baseline --micro --trials=3
node benchmarks/dense-envelope.mjs --baseline=/path/to/baseline --grids=250 --trials=1 --timeout=60000
```

Raw samples, revision IDs and source SHA-256:

- [Small grids](baselines/2026-10-21-dense-envelope-small.jsonl)
- [Matrix updates](baselines/2026-10-21-dense-envelope-matrix.jsonl)
- [Full grid](baselines/2026-10-21-dense-envelope-full.jsonl)
- [Full grid after main integration](baselines/2026-10-21-dense-envelope-integration.jsonl)

Verification: the ordinary interpreter suite passed 4,797 tests. The final
reader changes separately passed 42 tests, covering the small Euler result,
real call linking, partial writes, copy-on-write, bounds and host getter timing.
The ordinary common suite passed 412 tests. Language tests passed 1,196 checks
in one run; its parser-memory child hit a 150-second process timeout under
parallel load, then passed alone with its original heap/time limits in 57 s.
Two earlier five-second language timeouts also passed in a focused 32-test run.
After #350 integration, another 114 tests passed, including prime loops,
Number loops, real scalar domains and envelope DP.
TypeScript, application-form and semantic-boundary checks passed. The web
production build and all three web tests passed.

The full corpus audits are incomplete: seven of eight type shards and seven
of eight name shards passed. The remaining workers were stopped during the
full Euler 261 workload (`Limit = 10^10`); the differential corpus stage did
not run. These results are not a clean full-workspace test run.
An additional full CLI run was stopped during its 70-case real-terminal suite;
it is incomplete too.
