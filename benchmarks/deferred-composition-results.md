# Deferred composition: coverage, demand cost and memory

Workstream 8 of #565. Baseline `3ffe11fdb8c39590502e69794a3891222f09c54a`;
measured implementation `2e36f9e357bc9bbec2cd3d3e7dff167374c23b2b`.
Both include the same main changes through Euler 590. Node v24.15.0 on
arm64 Mac and the x64 Intel benchmark host.

## Scope and protocol

The implementation adds exact scalar loop bindings that retain plans, checked
demand at reads, and deferred return propagation. More general deferred bodies
use the existing generated framed-function/value-block control with checked
callouts. Completed plan demands use a bounded synchronous path; a real
suspension hands back to the execution driver without replaying work.

`deferred-composition.mjs` checks every execution against interpretation.
It parses once, runs 8 fresh-interpreter samples and 12 samples reusing one
interpreter, then collects diagnostics separately. Parsing, startup, reference
execution and Interpreter construction are outside the timers. Disposal and
result checking are inside the fresh timer. Parsed syntax and process caches
are shared. The first fresh execution is after the reference run; it is not
cold process startup. Scalar-entry compilation is disabled to expose lower-tier
composition paths. The default direct array-function path is checked separately
in the capability matrix; these timings do not claim default-mode speedups for
every program.

Six independent process pairs per case and host alternate revision order.
No tests run concurrently on the measured host; other system load is not
controlled. Each process contributes the median after dropping the first three
samples. Ratios are paired geometric means. Bootstrap intervals resample whole
process pairs, not individual correlated warm samples (10,000 draws, seed 565).
These are observations of these workloads, not universal performance bounds.

Each case performs 1,000 iterations:

- `scalar`: bind `Value' = I * 2`, then demand it in an accumulation.
- `rebind`: demand one recipe, replace it with another and accumulate both.
- `helper`: pass a plan to a helper with a deferred parameter.
- `escape`: return two composed local scalar recipes through a helper.
- `array`: return a deferred four-cell array expression and reduce it.
- `unique`: unchanged Number-loop scalar arithmetic without any plans.

## Execution paths

| Case | Baseline | Candidate |
| --- | --- | --- |
| scalar, rebind | interpreted loop | one exact compiled loop |
| helper | interpreted loop body | 1,000 generated value-block executions |
| escape | interpreted loop/function bodies | 1,000 value-block and framed-function executions |
| array | 1,000 framed-function executions | same function path plus 1,000 value-block executions |
| unique | one Number loop | same Number loop |

These counters identify entry paths, not whole-program compiled percentages.
Boxed control does not imply that every delegated operation became a numeric
kernel. COW copies and copied cells remain zero in all six cases.

## Prepared execution and ordinary-GC peak memory

Times are milliseconds; ratio below 1 means less time. Peak RSS covers the
entire process, including reference execution, warmups and diagnostics.

| Host | Case | Before ms | After ms | Paired ratio [95% interval] | Peak RSS KiB before → after |
| --- | --- | ---: | ---: | --- | ---: |
| mac | scalar | 8.940 | 5.862 | 0.630 [0.471, 0.801] | 250,960 → 245,520 |
| mac | rebind | 19.677 | 11.627 | 0.566 [0.453, 0.687] | 303,536 → 278,264 |
| mac | helper | 26.350 | 21.039 | 0.735 [0.639, 0.832] | 347,368 → 335,928 |
| mac | escape | 37.515 | 34.989 | 0.911 [0.855, 0.968] | 438,448 → 384,752 |
| mac | array | 106.782 | 100.185 | 0.923 [0.850, 0.993] | 530,016 → 511,696 |
| mac | unique | 0.067 | 0.073 | 1.011 [0.821, 1.216] | 151,512 → 147,560 |
| intel | scalar | 16.228 | 7.473 | 0.461 [0.417, 0.521] | 228,114 → 224,404 |
| intel | rebind | 22.289 | 10.295 | 0.431 [0.392, 0.467] | 285,952 → 259,052 |
| intel | helper | 33.233 | 29.150 | 0.866 [0.757, 0.972] | 334,834 → 325,826 |
| intel | escape | 53.573 | 48.943 | 0.878 [0.803, 0.935] | 409,400 → 366,788 |
| intel | array | 160.207 | 153.220 | 0.975 [0.940, 1.013] | 479,474 → 481,944 |
| intel | unique | 0.085 | 0.077 | 0.927 [0.793, 1.085] | 138,388 → 136,096 |

Simple deferred loops and rebinding improve on both hosts. Helpers and escaped
scalar plans also improve in these runs. The Intel array interval includes 1,
so its small timing difference is unresolved. The unchanged Number-loop control
also has intervals spanning 1 on both hosts; its sub-millisecond times are
particularly sensitive to noise. Median absolute times and paired ratios differ
because the latter preserve the before/after pairing.

An initial Mac experiment before the synchronous-demand change showed slower
escaped-plan and array examples. Profiling found execution-driver work and GC
among the costs. Rather than count added framed entries as a performance win,
the implementation now consumes completed demands without unnecessary driver
frames. The final results above include that change. This does not attribute
all time savings to one profile sample or claim that every lazy program is faster.

## Fresh execution and preparation cost

Warm fresh executions include program preparation with shared process caches.
The first fresh sample still includes first-use compiler/JIT costs after the
reference run. The separate instrumented `loop.prepare` timer measures loop
preparation only, not all function compilation. None of these columns is an
isolated uninstrumented whole-program compiler timer.

| Host | Case | Warm fresh ms before → after | First fresh ms before → after | Diagnostic loop.prepare ms before → after |
| --- | --- | ---: | ---: | ---: |
| mac | scalar | 14.557 → 8.902 | 33.205 → 24.715 | 0.426 → 0.487 |
| mac | rebind | 28.410 → 18.029 | 49.735 → 38.535 | 0.458 → 0.679 |
| mac | helper | 29.454 → 29.296 | 57.441 → 56.830 | 0.410 → 0.593 |
| mac | escape | 49.401 → 42.913 | 64.871 → 83.496 | 0.381 → 0.502 |
| mac | array | 127.024 → 131.570 | 208.807 → 198.876 | 0.316 → 0.549 |
| mac | unique | 0.943 → 0.981 | 16.851 → 17.401 | 0.497 → 0.453 |
| intel | scalar | 17.695 → 8.838 | 39.375 → 28.368 | 0.397 → 0.569 |
| intel | rebind | 33.791 → 18.154 | 57.148 → 37.989 | 0.450 → 0.647 |
| intel | helper | 46.644 → 38.240 | 65.933 → 69.116 | 0.384 → 0.673 |
| intel | escape | 64.472 → 59.096 | 95.969 → 103.984 | 0.427 → 0.572 |
| intel | array | 204.978 → 194.472 | 300.777 → 304.868 | 0.324 → 0.522 |
| intel | unique | 1.119 → 1.110 | 15.951 → 16.195 | 0.521 → 0.543 |

## Separate retained-memory check

Three alternating process pairs for escape/array collect GC before each sample
and after diagnostics. Their timings are not mixed with ordinary-GC results.

| Host | Case | Peak RSS KiB before → after | Retained heap bytes before → after | Retained arrayBuffers bytes before → after |
| --- | --- | ---: | ---: | ---: |
| mac-gc | escape | 234,496 → 231,072 | 34,196,328 → 34,559,576 | 31,555 → 31,555 |
| mac-gc | array | 298,640 → 294,768 | 38,227,896 → 38,433,224 | 31,555 → 31,555 |
| intel-gc | escape | 218,656 → 216,532 | 34,176,176 → 34,563,048 | 31,555 → 31,555 |
| intel-gc | array | 283,068 → 282,764 | 38,233,376 → 38,439,256 | 31,555 → 31,555 |

Retained array-buffer bytes are unchanged in these experiments. Retained heap
increases by roughly 0.2–0.4 MB; generated code, retained preparation state and
runtime bookkeeping are included. Lower ordinary-GC RSS is not proof of lower
live data size or absence of leaks in arbitrary programs.

## Validation and remaining boundaries

- TypeScript build and all 12 CLI diagnostic checks pass.
- The expanded 36-file interpreter run has 1,396 passes and one failure also
  reproduced on clean baseline `3ffe11fd`: `plan-tensor-terminals.test.ts`
  expects zero native entries for a real comparison with integer threshold 0,
  but observes one. It was not weakened to hide the baseline mismatch.
- The capability matrix passes all 411 checks, including seven new deferred
  rows and parity of traced/untraced framed-function and value-block counters.
- The final focused composition file passes all 27 tests, including capture
  rebinding and demand-time rejection of an established result-type change.
- Focused tests cover scalar/real/boolean and wide integer demand, nested plans,
  rebindings, branches, unused failures, construction-time effects, escaped
  environments and array snapshots, return propagation, break/continue,
  cancellation and retry. Protocol tests cover 10,000 validation wrappers and
  suspended continuations without replay. Full/exhaustive audits were not run.
- Deferred capture uses the existing immutable dependency snapshots and binding
  protections. Changing an established result type remains an error; deferred validation
  still follows demand. A return
  does not force a plan, while an ordinary receiving binding completes it.
- Exact registers remain conservative for mixed calls, arrays, containers and
  some compound targets. Generated boxed control preserves the surrounding
  work and ordinary contracts. This does not extend arbitrary higher-order
  numeric lowering, tail-recursion limits or protected/generator boundaries.

## Reproduce

Build each revision separately, then run:

```sh
python3 benchmarks/array-ownership-compare.py \
  --harness benchmarks/deferred-composition.mjs \
  --before /path/to/baseline --after /path/to/candidate \
  --before-revision 3ffe11fd --after-revision 2e36f9e3 \
  --cases scalar rebind helper escape array unique \
  --output /tmp/deferred.json --repeats 6
```

For the separate memory protocol use `--gc --cases escape array --repeats 3`.
On Intel, select `--node /opt/rank-bench-node/bin/node`.
All final samples are in `deferred-composition-results.json`. The shared
summary tool recomputes the paired ratios and intervals:

```sh
python3 benchmarks/array-ownership-summary.py \
  benchmarks/deferred-composition-results.json
```
