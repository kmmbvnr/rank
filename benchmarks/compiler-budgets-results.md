# Proof and specialization budgets: coverage and performance

Workstream 10 of #565. Baseline `c32b6061`; measured implementation `92f60bea`.
The delivered runtime at `da239f46` is identical to that measured implementation.
Node v24.15.0, arm64 Mac and x64 Intel. Raw samples, the collection-controlled
follow-up and a rejected optimization are in `compiler-budgets-results.json`.

## Scope and protocol

Large function and loop bodies retain lazy generated fragments. The region
budget stays 256 statements; fragments contain at most 64 statements and retain
at most 16 generated parts per body. A shared checked tail handles the rest.
Function-body and scalar-proof caches retain at most 32 signatures per source
(the latter per proof mode). Language contract state is deliberately independent
of those code caches. Call-graph limits remain depth 16 and 64 expanded calls.
High-rank copies use bounded generated axis loops, with ordinary copying for
cells smaller than 32 elements. These are bounds on specific compiler structures,
not a constant-memory guarantee for arbitrary programs, inputs or language contracts.

`compiler-budgets.mjs` checks every result against interpretation. Each process
parses once, records eight fresh-interpreter samples and twelve samples reusing
one interpreter. Startup, parsing, reference execution and interpreter construction
are outside timers. Fresh times include preparation, execution and disposal;
process caches and parsed syntax are shared. Prepared times are repeated program
execution, not a promise that no lazy preparation occurs. Output uses a no-op
host callback. Scalar-entry compilation is enabled for `chain` and disabled for
other cases to expose lower-tier composition; matrix tests also use default settings.

Six alternating independent process pairs per case and host, 100 iterations.
Discard the first three samples and take each process median. Ratios are paired
geometric means with 95% bootstrap intervals over process pairs (10,000 draws,
seed 565). The Mac polymorphic case was collected in a separate six-pair session.
Tests did not run concurrently on a measured host; other system load is uncontrolled.

| Case | Work | Intended path |
| --- | --- | --- |
| small | Eight scalar updates in a helper | Existing small framed body control |
| large | 300 scalar updates per call | Lazy generated fragments |
| retained | 1,100 scalar updates per call | Sixteen retained fragments plus checked tail |
| chain | 24 non-tail helpers, declared leaf-first | Bounded scalar proof and checked/framed calls |
| rank | Rank-18 tensor, two-element cells | Ordinary tiny-cell copy cost choice |
| rank-large | Rank-18 tensor, 64-element cells | Generated generic axis copy |
| unique | Scalar Number accumulation | Existing specialized loop control |
| polymorphic | Forty argument ranks, 4,000 calls | Shared body after 32 signatures |

Counters count path entries, not whole-program coverage. More compiled entries
do not by themselves establish less work, lower allocation or faster execution.

## Prepared execution and peak memory

Times are milliseconds; ratios below 1 mean less time. Peak RSS is KiB for the
whole process, including reference execution, warmups and diagnostics.

| Host | Case | Before ms | After ms | Ratio [95% interval] | RSS before → after |
| --- | --- | ---: | ---: | --- | ---: |
| mac | small | 2.147 | 2.098 | 0.993 [0.944, 1.056] | 188,480 → 188,536 |
| mac | large | 29.593 | 29.441 | 0.996 [0.897, 1.089] | 276,088 → 279,704 |
| mac | retained | 107.478 | 105.769 | 0.969 [0.924, 1.017] | 336,376 → 341,640 |
| mac | chain | 32.873 | 35.491 | 1.104 [1.028, 1.195] | 310,560 → 309,376 |
| mac | rank | 2.701 | 2.182 | 0.835 [0.732, 1.002] | 183,160 → 183,840 |
| mac | rank-large | 4.452 | 4.727 | 1.114 [0.990, 1.233] | 185,192 → 185,856 |
| mac | unique | 0.065 | 0.067 | 0.997 [0.847, 1.190] | 153,600 → 152,696 |
| mac | polymorphic | 131.557 | 132.335 | 1.017 [0.954, 1.105] | 493,736 → 493,224 |
| intel | small | 3.747 | 3.492 | 0.959 [0.830, 1.108] | 170,402 → 170,832 |
| intel | large | 34.294 | 34.503 | 1.033 [1.003, 1.063] | 270,678 → 267,910 |
| intel | retained | 121.699 | 120.246 | 0.966 [0.936, 0.998] | 322,236 → 329,192 |
| intel | chain | 54.824 | 52.826 | 0.977 [0.919, 1.050] | 285,286 → 288,704 |
| intel | rank | 4.195 | 4.261 | 0.996 [0.966, 1.027] | 164,810 → 165,398 |
| intel | rank-large | 7.714 | 7.823 | 1.015 [0.957, 1.083] | 167,784 → 169,048 |
| intel | unique | 0.087 | 0.084 | 1.029 [0.924, 1.150] | 136,074 → 135,446 |
| intel | polymorphic | 220.770 | 214.162 | 0.977 [0.968, 0.987] | 472,900 → 473,164 |
| mac-chain-gc | chain | 34.169 | 33.879 | 0.979 [0.945, 1.018] | 249,608 → 250,088 |

## Fresh execution including preparation

Times are milliseconds; ratios below 1 mean less time. Peak RSS is KiB for the
whole process, including reference execution, warmups and diagnostics.

| Host | Case | Before ms | After ms | Ratio [95% interval] | RSS before → after |
| --- | --- | ---: | ---: | --- | ---: |
| mac | small | 4.715 | 4.238 | 0.912 [0.843, 1.034] | 188,480 → 188,536 |
| mac | large | 40.802 | 42.546 | 0.990 [0.908, 1.062] | 276,088 → 279,704 |
| mac | retained | 132.285 | 135.866 | 1.020 [0.960, 1.068] | 336,376 → 341,640 |
| mac | chain | 45.906 | 44.841 | 1.023 [0.912, 1.196] | 310,560 → 309,376 |
| mac | rank | 3.987 | 3.832 | 0.961 [0.875, 1.057] | 183,160 → 183,840 |
| mac | rank-large | 8.522 | 6.942 | 0.850 [0.772, 0.932] | 185,192 → 185,856 |
| mac | unique | 0.938 | 0.816 | 0.953 [0.863, 1.049] | 153,600 → 152,696 |
| mac | polymorphic | 150.556 | 150.074 | 0.993 [0.927, 1.066] | 493,736 → 493,224 |
| intel | small | 7.304 | 8.330 | 1.044 [0.958, 1.133] | 170,402 → 170,832 |
| intel | large | 49.564 | 51.010 | 1.043 [0.987, 1.111] | 270,678 → 267,910 |
| intel | retained | 162.470 | 169.040 | 1.003 [0.968, 1.039] | 322,236 → 329,192 |
| intel | chain | 70.434 | 67.923 | 0.986 [0.909, 1.074] | 285,286 → 288,704 |
| intel | rank | 7.335 | 6.874 | 0.983 [0.889, 1.088] | 164,810 → 165,398 |
| intel | rank-large | 12.030 | 11.315 | 0.949 [0.841, 1.069] | 167,784 → 169,048 |
| intel | unique | 1.133 | 1.116 | 1.014 [0.915, 1.111] | 136,074 → 135,446 |
| intel | polymorphic | 249.829 | 242.573 | 0.976 [0.947, 1.005] | 472,900 → 473,164 |
| mac-chain-gc | chain | 38.689 | 38.394 | 0.994 [0.971, 1.015] | 249,608 → 250,088 |

## Interpretation and investigated regressions

The result is broader bounded compilation, not a universal speedup or a measured
reduction in process memory. Most intervals include 1. Intel prepared `retained`
and `polymorphic` improve slightly. Retaining fragments adds modest memory in
some cases: `retained` peak RSS rises about 1.6% on Mac and 2.2% on Intel.
The tests establish cache bounds and no repeated fragment generation; peak RSS
does not isolate retained compiler memory or allocation rate.

Intel prepared `large` is 3.3% slower [0.3%, 6.3%]. This small remaining regression
is accepted explicitly with the broader bounded execution path. Initial generated
per-statement continuation calls caused a larger Mac regression (about 17% against
an older baseline); the delivered implementation uses one fallthrough switch per
straight-line fragment. We also tried removing synchronous completion wrappers
by inlining statement dispatch into every case (`e85e2dc7`). Against `c32b6061`,
that version made Mac `large` prepared execution 18.0% slower [9.4%, 31.1%] and
fresh execution 11.7% slower [5.7%, 22.4%]. Intel prepared execution also slowed
11.0% [8.6%, 14.6%], and fresh execution 15.1% [11.5%, 18.3%]. It was reverted.
Fewer source-level allocations did not improve this generated path. Both hosts' experiment samples are
retained so this rejected approach is not mistaken for a delivered optimization.

Mac prepared `chain` is 10.4% slower [2.8%, 19.5%] in the ordinary collection run.
The compared runs have identical sources exposed by the function-body, block,
scalar and integer-loop compilation hooks (ten sources, 3,863 bytes, SHA-256
`2d7848444f0878618b4f9db8e8ba6cbd04cea9bbac0c7d7c60d42b45df1c6c93`)
and matching observed path counters. This does not inspect every possible backend
source. A six-pair follow-up collecting before each sample gives prepared ratio
0.979 [0.945, 1.018] and fresh ratio 0.994 [0.971, 1.015]. The difference is not
stable across collection regimes; this does not prove GC caused the ordinary-run
penalty. Both observations are retained, and no Mac chain speedup is claimed.

An earlier Intel measurement of generated two-element high-rank copying showed
a penalty. Such tiny cells now retain ordinary copying. The final `rank` Intel
prepared interval includes 1. Generic copying remains selected for larger cells;
its final intervals do not establish a prepared-execution speedup on either host.

Fresh execution includes preparation and execution, not isolated compiler-only
cost. Raw first samples and diagnostic preparation costs are retained, but the
`loop.prepare` counter does not cover all lazy function/fragment preparation and
must not be interpreted as total compilation time. Peak RSS is likewise not live
heap retention or an allocation-rate measurement.

## Validation

- `tsc -b tsconfig.build.json` passed.
- 785 tests passed in 15 focused interpreter files, including 21 budget tests
  and 417 capability-matrix cases. Matrix checks compare traced, untraced and
  interpreted paths, values and errors.
- Boundary tests cover 255/256/257-statement bodies, larger regions, both sides
  of call-depth limits, expanded calls, exhausted text/function/proof variants,
  bounded fragment generation, branch callouts, cancellation, generator resume,
  unreachable effects, exact wide integers and return contracts after fallback.
- Tensor tests cover rank 16/17/64/256, resized cells, getter order, interruption
  and the tiny-cell cost guard.
- 13 focused CLI diagnostics tests passed, including exact limit and alternative.
- Full root tests and exhaustive audits were not run; they remain CI work.

Reproduce with `array-ownership-compare.py --harness compiler-budgets.mjs`, the
built baseline and implementation paths, `--iterations 100 --repeats 6 --cases
small large retained chain rank rank-large unique polymorphic`. Use `--gc --cases
chain` for the collection-controlled follow-up. `array-ownership-summary.py`
reads the combined JSON and regenerates the tables' statistics.
