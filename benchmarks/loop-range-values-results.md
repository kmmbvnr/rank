# Range values and array expressions in loops (#432)

The loop compiler now lowers finite integer `to`/`till` values, including `by`,
integer-array selectors, and explicit `copy`. These forms reuse the runtime's
range, selection and block-copy operations. Integer `+`, `-`, `*`, `//` and `mod`
expressions can supply array bindings and rank-one slice stores. Stores validate
shape and snapshot the complete RHS before committing through the bulk writer.
Unsupported element types and operators retain ordinary evaluation. The Euler
521 algorithm is unchanged.

## Measurements

Apple M5, Node v24.15.0. Each small-array case has 5,000 iterations after a
100-iteration warmup. Each cell is the median of three fresh processes, in ms.
The timed call includes parsing its invocation and diagnostics. Every compiled
checksum matches execution with compilation disabled. Initial baseline:
`720a32d5`. The first stage adds ranges, selectors and copy; the second adds
array arithmetic and vector slice stores.

| Case | Before | First stage | Final | Before / final |
| --- | ---: | ---: | ---: | ---: |
| Range value | 44.43 | 26.34 | 30.18 | 1.47x |
| Stepped selection | 106.95 | 90.04 | 100.38 | 1.07x |
| Selection by floor quotients | 148.07 | unchanged | 112.77 | 1.31x |
| Array expression written to a slice | 210.95 | unchanged | 118.63 | 1.78x |
| Range copy | 60.30 | 25.77 | 32.05 | 1.88x |

All six bodies listed in the issue have one compiled loop in the focused tests.

Euler 521 at `--n 1000000000` returns `10688477`. Five fresh-process samples per
variant, with alternating execution order, give 1765.89 ms before and 1567.39 ms
after (1.13x, about 11% less elapsed time). This includes source parsing,
initialization and the final batched computation. Single batches varied with
machine load; these alternating samples are the end-to-end comparison.

The final prime loop has 168 iterations. The instrumented benchmark subtracts
time inside generated-code dependencies for selection, copy, materialization,
array arithmetic and bulk writes. It leaves scalar arithmetic, range construction,
binding overhead, loop control and clock overhead in the residual. The median
residual is 0.0572 ms per prime, below the issue's 0.2 ms limit. This is a wall-time
estimate from explicit operation boundaries, not CPU self time. Most loop time
still belongs to array work. The pre-change prime loop is interpreted, so its
residual is not reported by this generated-code instrumentation.

[Raw samples](baselines/2026-10-24-loop-range-values.json).

## Verification

- `npm run build` passed.
- Six interpreter test files passed: 515 tests (`loop-range-values`,
  `loop-slice-copy`, `integer-loop`, `number-loop`, `array-returning-loop-calls`,
  `runtime-diagnostics`).
- `node packages/cli/bin/cli.js test demos/euler/521_smallestprime_test.ra`
  passed (`N = 100`, expected `1257`).
- Full `npm test` and corpus audits were not run.

Reproduce the measurements after building:

```sh
node benchmarks/loop-range-values.mjs --samples=3
node benchmarks/loop-range-euler.mjs --samples=5 --baseline=/path/to/baseline-checkout
```

The Euler benchmark temporarily instruments dependency injection and loop entry
inside its child process. It restores both hooks before disposing the process;
production runtime code has no timing instrumentation.
