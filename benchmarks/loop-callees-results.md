# Linked loop callees (#101)

Node v24.15.0, Apple M5. Run after the TypeScript build:

```sh
node benchmarks/loop-callees.mjs --reference
node benchmarks/loop-callees.mjs
```

Each case runs in a fresh process with two warmups and seven timed executions;
values below are medians in milliseconds. Parsing is included. Diagnostics run
separately. Reference disables `scalarCallCompilation`, retaining other compiler
passes; this isolates helper linking rather than comparing against an entirely
interpreted runtime. Every execution checks its answer. Each new helper fixture
also asserts exactly one compiled region in linked mode.

| Case | Linking disabled (ms) | Linking enabled (ms) | Ratio | Compiled regions |
| --- | ---: | ---: | ---: | --- |
| collatzDemo | 490.69 | 496.73 | 0.99x | 1 → 1 |
| palindromeDemo | 9.83 | 9.33 | 1.05x | 0 → 0 |
| containers | 122.93 | 26.35 | 4.67x | 9999 → 1 |
| scratch | 31.27 | 19.02 | 1.64x | 2000 → 1 |
| array | 42.74 | 3.90 | 10.96x | 0 → 1 |
| text | 12.25 | 2.91 | 4.21x | 0 → 1 |
| loop | 13.41 | 2.66 | 5.04x | 2000 → 1 |

The container fixture is a Collatz search below 10,000, using an index argument,
a fresh local stack, and two helper loops. The scratch fixture makes and fills a
20-cell local array on each of 2,000 calls. Other fixtures exercise 12,000 eager
array/text reads and 2,000 triangular-sum helper calls. All new linked fixtures
reported zero copy-on-write copies; separate differential tests cover required
copies for aliased/parameter arrays.

`collatzDemo` and `palindromeDemo` use the current Euler source at its default
size (1,000,000 and three digits), replacing only CLI option declarations and
printing. Function declarations are loaded once before timing. They check
837799 and 906609 respectively. These are regression workloads, not evidence
for the new helper-call coverage: current Collatz already uses one inline
compiled loop, and palindrome-product uses a sequence pipeline.

The original pre-change diagnostic baseline (commit `f464acd0`, before typed
linking) had zero compiled outer regions for array/text helpers and 2,000 inner
regions for the numeric helper. Initial medians were 39.38 ms for array reads;
the repeatable flag comparison above is the final reported comparison.

These timings cover these workloads on one machine. They do not establish a
speedup for arbitrary records, recursive functions or unsupported callee bodies.
Inlining and resource-tracking removal remain deferred. Container operations
still use resource-aware storage; array parameters retain copy-on-write and may
copy instead of using the ordinary call path's last-use transfer optimization.
