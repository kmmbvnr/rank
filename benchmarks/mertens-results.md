# Euler 319: bottom-up Mertens values

Measured on Apple M5 with Node v24.15.0. All full runs used
`N = 10000000000`, `Limit = 4641589` and returned `268457129`.
Raw measurements are in [mertens-results.json](mertens-results.json).

## Implementation

The sieve computes small Mertens values. For larger values, slot `S` stores
`M(floor(N / S))`. Filling slots in descending order makes dependencies
available before their consumers: for a quotient `Q = floor(X / L)` with
`L >= 2`, `floor(N / Q)` is greater than the current slot.

The table size is `floor(N / (Limit + 1)) + 1`. This also supports small
limits below `sqrt(N)`, where a table sized only by `sqrt(N)` would be too
small. The `mertens` lookup helper accepts the quotient values used by the
program, rather than arbitrary integer arguments.

The final version also carries the previous boundary coefficient between
iterations, puts the fixed modulus inside `coeff`, and reads the prepared
Mertens tables directly in the final loop. These changes let the existing
compiler use scalar and numeric loop paths. No runtime or language rules changed.

## Timings

| Variant | Median time | Samples |
| --- | ---: | ---: |
| Initial bottom-up implementation | 7.33 s | 2 |
| Reuse the previous boundary coefficient | 6.10 s | 3 |
| Also make the coefficient modulus local | 4.64 s | 1, exploratory |
| Also use direct table reads in the final loop | **3.18 s** | 3 |

The final runs took 3.197, 3.139 and 3.179 seconds, about 2.3 times faster
than the initial bottom-up version. Samples used fresh processes and ran
sequentially. One initial sample that overlapped tests was discarded.
Timings include parsing and execution and exclude interpreter construction.
Profiling and diagnostics used separate runs. RSS values in the JSON are
total process memory after execution, not peak memory or retained table size.

## Profile

A separate CPU profile of the final version took 3.14 seconds. Approximate
self-time shares were:

- Generated functions: 61%, predominantly numeric loop kernels.
- Numeric loop preparation and publication: 20%.
- Builtin call wrappers: 4%.
- Garbage collection: below 1%.

The earlier profile spent time in tensor binding and ordinary expression and
function dispatch. Those frames no longer dominate after the final loop can
compile. Further runtime work would need measurements of numeric buffer
conversion, publication and kernel arithmetic.

## Correctness

- All three default runs matched an independently executed
  [Python solution](https://github.com/cirosantilli/project-euler-solutions/blob/9170c6bb40eda679e2da3fbc019a32b0b439d076/solvers/319.py).
  That implementation uses a recursive Mertens cache and groups the final sum
  by differences of Mertens values.
- 22 interpreter tests compare against trial-division Mobius values and an
  ungrouped divisor sum with compilation enabled and disabled. They also check
  every distinct quotient lookup for each input.
- The Rank fixtures include `N = 20, Limit = 2`, which exercises the large-value
  table, alongside the problem's small checkpoints.
- A separate interpreted run at `N = 1000000, Limit = 10000` returned `585561545`.

## Reproduce

```sh
npx tsc -b tsconfig.build.json
node benchmarks/mertens.mjs --samples=3
node benchmarks/mertens.mjs --profile=/tmp/mertens.cpuprofile
node benchmarks/mertens.mjs --diagnostics
node packages/cli/bin/cli.js test demos/euler/319_bounded_test.ra
npm test --workspace @arrrank/interpreter -- test/euler-319.test.ts
```

For other inputs, pass `--n`, `--limit` and, if the input has no recorded
checkpoint, `--expected`. Use `--compiled=false` to select the reference runtime.
