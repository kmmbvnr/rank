# Dense integer array loops (#386)

Euler 379 now compiles each whole prime pass, including the reverse pass, into
a numeric region. Its arrays are prepared once per pass instead of once per
prime. Euler 459 uses numeric cells and checked native `bxor` in its sequential
mex and histogram loops. The three Euler programs are unchanged.

The numeric backend admits vector traversal alongside writes to other array
bindings. Each binding keeps separate private cells. Writes to the traversed
binding retain the exact backend and its iterator snapshot semantics. Reverse
traversal checks the current builtin and retains zero-based ordinal indices.
Int32 `bxor` checks both operands; wider values discard private writes and replay
exactly. Existing overflow, partial-error and cancellation publication remain.

## Measurements

Apple M5, Node v24.15.0. Each trial runs in a fresh process. Execution times include
parsing, allocation and kernel preparation, and exclude Node startup/imports.
Baseline and candidate run sequentially in alternating order. Diagnostics run
separately. Every worker checks its answer. The final baseline is a separately
built, pinned copy of `731f2942`; the candidate includes that commit's mixed
integer loops. Earlier implementation stages started from `b697ae45`.

Medians of three trials after integration:

| Program | Input | Baseline | Candidate | Speedup |
| --- | ---: | ---: | ---: | ---: |
| Euler 379 | Limit = 100,000,000 | 1699.411 ms | 356.258 ms | 4.77x |
| Euler 411 | Count = 20 | 2692.792 ms | 2673.891 ms | no measured change |
| Euler 459 | N = 10,000 | 1011.497 ms | 700.906 ms | 1.44x |
| Euler 459 | N = 100,000 | 11653.185 ms | 1389.484 ms | 8.39x |

Stages were checked separately before integration:

| Change | Workload | Measurement |
| --- | --- | --- |
| Vector traversal with separate array writes | Euler 379, 10^8 | 1761.969 to 1707.897 ms; little total benefit alone |
| Reverse traversal, with the first change | Euler 379, 10^8 | 355.271 ms; preparation now covers four numeric regions total |
| Checked Int32 bxor | Euler 459, 10,000 | 1013.758 to 697.615 ms; two numeric regions, no overflow |

The reverse stage reduces Euler 379's compiled-loop entries from 2461 to 4 at
10^8. Euler 411 already had numeric generation and binary-search loops before
this change. Its old interpreter-dispatch bottleneck was absent in the baseline.
Its full input still uses about 2.1 GiB at peak in this harness.

Full inputs completed with the following answers. Before integration, three
trials gave medians of 15.097 s for Euler 379 and 23.922 s for Euler 459. Euler 411
had one trial at 26.178 s. Separate full-input runs after integration took 15.205 s, 23.837 s and
25.605 s for Euler 379, 459 and 411 respectively. No full-input speedup ratio is claimed: the diagnostic baseline
Euler 379 run exceeded a 30-second timeout, and a full baseline Euler 459 timing
was not collected in this implementation run.

| Program | Input | Answer |
| --- | ---: | ---: |
| Euler 379 | 10^12 | 132314136838185 |
| Euler 411 | Count = 30 | 9936352 |
| Euler 459 | 1,000,000 | 3996390106631 |

Raw data: [stages, final comparisons and full inputs](baselines/2026-10-23-dense-integer-loops.jsonl).
The raw stage-2 data retains candidate samples only: main was being updated
concurrently, so its unpinned baseline samples are excluded from the comparison.

## Correctness and reproduction

The standalone [C++ reference](fixtures/dense-integer-loops-reference.cpp) checks
all three full answers and the benchmark inputs without the Rank runtime.
For 379 it uses the independent identity
`sum(d(n^2), n <= N) = sum(mu(k) * D3(floor(N/k^2)), k <= sqrt(N))`, where D3
counts ordered triples by their sorted representatives. For 411 it finds station
cycles with Floyd's algorithm instead of factorization and multiplicative orders.
For 459 it directly evaluates the recurrence and uses recursive nim multiplication
instead of building the vectorized multiplication table.

```sh
npm run build
clang++ -O3 -std=c++17 benchmarks/fixtures/dense-integer-loops-reference.cpp -o /tmp/dense-loops-reference
/tmp/dense-loops-reference 379 1000000000000
/tmp/dense-loops-reference 411 30
/tmp/dense-loops-reference 459 1000000
node benchmarks/dense-integer-loops.mjs --baseline=/path/to/baseline/packages/interpreter/out/index.js
node benchmarks/dense-integer-loops.mjs --cases=459 --input=100000 --expected=2475200726993 --baseline=/path/to/baseline/packages/interpreter/out/index.js
node benchmarks/dense-integer-loops.mjs --cases=379 --input=1000000000000 --expected=132314136838185 --timeout=60000
node benchmarks/dense-integer-loops.mjs --cases=459 --input=1000000 --expected=3996390106631 --timeout=60000
node benchmarks/dense-integer-loops.mjs --cases=411 --input=30 --expected=9936352 --timeout=90000 --trials=1
node benchmarks/dense-integer-loops.mjs --worker=379 --diagnostics
node benchmarks/dense-integer-loops.mjs --worker=459 --diagnostics
```

Validation after integration: the workspace build, 551 targeted tests in
`number-loop`, `native-loop`, `integer-loop`, `loop-bindings`, `loop-control`,
`integer32-storage` and `euler375`, the five tests in the three Euler fixtures,
and the two execution-exclusion metadata tests.
The new tests compare observable state/errors with both disabled compilation and
the exact backend. They cover shared snapshots, nested/reverse iteration,
overflow replay, bounds errors, builtin rebinding and cancellation through finally.
The full npm test and corpus audits were not run.
