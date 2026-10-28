# Euler 252: reference application dispatch

Euler 252 already compiles its hot geometric DP loop in Number mode. The
minutes-long workload is the reference interpreter, not an uncompiled hot loop
in the default configuration. Keep the existing algorithm, default N=500 and
all fixture assertions (full answer 104924; N=20 answer 1049694.5).

Application classification previously allocated a Map, temporary arrays and a
joined signature string on every evaluation. An ordinary data name was also
looked up twice. Retain the classification storage per prepared expression,
check each live binding once, and rebuild the evaluator when its role changes.
No expression values or binding objects are cached. A failed rebuild invalidates
the evaluator so a later execution retries. This works with compilation=false;
it introduces no generated JavaScript or Number arithmetic.

Three alternating sequential fresh-process samples per workload, Node 24.15.0,
macOS arm64. Imports excluded; parsing, preparation, evaluation and diagnostics
included. Host load is uncontrolled. Medians, all with compilation=false:

| workload | parent ms | optimized ms | elapsed reduction |
|---|---:|---:|---:|
| 252, N=100 | 2038.897 | 1810.556 | 11.2% |
| 252, N=200 | 13636.017 | 11987.661 | 12.1% |
| 250, full default | 1459.325 | 1163.786 | 20.3% |
| 251, Limit=1000000 | 617.648 | 594.954 | 3.7% |

The original full 252 main took 198.498 s in reference mode (single observation).
The shipping reference fixture took 172.110 s total; its full-default block took
171.909 s. Both blocks / four program runs passed. These have different harness
envelopes: use the repeated N=200 controls for the relative-speed claim. Controls
precede the error-retry invalidation guard; the complete fixture includes it.
The main and fixture remain excluded from the quick reference corpus audit.

Rejected experiments: area pruning and ordered predecessor lists gave little
compiled improvement. Per-anchor edge capacity reduced copied cells but raised
process maximum RSS; combining it with a Number publication scan limit added no
clear benefit. A prepared reference loop-body dispatch also added no measurable
gain. None of these changes is shipped. No memory saving is claimed.

Raw observations: [baseline](baselines/2026-10-28-euler252.json).
The independent small-input oracle enumerates subsets, forms convex hulls and
rejects polygons containing any strictly interior point:

```sh
python3 benchmarks/experiments/euler252-oracle.py
node benchmarks/euler252-convexholes.mjs --N=100 --expect=356711 --reference
node benchmarks/euler252-convexholes.mjs --fixture
node benchmarks/euler252-convexholes.mjs --fixture --reference
```

Build parent and shipping checkouts separately and pass `--runtime=/absolute/path/to/packages/interpreter/out/index.js`
to the same harness for comparisons. Inputs and golden answers are unchanged.

Verification: forced TypeScript build; 1,482 language tests; 11 semantic boundary
tests / 65 owners; application-form checks; CLI checks for both files; 20 shipping
runs against the independent N=3..12 oracle in both engines; full 252 fixtures
in both engines. The focused application/control suites pass (118 tests).

The ordinary interpreter run completed with 9,207 passes and 28 failures in
8 suites. The exact same 28 test names fail with the unchanged parent expression
evaluator (477 other tests in those suites pass). They concern accumulate syntax,
reduce/CLI names, one diagnostic and an explicit-plan demo result; no new failure
was observed. Exhaustive types/differential/Nurikabe audits were not run.
