# Euler 248: recursive result proof

The unchanged `demos/euler/248_eulertotient.ra` now executes its recursive
search as compiled scalar functions. The final `return 0` previously appeared
after the self-call, so the proof had no result domain at that call.

The compiler now seeds a candidate from a closed scalar expression in the
terminal return. This supports literals and supported scalar operators without
reading variables, invoking helpers, or evaluating expressions. The existing
flow pass still validates every return, reachability, argument domains,
container effects and array-write restrictions. Earlier base returns continue
to support functions whose terminal return depends on local values. This is
not general inference for mutual recursion or arbitrary later local returns.

The algorithm, full input, answer, fixtures and execution exclusions are unchanged.
No unreachable branch is added to the program.

## Measurement

Baseline: `3ec700e6`; macOS arm64, Node v24.15.0. Fresh sequential processes,
including parsing, preparation and execution, excluding runtime-module import.
No CPU profiler or diagnostic counters were enabled for these samples.

| Full compiled main | Seconds | Peak RSS MiB |
| --- | ---: | ---: |
| Before, one control | 68.564 | 778.44 |
| After, sample 1 | 3.012 | 375.48 |
| After, sample 2 | 3.047 | 374.67 |
| After, sample 3 | 3.032 | 379.39 |

The after median is 3.032 s, approximately 22.6 times faster than the single
baseline control (not a repeated-baseline estimate). Every answer is
`23507044290`. RSS is process high-water, not retained memory. External process
load was not captured. Earlier exploratory measurements used a different branch
and are excluded from this cohort.

A separate diagnostic run records 5,590,666 compiled scalar function entries
and no `number-loop:unsafe-input` retries. It overlapped other tests and its
elapsed time is not used. Scalar function compilation is distinct from the
Number loop backend; zero Number-loop entries does not mean the search is
interpreted. An initial generic `unsupported-op:add` rejection remains, but
container-specialized execution succeeds.

Raw data: [2026-10-28-euler248.json](baselines/2026-10-28-euler248.json).

## Reproduction and verification

After Langium generation and the TypeScript build:

```sh
node benchmarks/euler248-totient.mjs
node benchmarks/euler248-totient.mjs --diag
node benchmarks/euler248-totient.mjs --fixture
node benchmarks/euler248-totient.mjs --fixture --reference
node benchmarks/euler248-totient.mjs --verify
node benchmarks/euler248-totient.mjs --verify --reference
```

Use `--runtime=/absolute/path/to/baseline/out/index.js` for a baseline build.
The independent totient sieve checks all solutions for eight targets from 2
through 720, in both engines; phi(n) >= sqrt(n/2) bounds its complete search.
The original fixture passes in both modes. Tests exercise later integer, real,
boolean, text and arithmetic returns, conflicting returns, recursive errors,
depth limits and existing recursion protections.

The full reference main was not rerun; its execution-budget exclusion remains.
Potential later work includes precomputed remainder transitions and avoiding
candidate prefixes in the solver. Neither is needed for this compiler repair.

Validation on the delivered source: Langium generation and TypeScript build,
semantic-boundary and application-form checks passed. Seven focused suites
passed 150 tests. The ordinary interpreter run (excluding exhaustive types,
differential corpus and Nurikabe) passed 9,222 tests with five failures across
`io-programs`, `explicit-plan-demos` and `diagnostics`. All five were reproduced
with the unchanged baseline proof; those three baseline suites passed 262 other
tests. No clean full-suite claim is made. Intel measurements were not run.
