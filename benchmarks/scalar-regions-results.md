# Bounded scalar regions in function and block bodies

Measured on 2026-11-11. Baseline `6f6b1ffc`; implementation `510b4b0f`.
Both include the concurrent main fix for direct-expression preparation.
Large simple scalar bodies take 62–72% less prepared time (about 2.6–3.6x
faster), and compound arithmetic takes about 26% less time on both hosts.
The small case also improves. Branch control is essentially unchanged; the Mac
array interval includes no change and a modest slowdown, while Intel's array
control improved in this run. This is not an array optimization claim.

The compiler now groups supported pure scalar assignments into bounded regions
inside framed functions and ordinary checked blocks, including arithmetic before
and after output, calls and suspension. Values stay in generated JavaScript
locals between assignments. Calls, deferred bindings, indexed writes, qualified
names and unsupported operators end a region; they keep their existing paths.
Whole-function compilation is not required.

## Semantics and bounds

Entry reads do not force plans or arrays. Every invocation checks current input
domains and uses the existing `canDeferWrites` binding-contract proof before
entering generated code. Integer calculations use exact BigInt, real arithmetic
uses Number and catalogue coercions, and mixed comparisons retain BigInt/Number
comparison semantics. The backend reuses common expression inference and operator
emission; it does not assume safe machine integers or replay on overflow.

Mutation protection is checked at each destination's first write within a pure
region. Nothing inside that region can create new protection or call user code.
Dirty bindings publish on normal exit and in `finally` after an error, preserving
the completed prefix and the original error location. The contract proof makes
these stores total. Type-changing assignments stay errors and use checked
execution. Interrupt/demand-budget and inspection modes retain ordinary execution,
so the host can observe the same intermediate states.

A region has at most 32 assignments, 256 expression-proof visits, 32,768 generated
source characters and four cached domain signatures. Existing framed-body
fragment limits remain unchanged. A failed guard uses checked statements; caches
do not grow or churn after their bound. `compiledScalarRegions` and
`scalar-region` observations expose actual execution, and dynamic specialization
preparation is timed separately when compiler profiling is enabled.

## Measurement protocol

`scalar-regions.mjs` checks every timed result against interpretation. Six
independent process pairs alternate variant order on each host. Both use Node
v24.15.0 (Mac ARM64 and Linux Intel x64). No tests run concurrently on the measured
host. Each process parses once, runs a reference check, measures eight fresh
interpreter runs and twelve runs reusing one interpreter, then collects runtime
diagnostics outside the timings. The first three samples of each mode are
warmups. Tables show median process medians in milliseconds; ratios are geometric
means of paired after/before ratios, with 95% bootstrap intervals over six pairs
(10,000 draws, seed 565). Smaller ratios are better.

Fresh timing includes execution/preparation and disposal, but excludes imports,
parsing and interpreter construction. It shares an AST and process caches, so it
is not cold process startup. Prepared timing reuses the interpreter. Output uses
a no-op callback. Peak RSS includes reference runs, warmups and diagnostics; it
is process memory, not isolated generated-code size. These synthetic cases test
specific execution shapes, not the complete demo corpus or arbitrary programs.

Cases use 100 helper calls: `small` has 8 increments, `large` 300, `retained` 1,100,
`arithmetic` 300 modular multiply/add assignments, `mixed` 100 multiply/subtract/add
triples, `branches` 100 conditionals, `real` 300 real multiply/add assignments,
`variables` two dependent integer bindings with modular arithmetic, and
`boundaries` an output after each ten increments. `arrays` is a control with
300 updates of a 4,096-element array and two helper calls.

## Previous compiler versus scalar regions

### mac-final

| Case | Mode | Before ms | After ms | Ratio [95% interval] |
| --- | --- | ---: | ---: | ---: |
| small | fresh | 1.447 | 1.274 | 0.883 [0.859, 0.916] |
| small | prepared | 1.170 | 0.687 | 0.633 [0.542, 0.755] |
| large | fresh | 8.919 | 3.219 | 0.373 [0.342, 0.407] |
| large | prepared | 5.755 | 1.848 | 0.323 [0.311, 0.333] |
| retained | fresh | 30.461 | 9.922 | 0.331 [0.313, 0.354] |
| retained | prepared | 20.122 | 5.597 | 0.277 [0.273, 0.282] |
| arithmetic | fresh | 18.349 | 9.104 | 0.481 [0.445, 0.516] |
| arithmetic | prepared | 8.593 | 6.241 | 0.740 [0.703, 0.784] |
| mixed | fresh | 9.679 | 3.471 | 0.365 [0.349, 0.389] |
| mixed | prepared | 6.632 | 2.451 | 0.383 [0.344, 0.433] |
| branches | fresh | 36.832 | 36.543 | 1.004 [0.991, 1.018] |
| branches | prepared | 4.855 | 4.768 | 0.983 [0.964, 0.999] |
| arrays | fresh | 10.611 | 10.723 | 1.021 [1.008, 1.036] |
| arrays | prepared | 6.208 | 6.221 | 1.032 [0.964, 1.092] |
| real | fresh | 15.522 | 6.210 | 0.401 [0.381, 0.420] |
| real | prepared | 7.376 | 4.439 | 0.618 [0.603, 0.633] |
| variables | fresh | 15.604 | 6.270 | 0.411 [0.393, 0.434] |
| variables | prepared | 7.681 | 4.127 | 0.567 [0.522, 0.618] |
| boundaries | fresh | 10.738 | 6.634 | 0.616 [0.593, 0.653] |
| boundaries | prepared | 7.564 | 3.942 | 0.540 [0.520, 0.565] |

### intel-final

| Case | Mode | Before ms | After ms | Ratio [95% interval] |
| --- | --- | ---: | ---: | ---: |
| small | fresh | 4.444 | 4.097 | 0.922 [0.890, 0.962] |
| small | prepared | 3.111 | 2.684 | 0.898 [0.859, 0.972] |
| large | fresh | 24.056 | 8.835 | 0.372 [0.357, 0.387] |
| large | prepared | 14.872 | 5.011 | 0.363 [0.327, 0.418] |
| retained | fresh | 73.051 | 27.904 | 0.383 [0.373, 0.397] |
| retained | prepared | 47.541 | 14.363 | 0.300 [0.289, 0.310] |
| arithmetic | fresh | 49.005 | 21.610 | 0.437 [0.421, 0.450] |
| arithmetic | prepared | 22.855 | 16.762 | 0.738 [0.716, 0.756] |
| mixed | fresh | 26.114 | 10.032 | 0.387 [0.377, 0.398] |
| mixed | prepared | 16.619 | 6.505 | 0.392 [0.385, 0.399] |
| branches | fresh | 97.147 | 100.946 | 1.032 [1.001, 1.060] |
| branches | prepared | 13.895 | 13.738 | 1.003 [0.952, 1.056] |
| arrays | fresh | 31.965 | 31.920 | 0.970 [0.936, 0.995] |
| arrays | prepared | 22.092 | 19.648 | 0.916 [0.870, 0.969] |
| real | fresh | 42.692 | 16.177 | 0.378 [0.366, 0.391] |
| real | prepared | 19.472 | 11.124 | 0.577 [0.559, 0.597] |
| variables | fresh | 42.883 | 16.777 | 0.392 [0.376, 0.408] |
| variables | prepared | 21.416 | 11.564 | 0.548 [0.527, 0.571] |
| boundaries | fresh | 30.193 | 16.414 | 0.538 [0.510, 0.572] |
| boundaries | prepared | 19.750 | 10.594 | 0.531 [0.508, 0.556] |

## Updated compiler versus interpretation

Both variants use `510b4b0f`. Before is interpretation; after is compilation.

### mac-reference

| Case | Interpreted prepared ms | Compiled prepared ms | Ratio [95% interval] |
| --- | ---: | ---: | ---: |
| small | 0.917 | 0.743 | 0.835 [0.785, 0.890] |
| large | 4.879 | 1.844 | 0.386 [0.373, 0.402] |
| retained | 17.250 | 6.065 | 0.355 [0.343, 0.366] |
| arithmetic | 10.305 | 6.551 | 0.616 [0.589, 0.644] |
| mixed | 5.871 | 2.245 | 0.383 [0.372, 0.392] |
| arrays | 8.170 | 6.547 | 0.786 [0.758, 0.817] |
| real | 8.845 | 4.757 | 0.518 [0.497, 0.540] |
| variables | 8.218 | 4.256 | 0.529 [0.499, 0.575] |
| boundaries | 6.718 | 4.000 | 0.592 [0.578, 0.608] |

### intel-reference

| Case | Interpreted prepared ms | Compiled prepared ms | Ratio [95% interval] |
| --- | ---: | ---: | ---: |
| small | 3.229 | 2.752 | 0.856 [0.825, 0.895] |
| large | 12.770 | 5.139 | 0.416 [0.394, 0.453] |
| retained | 42.837 | 14.758 | 0.352 [0.341, 0.368] |
| arithmetic | 28.682 | 18.681 | 0.653 [0.637, 0.669] |
| mixed | 14.909 | 6.790 | 0.444 [0.430, 0.457] |
| arrays | 21.902 | 20.212 | 0.895 [0.864, 0.923] |
| real | 22.445 | 11.784 | 0.530 [0.480, 0.585] |
| variables | 21.331 | 11.501 | 0.544 [0.529, 0.565] |
| boundaries | 17.113 | 10.976 | 0.638 [0.621, 0.656] |

## Process memory

Median peak RSS in MiB, six processes per variant.

| Host | Case | Before | After |
| --- | --- | ---: | ---: |
| mac-final | small | 179.9 | 177.0 |
| mac-final | large | 245.8 | 190.2 |
| mac-final | retained | 333.7 | 269.4 |
| mac-final | arithmetic | 287.8 | 270.2 |
| mac-final | mixed | 266.7 | 193.2 |
| mac-final | branches | 270.1 | 270.4 |
| mac-final | arrays | 307.5 | 306.8 |
| mac-final | real | 300.0 | 220.5 |
| mac-final | variables | 269.0 | 226.3 |
| mac-final | boundaries | 268.4 | 198.3 |
| intel-final | small | 166.1 | 162.4 |
| intel-final | large | 236.3 | 179.2 |
| intel-final | retained | 294.6 | 257.1 |
| intel-final | arithmetic | 273.2 | 253.0 |
| intel-final | mixed | 250.5 | 183.1 |
| intel-final | branches | 262.5 | 262.7 |
| intel-final | arrays | 358.2 | 317.4 |
| intel-final | real | 283.9 | 208.6 |
| intel-final | variables | 255.5 | 213.6 |
| intel-final | boundaries | 257.1 | 184.0 |

## Verification and reproduction

After rebasing onto the current main, 749 tests passed across 16 focused
interpreter files, including scalar regions, compiler budgets, framed functions,
effect boundaries, generated composition, demand/interrupt behavior, capability
matrix, diagnostics, scalar kernels, tensor fusion and borrowed-real loop reads.
The dedicated region suite covers exact wide integers, reals, mixed comparisons,
multiple bindings, signed division/remainder, zero-divisor errors and prefix
publication, live mutation protection, type contracts, deferred inputs, arrays,
specialization limits, generator suspension, observable polling and twelve varied
arithmetic compositions. CLI diagnostics passed 13 tests. TypeScript build passed.
A broad CLI invocation was stopped during the unrelated slow terminal scenarios;
it is not reported as a suite pass. Full root tests and exhaustive audits were not
run.

An early variant missed short framed bodies and showed a small Mac regression
there. Short eligible runs now enter the same region backend; the final tables
include that correction. Earlier prototype and source-extraction timings are not
mixed into this report.

Build both checkouts, then run:

```sh
python3 benchmarks/array-ownership-compare.py \
  --harness benchmarks/scalar-regions.mjs \
  --before /path/to/baseline --after /path/to/candidate \
  --before-revision 6f6b1ffc --after-revision 510b4b0f \
  --cases small large retained arithmetic mixed branches arrays real variables boundaries \
  --iterations 100 --repeats 6 --output /tmp/scalar-regions.json
```

Use `/path/to/candidate#reference` as before to compare interpretation. The
checked-in JSON retains all timings, counters, memory snapshots and host metadata.
Summarize it with `python3 benchmarks/array-ownership-summary.py
benchmarks/scalar-regions-results.json`.
