# Large compiled bodies: scalar tensor-binding cost

Measured on 2026-11-11. Baseline `6d6b835c`; implementation `168d42ab`.

Large linear bodies are about 2.1–2.7 times faster than the previous compiler
on both measured hosts. This is a runtime routing improvement: compiled framed
fragments remain enabled, but scalar destinations no longer repeatedly bind a
pointwise tensor graph before discovering that there is no output shape.
A CPU profile of the original scalar-update workload attributed 39.1% of samples
(including startup) to tensor-kernel code; that profile is diagnostic evidence,
not the timing comparison below.

The destination is inspected on every execution without forcing deferred values.
Arrays still use the existing tensor candidate, and explicit reductions and copy
terminals are not skipped. Ordinary updates retain mutation/type checks, exact
integers, effects and error locations. Diagnostics report
`tensor:scalar-destination-cost`. Compiler budgets and generated dispatch code
are unchanged.

## Protocol

`large-bodies.mjs` checks every result against interpretation. Each case has six
independent alternating process pairs. Each process parses once, checks a
reference execution, measures eight fresh-interpreter executions and twelve
executions reusing an interpreter, then collects diagnostics outside timing.
The first three samples of each mode are discarded. Tables show median process
medians in milliseconds and the geometric mean of paired after/before ratios;
95% intervals bootstrap the six independent pairs (10,000 draws, seed 565).
A ratio below one is faster. Parsing/imports/interpreter construction are outside
timing; disposal is inside fresh timing. Fresh interpreters share an AST and
process caches, so this is not a cold-start benchmark or isolated compile time.
Output uses a no-op callback. Both hosts use Node v24.15.0; no benchmark runs were
concurrent with tests on that host.

Cases use 100 helper calls: `small` has 8 increments, `large` 300, `retained`
1,100 (beyond 16 retained 64-statement fragments), `arithmetic` 300 modular
multiply/add assignments, `mixed` 100 multiply/subtract/add triples with wide
integers, and `branches` 100 conditional updates. `arrays` is a control with
300 updates of a 4,096-element array and two helper calls.

## Previous compiler versus updated compiler

### mac-compiled

| Case | Mode | Before ms | After ms | Ratio [95% interval] |
| --- | --- | ---: | ---: | ---: |
| small | fresh | 1.970 | 1.346 | 0.690 [0.680, 0.698] |
| small | prepared | 1.169 | 1.043 | 0.881 [0.865, 0.897] |
| large | fresh | 15.842 | 8.129 | 0.516 [0.507, 0.524] |
| large | prepared | 11.581 | 5.138 | 0.445 [0.435, 0.456] |
| retained | fresh | 53.797 | 27.871 | 0.514 [0.507, 0.521] |
| retained | prepared | 41.426 | 19.335 | 0.467 [0.459, 0.475] |
| arithmetic | fresh | 30.259 | 16.588 | 0.549 [0.536, 0.562] |
| arithmetic | prepared | 20.811 | 7.832 | 0.375 [0.369, 0.380] |
| mixed | fresh | 18.056 | 8.911 | 0.490 [0.477, 0.501] |
| mixed | prepared | 13.933 | 5.995 | 0.432 [0.423, 0.443] |
| branches | fresh | 35.794 | 33.052 | 0.926 [0.917, 0.933] |
| branches | prepared | 7.377 | 4.401 | 0.600 [0.592, 0.611] |
| arrays | fresh | 9.541 | 9.639 | 1.015 [1.004, 1.026] |
| arrays | prepared | 5.479 | 5.472 | 0.993 [0.981, 1.006] |

### intel-compiled

| Case | Mode | Before ms | After ms | Ratio [95% interval] |
| --- | --- | ---: | ---: | ---: |
| small | fresh | 6.373 | 4.564 | 0.713 [0.669, 0.758] |
| small | prepared | 3.386 | 3.181 | 0.929 [0.894, 0.966] |
| large | fresh | 43.623 | 23.696 | 0.542 [0.526, 0.559] |
| large | prepared | 31.230 | 14.637 | 0.467 [0.450, 0.485] |
| retained | fresh | 137.944 | 73.398 | 0.537 [0.511, 0.568] |
| retained | prepared | 102.541 | 47.962 | 0.474 [0.454, 0.497] |
| arithmetic | fresh | 78.284 | 47.456 | 0.610 [0.592, 0.632] |
| arithmetic | prepared | 52.136 | 21.926 | 0.422 [0.414, 0.429] |
| mixed | fresh | 51.989 | 24.883 | 0.494 [0.476, 0.516] |
| mixed | prepared | 36.931 | 15.479 | 0.426 [0.408, 0.445] |
| branches | fresh | 103.698 | 95.448 | 0.915 [0.900, 0.930] |
| branches | prepared | 20.348 | 13.244 | 0.643 [0.617, 0.662] |
| arrays | fresh | 31.405 | 31.745 | 1.013 [0.979, 1.051] |
| arrays | prepared | 19.145 | 21.038 | 1.081 [0.984, 1.184] |

## Updated compiler versus interpretation

Before is interpretation; after is compilation, both at `168d42ab`.

### mac-reference

| Case | Prepared interpreted ms | Prepared compiled ms | Ratio [95% interval] |
| --- | ---: | ---: | ---: |
| small | 0.930 | 1.067 | 1.118 [1.068, 1.159] |
| large | 4.355 | 5.238 | 1.190 [1.169, 1.212] |
| retained | 15.479 | 19.010 | 1.222 [1.201, 1.243] |
| arithmetic | 9.434 | 7.847 | 0.825 [0.811, 0.838] |
| mixed | 5.062 | 6.111 | 1.215 [1.186, 1.245] |
| branches | 4.394 | 4.456 | 1.018 [1.004, 1.032] |
| arrays | 7.272 | 5.486 | 0.751 [0.732, 0.771] |

### intel-reference

| Case | Prepared interpreted ms | Prepared compiled ms | Ratio [95% interval] |
| --- | ---: | ---: | ---: |
| small | 3.255 | 3.161 | 0.998 [0.944, 1.080] |
| large | 12.179 | 14.024 | 1.184 [1.130, 1.252] |
| retained | 39.232 | 46.469 | 1.174 [1.138, 1.207] |
| arithmetic | 26.772 | 22.580 | 0.831 [0.805, 0.859] |
| mixed | 14.341 | 16.224 | 1.121 [1.087, 1.153] |
| branches | 12.999 | 13.536 | 1.051 [1.000, 1.109] |
| arrays | 21.795 | 18.815 | 0.878 [0.843, 0.920] |

Simple scalar updates still cost about 17–22% more than interpretation in the
large/retained cases. Arithmetic is about 17% faster, and arrays are about
12–25% faster. This change accelerates existing compiled bodies; it does not
establish that compilation wins for every body. Exploratory raw-step results,
loop dispatch, direct dispatch and a diagnostics shortcut did not show a useful
additional win and were reverted before final measurements.

## Memory and array control

RSS is the whole-process high-water mark including reference execution, warmups
and diagnostics. It is not isolated kernel memory. Values below are medians of
six processes, converted from KiB to MiB.

| Run | Case | Before peak RSS MiB | After peak RSS MiB |
| --- | --- | ---: | ---: |
| mac-compiled | small | 182.7 | 180.2 |
| mac-compiled | large | 276.0 | 249.6 |
| mac-compiled | retained | 337.0 | 306.6 |
| mac-compiled | arithmetic | 317.0 | 288.0 |
| mac-compiled | mixed | 274.9 | 266.7 |
| mac-compiled | branches | 269.9 | 269.8 |
| mac-compiled | arrays | 308.6 | 321.2 |
| intel-compiled | small | 168.3 | 166.1 |
| intel-compiled | large | 261.8 | 229.7 |
| intel-compiled | retained | 320.4 | 296.8 |
| intel-compiled | arithmetic | 291.6 | 272.1 |
| intel-compiled | mixed | 260.1 | 251.1 |
| intel-compiled | branches | 261.0 | 263.3 |
| intel-compiled | arrays | 312.6 | 351.8 |
| mac-arrays-gc | arrays | 203.2 | 203.4 |
| intel-arrays-gc | arrays | 187.2 | 187.2 |

Array control with explicit GC before each sample and after diagnostics:

- mac-arrays-gc: prepared ratio 1.002 [0.992, 1.012].
- intel-arrays-gc: prepared ratio 1.016 [0.952, 1.090].

Default array RSS and timing vary with GC scheduling; the initial Intel array
interval includes both no change and a slowdown. The GC follow-up changes the
measurement conditions, so it is separate evidence, not a replacement for the
default run. No array speedup or universal memory reduction is claimed. All raw
samples, memory snapshots, runtime counters and host metadata are retained in
`large-bodies-results.json`.

## Verification and reproduction

The focused interpreter run passed 673 tests across ten files (large-body cost,
compiler budgets, framed functions, effect boundaries, generated composition,
tensor operator catalogue, capability matrix, demand budget, interruption and
scalar kernels). Five tensor/control files passed 68 tests, including the seven
large-body tests also counted in the first run. CLI passed 13 tests. TypeScript
build passed. Exhaustive audits and the full root test suite were not run.

After building each checkout, use:

```sh
python3 benchmarks/array-ownership-compare.py \
  --harness benchmarks/large-bodies.mjs \
  --before /path/to/baseline --after /path/to/implementation \
  --before-revision 6d6b835c --after-revision 168d42ab \
  --cases small large retained arithmetic mixed branches arrays \
  --iterations 100 --repeats 6 --output /tmp/large-bodies.json
```

For interpretation comparison, use `/path/to/implementation#reference` as before.
For the separate GC control, add `--gc --cases arrays`. Summarize the combined
checked-in raw report with `python3 benchmarks/array-ownership-summary.py
benchmarks/large-bodies-results.json`.
