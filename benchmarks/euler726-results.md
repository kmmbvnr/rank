# Euler 726: shared modular scan speedup

Issue [#537](https://github.com/kmmbvnr/rank/issues/537) requests a several-fold
speedup of the default `726_fallingbottles.ra` program, preserving its answer
and identifying the dominant array operation.

The [compiler change for #536](https://github.com/kmmbvnr/rank/commit/ce2a05a4)
already covers this program. No further interpreter or compiler edits were
needed. The Rank source and its algorithm are unchanged. This task adds an
independent correctness oracle, a full-scale regression and measurements on
both architectures. The full answer is `578040951`.

## Profile

The dominant operation was `Facts = (1 to Top) scan mulp`, where
`Top = 50005000` and `fun A mulp B = A * B mod Prime`. In the full Mac baseline,
this factorial stage took 21.40 of 21.54 seconds. The complete current program
runs in about half a second.

The baseline profile at 3000 layers recorded 289 of 1386 self-time samples in
`scalarCaptureKey` and 402 in `function-invocation.js`. Each prefix element
repeated capture-type selection and scalar callback dispatch. The existing
compiler recognizes the pure modular callback and completes the finite range
in a native loop, using exact modular multiplication and one private Int32
prefix buffer. This removes dispatch for about fifty million elements and
reduces the retained factorial storage from eight to four bytes per cell.

The current full-size diagnostic run records one `modularCallbackScans`
execution. CPU summaries and raw diagnostic runs are retained beside the timing
data. The before/after profiles use different bounds, so their sample counts
are evidence of the execution path rather than a timing comparison.

## Measurements

Baseline: `d33e7a59`, before the shared callback-scan optimization. Current:
`fa79cd79`, which contains `ce2a05a4`. Verification commits for #537 change no
runtime code. Both versions run the same Rank source at 10000 layers.

Node v24.15.0 ran on Mac arm64 and Intel x64 (`jack.lan`). All 470 interpreter
and language runtime JavaScript files matched across hosts. Intel used the
same built JavaScript with its isolated package links. There was one fresh
baseline process and three fresh current processes per host. Diagnostics and
profiling were disabled for timing; no other test or benchmark from this task
ran concurrently on the measured host. A single baseline does not estimate
baseline variance.

| Host | Baseline, s | Current median, s | Current range, s | Speedup | Baseline RSS, MiB | Current median RSS, MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Mac arm64 | 21.535 | 0.487 | 0.485–0.487 | 44.20x | 2401 | 366 |
| Intel x64 | 58.365 | 0.907 | 0.906–0.950 | 64.34x | 2583 | 350 |

All eight full-size runs returned `578040951`. Peak process RSS fell by about
85% on the Mac and 86% on Intel. These figures include parsing, setup and the
retained factorial array.

No additional control benchmark was needed for #537 because this task changes
only tests, benchmark tooling and the corpus-exclusion explanation. Runtime
control measurements for the shared compiler change are in
[euler720-results.md](euler720-results.md).

## Correctness checks

The new oracle explicitly enumerates bottle removals and every possible
collapse through five layers. It memoizes occupied-cell states while retaining
the multiplicity of different collapse paths. It does not use the hook formula
or the Rank program's prefix-product recurrence. Counts agree with every
computed term modulo 101 and modulo 1000000033.

The [statement examples](https://projecteuler.net/problem=726), `f(1) = 1`,
`f(2) = 6`, and `f(3) = 1008`, also pass. Compiled and reference runs agree
through 100 layers. The new full-scale test asserts `578040951` and requires
one native modular callback scan.

All 43 focused Euler/modular-scan checks pass, as do the full default Euler 720
and Euler 726 tests. TypeScript build, the semantic-boundary package checks
(11 tests and 65 owners), and `git diff --check` pass. No exhaustive audits or
full `npm test` were run.

The general demo/corpus exclusion remains because reference execution still
allocates a large factorial prefix and performs about fifty million callbacks.
Its old compiled-time estimate was replaced with the full-scale test pointer.

## Reproduction

```sh
npm run langium:generate
node node_modules/typescript/bin/tsc -b tsconfig.build.json
node benchmarks/euler726.mjs
node benchmarks/euler726.mjs 3 reference
```

Use checkout-local `@arrrank/*` links. `RANK_ROOT` selects a built runtime;
`RANK_SOURCE` selects a source variant. `DIAGNOSTICS=1` and `PROFILE=path` enable
investigation modes. Raw timing files and profile summaries are in
`benchmarks/results/euler726/`.
