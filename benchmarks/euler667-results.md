# Euler 667: stored real axis extrema

Issue: https://github.com/kmmbvnr/rank/issues/501

The current program was already faster than the historical 63 seconds in the
issue. Profiling the unchanged demo found another shared interpreter cost:
`reduce min/max axis 0` used the generic input-cell fold, recomputing coordinates
and invoking the binary builtin for each pair. This accounted for about 46% of
samples in the investigation profile.

The interpreter now folds one axis of a stored Float64 array directly. It
supports arbitrary axis positions and negative axes, scalar input cells and
scalar or array results. It keeps source axis order and the first value on ties
and unordered comparisons, preserving NaN and signed-zero behavior. Private
output buffers are polled for cancellation in bounded chunks.

The fast path checks builtin identity and implementation integrity. Seeds,
non-scalar input cells, multiple axes, non-real or lazy inputs, empty reduced
axes, inspection and disabled tensor fusion retain ordinary execution. Euler
667's source and algorithm are unchanged; its execution exclusion is removed.

## Measurements

Apple M5, Node v24.15.0, macOS arm64. Base: `28ffa1db`.
Three fresh sequential processes per version, with no concurrent checks launched
by this task. Times include parsing and execution, excluding imports and the
interpreter constructor. Every sample asserts answer `1.5276527929`.

| Version | Wall seconds | Median |
| --- | --- | --- |
| Before | 13.581, 13.481, 11.965 | 13.481 s |
| After | 5.879, 4.850, 7.718 | 5.879 s |

The median improvement is **2.29x**. All after samples meet the 15-second target.
CPU median decreased from 18.202 to 10.139 seconds. Peak RSS ranges overlap;
these measurements do not establish a memory reduction.

Raw samples: [2026-11-01-euler667.json](baselines/2026-11-01-euler667.json).
The earlier injected-handler experiment was only an estimate; the table above
measures the shipped path, including its normal dispatch and cancellation checks.

Reproduce after building each revision:

```sh
node benchmarks/euler667.mjs
node benchmarks/euler667.mjs 4000
```

## Verification

- `npm run build` passed.
- 258 focused interpreter tests passed across seven files: real-axis-extreme,
  fold-modifiers, negative-axis, producer-cell-demand, interrupt,
  sum-axis-stored and real-extreme-kernel.
- Both `667_movingpentagon_test.ra` examples passed (4000 and 20000 angles).
- Three execution-exclusion manifest tests passed.
- The full `npm test` and exhaustive corpus audits were not run.
