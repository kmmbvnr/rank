# Typed native calls in compiled loops

Measured on 2026-09-22 with Node v24.15.0:

```sh
npx tsc -b tsconfig.build.json
node benchmarks/native-loop.mjs
```

Each case and mode runs in a fresh process. After 10,000 warm-up iterations,
the script measures five samples of 100,000 iterations. Both modes enable direct
loop control; only `nativeLoopCompilation` differs. Each result is checked against
a JavaScript oracle computed outside the timed region. MD5 checks use Node crypto
as the oracle, while both Rank modes use the portable builtin. Execution counters
confirm that each compiled-mode invocation entered the compiled region.

| Case | Reference median (ms) | Compiled median (ms) | Speedup |
| --- | ---: | ---: | ---: |
| String construction and prefix rejection | 84.64 | 11.07 | 7.65× |
| UTF-8 bytes, prefix rejection and indexing | 142.00 | 33.21 | 4.28× |
| Unicode character, lowercase and code point | 96.02 | 14.24 | 6.74× |
| Portable MD5, byte prefix and indexed reads | 372.96 | 174.86 | 2.13× |

Five-sample timings in milliseconds:

| Case | Reference | Compiled |
| --- | --- | --- |
| Strings | 92.51, 84.64, 84.28, 84.94, 83.90 | 16.06, 11.44, 10.74, 10.86, 11.07 |
| Bytes | 151.83, 140.28, 142.84, 140.77, 142.00 | 35.96, 33.21, 33.12, 33.15, 34.67 |
| Unicode | 101.06, 96.34, 94.36, 96.02, 93.00 | 20.78, 14.24, 14.52, 14.09, 14.24 |
| Portable MD5 | 370.37, 373.58, 373.78, 362.89, 372.96 | 173.82, 175.75, 175.17, 174.86, 173.70 |

These are workload measurements, not a speedup claim for every program. Native
calls retain their existing implementations; the generated loop removes repeated
expression dispatch and uses typed registers. Bytes stay in their compact buffer
representation through prefix tests and indexed reads.

At the time of these measurements, the Node MD5 host callback was excluded.
The subsequent `pureHostFunction` contract permits the trusted Node implementation;
unannotated callbacks still retain the general loop path. This benchmark does not
measure either complete AoC password search. Use `aoc-chess.mjs` for that comparison.
