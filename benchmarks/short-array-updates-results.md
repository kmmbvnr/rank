# Short stored arrays and modular subset counts

Issue: [#335](https://github.com/kmmbvnr/rank/issues/335).

Measured on 2026-10-19, Apple M5, Node v24.15.0. The workload performs
250250 updates of 250 integer cells modulo `10^16`. Every run checks the
answer `1425480602091519`, every cell's range/type, and the independent total
count `2^N mod 10^16`.

The issue's original array update, including its explicit `copy`, completed
in **13.711 / 15.229 / 15.032 seconds**. All three observations meet the
20-second criterion. This is an interpreter measurement, not a timing assertion
in CI. Other machine workloads were not stopped; these are local observations,
not portable latency guarantees.

## Full workload

Each sample is a fresh child process. Three samples per default mode run
serially, reversing the mode order on alternate trials. No tests or builds from
this task run concurrently with the measured series.

| Mode | Samples | Operation median | Cold median | Maximum RSS | GC median |
| --- | ---: | ---: | ---: | ---: | ---: |
| Array with `copy` | 3 | 15.032 s | 15.601 s | 516.7 MiB | 3.337 s |
| Array without `copy` | 3 | 26.807 s | 27.335 s | 991.7 MiB | 7.064 s |
| Scalar loops | 3 | 10.912 s | 11.438 s | 167.7 MiB | 0.037 s |
| Array without `copy`, compilation disabled, 256 MiB old-space limit | 1 | 21.583 s | 22.157 s | 424.3 MiB | 5.751 s |

Operation time includes parsing/executing the update loop and demanding its
complete final array. It excludes imports and initial counter setup. Cold time
also includes process startup, imports, setup, answer checks and disposal.
RSS covers the whole process, including startup and non-heap memory; the
256 MiB flag limits V8 old space, not total RSS. GC entries are filtered to the
operation interval. CPU time, heap use after computation, program hashes and
individual observations are retained in the raw data.

The constrained run validates the full workload without `copy` or compilation
under a heap limit far below the reported 4 GiB failure. Default V8 settings can
still allow substantial transient heap/RSS growth before collection; avoiding
the retained expression chain does not mean minimal allocation or RSS. The
no-copy form is still slower than the explicit-copy fused form.

## Baseline context

The baseline runtime is commit `fba5bf74`, whose source tree is identical to
GitHub main `d385b5e1` before this work. Separate three-sample 2500-step smoke
series measured these operation medians:

| Mode | Baseline | Candidate |
| --- | ---: | ---: |
| Array with `copy` | 1378.980 ms | 311.049 ms |
| Scalar loops | 123.546 ms | 157.907 ms |

These short measurements include compilation/warmup and should not be
extrapolated to the full workload. They show no small-scalar speedup. One
additional unchanged baseline scalar run at the full size took 14.477 s and
returned the same answer; it is a single observation, not a controlled scalar
speedup comparison. The old full-size array timing was not remeasured here.

## Implementation and limits

Trusted regular integer storage and concat segments can use checked eager
arithmetic, producing fresh owned arrays. Irregular gathers keep their existing
live-until-write behavior. The tensor compiler can fuse concat, arithmetic and
exact integer `mod`/`//` into an explicit-copy or reduction terminal. Its bounded
layout cache retains code, not old operand buffers. Checked stored views preserve
their binding and observed-cell validation.

The ordinary stored-integer path bounds this recurrence even with compilation
disabled. Other unmaterialized arrays are limited to 8192 reader layers and raise
`ResourceLimit` with a `copy` suggestion rather than growing indefinitely.
Metadata-only concat dependency nodes do not add reader layers. Existing 5000-layer
read/cancellation tests and 10000-element concat tests remain supported.

`powmod` now maps scalar/array operands in all three positions using ordinary
broadcasting and the existing exact scalar body. Invalid cells remain lazy;
sequences are not implicitly materialized.

## Reproduction and provenance

```sh
npm run langium:generate
npx tsc -b tsconfig.build.json
node benchmarks/short-array-updates.mjs
node benchmarks/short-array-updates.mjs --trials=1 --modes=array --compiled=false --heap=256
```

Use `--n=2500 --modes=array-copy,scalar` for the smoke series and
`--runtime=/absolute/path/to/baseline/packages/interpreter/out/index.js` for
an already-built baseline. The script does not rebuild another worktree.

Measured runtime commit: `ba0b7a5d`. The final validation/report commit changes
no production source from that measurement. The JSONL `commit` field identifies
the driver checkout; the manifest identifies the runtime used by each series.

- [Manifest and source provenance](baselines/2026-10-19-short-array-updates-manifest.json)
- [Full candidate series](baselines/2026-10-19-short-array-updates-full.jsonl)
- [Constrained memory run](baselines/2026-10-19-short-array-updates-bounded.jsonl)
- [Baseline smoke series](baselines/2026-10-19-short-array-updates-baseline-small.jsonl)
- [Candidate smoke series](baselines/2026-10-19-short-array-updates-candidate-small.jsonl)
- [Single full baseline scalar run](baselines/2026-10-19-short-array-updates-baseline-scalar.jsonl)
