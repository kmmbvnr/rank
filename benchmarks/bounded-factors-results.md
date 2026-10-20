# Bounded factorization and Euler 302

`N factors` keeps its existing syntax and ascending lazy sequence result.
It now reuses a smallest-prime-factor table, shared with `divisors`, within one
interpreter. The table grows geometrically and retains at most 4 MiB, covering
positive integers below `2 ** 20`. Larger inputs retain arbitrary-precision
trial division and can switch to the table after their remaining cofactor fits.
This is a table-memory cap, not a cap on the interpreter's total memory.

Euler 302 uses `C Base = Base factors array` in place of its manual table and
factor-extraction loop. It retains the per-value cache and the recursive search.
The source shrank from 120 to 106 lines (14 lines, 11.7%).

## Measurements

Node v24.15.0, Apple M5, 2026-10-20. Each sample uses a fresh process and includes
parsing, compilation, table construction and execution. Variant order alternates
between trials. These measurements ran on a shared development machine; CPU time
is included alongside wall time, and no total-memory saving is claimed.

| Workload | Trials per variant | Before median wall | After median wall | Before median CPU | After median CPU |
| --- | ---: | ---: | ---: | ---: | ---: |
| Factor every prime minus one below one million, three passes | 5 | 4.340 s | 3.236 s | 4.469 s | 3.508 s |
| Euler 302, limit `10 ** 8` | 5 | 1.292 s | 1.746 s | 1.861 s | 1.951 s |
| Euler 302, limit `10 ** 12` | 3 | 7.060 s | 6.644 s | 9.481 s | 8.779 s |
| Euler 302, limit `10 ** 18` | 1 | 600 s worker timeout | 333.421 s | unavailable | 380.125 s |

Repeated factorization took 25.4% less wall time and 21.5% less CPU time.
The complete `10 ** 12` search took 5.9% less wall time and 7.4% less CPU time;
all six runs returned `16176`. This does not establish the same speedup at
`10 ** 18`. The small `10 ** 8` case did not improve in the five-trial run;
its samples varied from 1.18 to 3.76 seconds, so no speedup is claimed there.

The original `10 ** 18` demo did not finish within the ten-minute worker budget.
The simplified demo completed in 333.421 seconds and returned the expected
`1170060`. These full-scale runs were single samples under different background
loads: the original overlapped the ordinary test suites and part of the type
audit, while the simplified run followed them. They establish full-scale
completion of the simplified demo, but are not a controlled estimate of its
speedup percentage. The repeated smaller comparisons above alternate variants.

An exploratory CPU profile of the simplified `10 ** 12` run recorded 3 of
3573 self samples in `factorization.js` and 407 in garbage collection. This
measures self samples, not all overhead associated with calling `factors`;
it indicates that further large-search improvements need work beyond the
factor table. Profiling was separate from the timed comparisons above.

The factoring baseline uses the original `numbers.ts` from `077bd2f0`, compiled
with TypeScript and substituted into a copy of the current built interpreter;
all other interpreter modules are identical. The Euler baseline is the original
120-line demo, preserved in `fixtures/302-strongachilles-manual.ra`, on the same
runtime as the simplified demo.

## Verification and reproduction

The tests compare every integer through 20000 and all 78498 prime-minus-one
inputs below one million with independent trial division. They cover the table
boundary, large exact integers, suspended traversals across table growth,
cancellation followed by retry, sequence replay, divisors and domain errors.
The simplified demo returns the published counts `7` and `656` in both compiled
and interpreted modes. The 232 ordinary interpreter suites passed (4505 tests);
the exhaustive demo audits were stopped during the type audit and are not
claimed as passed. TypeScript and semantic-boundary/application-form checks pass.

```sh
npm ci --ignore-scripts
npm run langium:generate
npx tsc -b tsconfig.build.json
npm test --workspace @arrrank/interpreter -- test/factorization.test.ts
node benchmarks/bounded-factors.mjs --cases=euler-1e8,euler-1e12
node benchmarks/bounded-factors.mjs --cases=prime-minus-one --trials=5 --baseline=/path/to/original/interpreter/out/index.js
node benchmarks/bounded-factors.mjs --cases=euler-1e18 --trials=1 --timeout=1800000
```

The default benchmark includes the `10 ** 18` search and asserts its expected
answer `1170060`; use `--cases` to select shorter workloads. The default timeout
is ten minutes per worker, configurable with `--timeout` in milliseconds.
`--variants=builtin` selects only the simplified demo. Timed-out workers are
recorded in JSON, the remaining variants still run, and the command exits nonzero.
