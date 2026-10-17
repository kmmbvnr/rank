# Dense integer division and remainder (#290)

Measured on 2026-10-17, Node v24.15.0 on Apple M5. Baseline:
`057dc486`; after: runtime commit `4bec4e85` and the accompanying Euler demo changes.

Build each checkout, then run the same benchmark against its compiled interpreter:

```sh
npm run langium:generate
npx tsc -b tsconfig.build.json
node benchmarks/integer-division.mjs --root /path/to/checkout --euler
```

Each case runs three times, sequentially, in fresh Node processes without a profiler.
The parent measures process start through exit, including imports, parsing, input
construction, both sums and execution. Printed output is suppressed; all sums and
the Euler answer are asserted. Tests ran separately from the final measurements.
`--case euler` runs only the full demo. Times below are medians.

| Case | Before, s | After, s | Before peak RSS, MiB | After peak RSS, MiB |
| --- | ---: | ---: | ---: | ---: |
| `V * 3 + 1` control | 1.653 | 1.554 | 573.1 | 579.8 |
| `V // 100` | 2.811 | 1.373 | 647.9 | 520.0 |
| `V mod 7` | 2.327 | 1.402 | 645.1 | 517.3 |
| `V // 100 mod 10` | 6.406 | 1.605 | 1439.2 | 579.2 |
| Named quotient, then `mod 10` | 7.350 | 1.608 | 1384.2 | 580.8 |
| Euler 74, default input | 6.350 | 4.719 | 1267.7 | 1114.1 |

| Case | Before samples, s | After samples, s |
| --- | --- | --- |
| `V * 3 + 1` control | 1.662, 1.653, 1.632 | 1.538, 1.554, 1.557 |
| `V // 100` | 2.811, 2.995, 2.507 | 1.389, 1.373, 1.348 |
| `V mod 7` | 2.440, 2.297, 2.327 | 1.380, 1.402, 1.415 |
| `V // 100 mod 10` | 6.406, 6.417, 6.400 | 1.605, 1.631, 1.604 |
| Named quotient, then `mod 10` | 7.299, 7.350, 7.430 | 1.608, 1.602, 1.726 |
| Euler 74, default input | 6.388, 6.350, 6.269 | 4.719, 4.788, 4.667 |

The reproduction improves from 6.406 to 1.605 seconds (about 4.0 times as fast).
The named intermediate also remains dense. Integer cells stay BigInt; no Float64
conversion or fixed-width integer wrapping is introduced.

The full demo comparison includes algorithm changes: the old thousands-table
construction is replaced by `f(n) = f(n // 10) + Fact(n mod 10)`, extending a table
by digit length. The zero prefix contributes zero, while internal zero digits
contribute `0! = 1`. A closed bound of 2,177,281 covers the default six-digit starts
and the successor of 1,999,999; larger requested start ranges enlarge that bound.
This reduces the graph size as well as removing the workaround. The full-demo
speedup is therefore not attributed solely to the arithmetic kernel.

Profiling the initial seven-full-pass rewrite showed avoidable selection checks
through public item facades and later lazy processing of graph lengths. Stored
selectors now borrow trusted scalar cells during validation, while host/lazy
readers keep their original access path. Functional graph lengths use fresh owned
scalar storage; successor validation borrows stored cells when available.

Peak RSS is the process high-water mark, not a live-heap measurement or a formal
memory bound. The decimal table still uses O(N) cells. Absolute timing varies with
machine load; the final three default-demo runs are all below five seconds.

Regression coverage includes arbitrary-precision values beyond 2^53 and 2^63,
both signs and scalar orientations, broadcasting, missing/real inputs, demand
order and division-by-zero errors, COW aliases, host selector behavior and
cancellation. Dense kernels must propagate InterruptedError instead of treating
cancellation as a reason to fall back to a lazy reader.
