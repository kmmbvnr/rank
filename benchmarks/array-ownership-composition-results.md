# Array ownership across calls, aliases and containers

Workstream 7 of #565. Baseline `bcb76db94ec042a1bc3f9c739c674f497b4cf7b1`;
measured implementation `9109c1c5bac49447f8cf7c9ee6e2597917938fb7`.
Both include the same current-main changes. Node v24.15.0, arm64 Mac and
x64 Intel. Runtime changes are in the preceding `18e258bf` commit plus reader
reuse in `9109c1c5`; subsequent report changes do not alter the measured code.

## Protocol

`array-ownership.mjs` parses once, checks against interpretation, then runs
8 fresh-interpreter samples and 12 samples reusing one interpreter. Parsing,
startup and reference execution precede timing. Interpreter creation is outside
the fresh timer; disposal and result checking are inside. Fresh executions
include preparation/compilation but share parsed syntax and process caches.
They are not isolated compiler timings. Scalar-entry compilation is disabled
to observe the loop paths. Diagnostics run separately, outside timed samples.

`array-ownership-compare.py` starts six independent process pairs per case and
host, alternating revision order. No tests run concurrently on these hosts.
System load is otherwise uncontrolled. Each process contributes the median
after discarding its first three fresh/prepared samples. Paired ratios below
are geometric means; 95% bootstrap intervals resample process pairs, not
correlated within-process samples (10,000 draws, seed 565).

Every case performs 1,000 iterations:

- `alias`: return a 1,000-cell argument, retain it, then write two source cells.
- `slice`: retain a returned two-cell range from a 10,000-cell source, then write.
- `fresh`: return a fresh 64-cell array, write it and read its first cell.
- `deque`: queue a 64-cell snapshot before each source write, then pop the first.
- `read`: return and read a two-cell slice without writing the source.
- `unique`: update an unshared 1,000-cell array through the existing fast path.

## Prepared execution

Times are milliseconds. Ratio below 1 means less time.

| Host | Case | Before | After | Paired ratio [95% interval] | Peak RSS KiB before → after |
| --- | --- | ---: | ---: | --- | ---: |
| mac | alias | 8.393 | 5.000 | 0.571 [0.534, 0.603] | 384,592 → 300,064 |
| mac | slice | 18.064 | 8.347 | 0.477 [0.446, 0.513] | 401,000 → 442,088 |
| mac | fresh | 9.313 | 3.581 | 0.381 [0.362, 0.400] | 349,296 → 225,600 |
| mac | deque | 13.597 | 14.262 | 1.044 [1.027, 1.061] | 281,432 → 284,704 |
| mac | read | 8.583 | 6.669 | 0.751 [0.713, 0.785] | 338,800 → 382,912 |
| mac | unique | 0.072 | 0.071 | 1.004 [0.924, 1.087] | 155,456 → 154,768 |
| intel | alias | 40.459 | 21.000 | 0.530 [0.511, 0.553] | 361,722 → 251,372 |
| intel | slice | 59.592 | 48.759 | 0.820 [0.787, 0.855] | 364,212 → 403,106 |
| intel | fresh | 36.629 | 12.320 | 0.340 [0.325, 0.357] | 320,088 → 198,408 |
| intel | deque | 40.585 | 42.850 | 1.054 [1.026, 1.082] | 264,628 → 267,478 |
| intel | read | 33.337 | 29.700 | 0.901 [0.830, 0.975] | 317,924 → 347,742 |
| intel | unique | 0.227 | 0.238 | 1.051 [0.953, 1.159] | 135,224 → 147,180 |

The five composition cases select one compiled exact loop after the change;
the baseline selects none. `unique` selects its existing compiled loop in both.
The `deque` slowdown is reproducible: about 4.4% on Mac and 5.4% on Intel.
It is not dismissed as noise. The publishing path retains checked assignment,
COW and reader refresh overhead. Copy counts are unchanged (64,000 cells).
A separate 10,000-iteration Mac CPU profile is dominated by collection element
type checks, private array copies and GC; it includes reference execution and
therefore does not isolate the incremental cause. Reader reuse avoids rebuilding
accessors when the binding stays the same, but does not eliminate this slowdown.
This is a coverage improvement with an explicit runtime cost for this workload,
not a claim that every newly compiled program becomes faster. The unique-write
control does not establish a statistically resolved runtime change.

## Fresh execution and preparation

The first fresh sample includes cold process/JIT effects. The diagnostic
`loop.prepare` timer comes from a separate instrumented run; it is evidence of
preparation cost, not an uninstrumented compiler-only measurement.

| Host | Case | Warm fresh ms before → after | First fresh ms before → after | Diagnostic loop.prepare ms before → after |
| --- | --- | ---: | ---: | ---: |
| mac | alias | 11.888 → 6.907 | 22.352 → 21.271 | 0.327 → 0.383 |
| mac | slice | 20.265 → 12.117 | 36.567 → 27.134 | 0.322 → 0.374 |
| mac | fresh | 12.764 → 4.505 | 24.093 → 19.545 | 0.390 → 0.521 |
| mac | deque | 15.852 → 16.548 | 22.664 → 25.543 | 0.202 → 0.264 |
| mac | read | 13.821 → 8.699 | 25.198 → 18.940 | 0.311 → 0.322 |
| mac | unique | 0.502 → 0.522 | 8.400 → 8.542 | 0.243 → 0.231 |
| intel | alias | 43.059 → 24.869 | 78.814 → 65.920 | 0.687 → 0.850 |
| intel | slice | 72.679 → 50.388 | 123.612 → 87.833 | 0.663 → 0.868 |
| intel | fresh | 46.533 → 18.406 | 82.996 → 56.784 | 0.927 → 1.318 |
| intel | deque | 46.788 → 51.098 | 65.207 → 73.806 | 0.457 → 0.651 |
| intel | read | 52.561 → 37.565 | 84.473 → 64.455 | 0.760 → 0.713 |
| intel | unique | 1.567 → 1.698 | 19.560 → 19.837 | 0.698 → 0.805 |

## Memory and copies

Default peak RSS rises roughly 10–13% for slice/read on Mac and 9–11% on Intel.
RSS includes imports, reference execution, warmups and diagnostic execution.
It is not isolated workload memory or a count of live Rank values. Faster
execution and changed allocation/collection behavior do not prove lower peak
memory. No general memory-saving claim is warranted.

A separate three-pair experiment collects GC before each sample and after
diagnostics. Its timings are not mixed with the default results:

| Host | Case | Peak RSS KiB before → after | Retained heap bytes before → after | Retained arrayBuffers bytes before → after |
| --- | --- | ---: | ---: | ---: |
| mac-gc | slice | 285,152 → 240,160 | 37,218,376 → 37,339,504 | 231,555 → 231,555 |
| mac-gc | read | 198,352 → 200,096 | 36,150,768 → 36,259,664 | 191,555 → 191,555 |
| intel-gc | slice | 243,816 → 212,520 | 36,807,632 → 37,230,000 | 231,555 → 231,555 |
| intel-gc | read | 182,232 → 185,060 | 36,160,888 → 36,233,808 | 191,555 → 191,555 |

After explicit GC, slice peak RSS falls and retained heap/buffers are close;
read RSS remains slightly higher. These observations do not erase the ordinary
GC peak increase. They distinguish retained data from transient process memory.

COW copies remain necessary for newly retained aliases: `alias` copies
1,000,000 cells, `deque` 64,000, in both revisions. `fresh` and `unique` copy none.
A focused test verifies three retained two-cell slices copy 24 payload bytes
and cause zero full-source COW copies. Physical materializations are newly
recorded as `array.copy`; missing baseline `array.copy` data must not be treated
as zero physical copying. Counters measure cumulative payload, not live memory.

## Validation and boundaries

- TypeScript build and all 12 CLI diagnostic tests pass.
- Final 26-file interpreter run: 986 pass, one failure also reproduced on clean
  baseline `bcb76db9`: imported division-by-zero error location differs between
  compiled and reference execution (`scalar-function-kernel.test.ts`).
- Separately, `compiled-array-arguments.test.ts` has three existing failures on
  both baseline and candidate: queue/stack/deque expected at least eight
  compiled calls but see six. The wrapper declines with
  `scalar-entry:prefer-numeric-loop`; this is not counted as a newly compiled
  alternate path. Tests were not weakened to hide either baseline failure.
- All 56 array-returning-loop tests and 404 capability-matrix tests pass.
  Matrix checks require the selected exact-loop backend and verify diagnostics
  do not change execution counters. Full/exhaustive audits were not run.
- Supported combinations cover returned aliases/fresh arrays/captures, scalar
  and bulk selections, matrix axes, permutations, repeated queue/stack/deque
  extraction, boolean/text/real arrays, duplicate accumulating stores, early
  exits, errors, cancellation, exact wide integers and in-place widening.
- Modular indexed stores, spread selectors, deferred/suspending values and
  opaque effect combinations keep their existing admission limits. This change
  does not claim arbitrary programs or last-use lifetime analysis are complete.

## Reproduce

Build each revision separately, then run:

```sh
python3 benchmarks/array-ownership-compare.py \
  --before /path/to/baseline --after /path/to/candidate \
  --before-revision bcb76db9 --after-revision 9109c1c5 \
  --output /tmp/ownership.json
```

For the separate memory protocol add `--gc --cases slice read --repeats 3`.
Use `--node /opt/rank-bench-node/bin/node` on the Intel benchmark host.
Raw samples for both hosts and protocols are retained in
`array-ownership-composition-results.json`. Recompute this report's ratios with:

```sh
python3 benchmarks/array-ownership-summary.py \
  benchmarks/array-ownership-composition-results.json
```
