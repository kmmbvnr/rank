# Euler 729: read packed choose masks directly

Issue [#538](https://github.com/kmmbvnr/rank/issues/538) requests a several-fold
speedup of `729_periodicrange.ra`, preserving the default answer and profiling
the dominant array operation. The Rank program and its numerical algorithm are
unchanged. The full answer remains `308896374.2502` for 2807194 Lyndon words.

## Profile and change

The full baseline spent 181.56 of 188.12 seconds in Newton updates. A CPU profile
at period 20 attributed 2135 of 3844 self-time samples to `chooseDenseArrays`.
The condition was already a packed native Boolean array, but each element went
through its indexed ArrayLike compatibility Proxy. This repeatedly converted
numeric indices to property keys before reading the same bitmap.

`chooseDenseArrays` now borrows the native bitmap alongside its existing stored
facade when the condition has the complete output shape. The existing
`BooleanCells.read` method supplies each Boolean directly. The loop retains its
type check, branch reads and output allocation.

The shortcut requires owned storage, an ordinary object prototype, no custom
`itemAt` property and a bitmap length matching the output cell count. It is
captured during the original operand-preparation pass, before branch broadcasts.
There is no additional shape read, no retained result cache and no expanded
mask buffer. Broadcast, missing, unread and opaque conditions keep their
existing paths. The before/after period-20 profiles record 2135 and 114 samples
in `chooseDenseArrays`; summaries and diagnostics are retained with the data.

The change affects the interpreter's dense selection path. Whole-loop
compilation and floating-point operation order are unchanged by this patch.

## Mac measurements

Node v24.15.0, Mac arm64, fresh processes at the default period 25. Baseline:
`c021d70d`, one sample. Patch: `e5e5c88f`, three samples. Profiling and diagnostics
were disabled for these timings; no other test or benchmark from this task ran
concurrently. A single baseline does not estimate baseline variance.

| Version | Time, s | Peak RSS, MiB |
| --- | ---: | ---: |
| Baseline | 188.120 | 1099 |
| Patch median, three processes | 55.806 | 1030 |
| After integration of main `51ef33ba`, one process | 55.046 | 1054 |

The patch series ranged from 55.26 to 58.14 seconds, a 3.37x ratio of baseline
to median. Peak RSS ranged from 806 to 1054 MiB; it did not exceed the measured
baseline. GC timing affects these peaks, so this is not a fixed memory bound.
The final integration check gives a 3.42x speedup and the same answer.
All five recorded default timing runs returned `308896374.2502`.

Intel verification could not run. SSH to `root@jack.lan` timed out during banner
exchange at 192.168.1.68:22; the external route `root@viewflow.io:22022` also
timed out. No Intel performance claim is made.

## Control workload

Euler 726 is an unrelated control that does not execute `choose`. Its three
paired fresh-process samples were noisy: baseline 0.534–0.707 seconds, median
0.690; candidate 0.559–0.733 seconds, median 0.729. These cold-process data alone
do not establish unchanged startup cost.

A warm control imports both runtimes into one process, warms each once, forces
GC before each sample and alternates execution order. Six samples per version
after main integration gave wall medians of 377.99 and 377.11 ms, and CPU
medians of 435.21 and 430.11 ms. All answers matched `578040951`. This check
shows no material change in the warmed workload; it does not prove identical
cold-start costs. The driver is `experiments/euler729-control.mjs`.

An import-order experiment did not stabilize the cold control and was reverted.
Its samples remain under `rejected-import-order-control-*` for traceability.

## Correctness and validation

All 443 selected tests across 17 files pass after integration, covering choose,
Boolean masks, array kernels, snapshots, vector loops and the newly merged
numerical helpers. The full default Euler 729 test passes; the final integrated
runtime also passes the default benchmark assertion. TypeScript build,
semantic-boundary checks (11 tests and 65 owners), and `git diff --check` pass.
No exhaustive audits or full `npm test` were run.

The new choice tests compare packed masks against a plain-mask compatibility
path at bitmap tails and chunk boundaries. They cover broadcasting, exact wide
integers, mixed-domain errors, signed zero, NaN/infinities, independent output
storage, unread branch readers, missing masks, inconsistent shapes and budgets.

The independent Euler oracle enumerates all primitive binary words, including
every rotation, and finds inverse-composition fixed points by bisection. It
uses neither Lyndon generation nor Newton updates. It agrees through period 8;
compiled and reference runs also agree at dense-path periods 14 and 16. The
[published examples](https://projecteuler.net/problem=729) for periods 2, 3 and 5
pass. The demo's general differential exclusion remains because reference
execution is expensive; its compiled full-scale test is now explicit.

## Reproduction

```sh
npm run langium:generate
node node_modules/typescript/bin/tsc -b tsconfig.build.json
node benchmarks/euler729.mjs
node benchmarks/euler729.mjs 5 reference
```

Use checkout-local `@arrrank/*` links. `RANK_ROOT` selects a built runtime and
`RANK_SOURCE` selects a source variant. `DIAGNOSTICS=1` and `PROFILE=path` enable
investigation modes. Raw data are in `benchmarks/results/euler729/`.
