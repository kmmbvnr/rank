# Euler 179: compile numeric shifts into their consumer

Baseline: `3eb63975e1df5212d0b13eb358063ff93d74ba3f`.
Apple M5, Node v24.15.0. Three serial fresh processes per compiled case,
alternating version order. Time includes parsing and complete execution; peak
RSS is sampled before answer validation. Diagnostics and reference checks run
separately. No tests, builds or profilers ran concurrently with measurements.

## Result

The demo and its fixture are unchanged. The full default answer is `986262`.
The fixture still runs limits 14, 1000, 100000 and 1000000 and checks 1, 118,
10585 and 102093. Both engines pass these checks and the full default input.

| Case | Before median | After median | Speedup | Before peak RSS median | After peak RSS median |
| --- | ---: | ---: | ---: | ---: | ---: |
| `179_consecutivedivisors.ra` | 3039.047 ms | 621.972 ms | 4.89x | 335.52 MiB | 193.80 MiB |
| `179_consecutivedivisors_test.ra` | 482.648 ms | 172.919 ms | 2.79x | 197.98 MiB | 171.62 MiB |

Peak RSS decreases by 42.2% for the main file and 13.3% for the fixture.
These are whole-process peaks, not allocation-volume or retained-heap claims.

## Cause and implementation

The sieve already uses compact integer storage and native bulk writes. A
separate instrumented baseline probe spent about 0.52 seconds creating the
array and running the sieve, followed by about 2.26 seconds in:

```rank
Answer = (Cnt equal (Cnt shift -1)) count
```

The numeric shift had only an ordinary derived-array reader. Boolean shifts
already had packed-word support. A numerical neighbor comparison could not
lower through the shift, so reduction traversed ordinary scalar wrappers.

The runtime now records native shift recipes and lowers them into the tensor
IR. The emitter computes the selected coordinate and chooses either the fill
or the source cell inside a branch. It does not read source cells for filled
positions, or construct a shifted array and a comparison mask before counting.
Oversized shifts are clamped to the axis width before address multiplication.

The source frontend also accepts literal-integer shifts of ready input arrays
inside an existing tensor reduction. It checks the current builtin identity.
Computed or dynamic amounts and arbitrary ordinary source expressions retain
the ordinary fallback there. Native deferred recipes can compose captured
amounts, arithmetic, numeric calls, views and reductions across plan stages.
This avoids moving an ordinarily completed source expression behind the shift.

Ordinary `=` remains a completion boundary. Recipes retain no cell results;
separate consumers recompute. Captures, ownership, exact integers, array domain
checks, errors, short circuit, host-reader traversal and cancellation retain
their existing behavior. Unsupported readers and observable execution fall
back. Existing packed-boolean shift kernels remain in use.

## Separate diagnostics

| Counter | Main before | Main after | Fixture before | Fixture after |
| --- | ---: | ---: | ---: | ---: |
| Ordinary computed cells | 20000002 | 0 | 2202036 | 0 |
| Compiled tensors executed | 0 | 1 | 0 | 4 |
| Bulk array update cells | 81361101 | 81361101 | 7571272 | 7571272 |

No sieve pruning, smaller input, additional memoization or algorithm rewrite
accounts for the improvement. The original compact program is accelerated.

## Reference engine and controls

Single fresh-process reference validations, not repeated performance estimates:

| Case | Before | After |
| --- | ---: | ---: |
| Main | 15.904 s | 15.632 s |
| Fixture | 1.607 s | 1.582 s |

Reference compilation is disabled, so this change does not remove its ordinary
sieve-write and scalar-read costs. Do not infer a reference speedup or regression
from these single samples. The historical execution-budget exclusion is retained.

Two unchanged default-input controls used three serial fresh processes per
version, alternating versions, and checked full answers:

| Control | Before median | After median |
| --- | ---: | ---: |
| Euler 060 bitset solution | 2688.284 ms | 2681.807 ms |
| Euler 177 mirrored-table solution | 1406.981 ms | 1418.499 ms |

Sample ranges overlap in both controls; neither establishes a regression or a
universal speedup. Raw records include the individual samples and runtime paths.

## Verification and reproduction

New tests compare both engines, including all three axes, positive/negative,
zero and oversized shifts, real and wide integer values, empty shapes, captures,
ordinary completion before a shift, unused plans, unvisited source errors,
short circuit, failed slice-write atomicity, invalid arguments, foreign readers,
replaced implementations and cancellation. Euler 179 also has an independent
trial-division oracle at 15 small limits in both engines.

```sh
npx tsc -b tsconfig.build.json
node benchmarks/euler-consecutive-divisors.mjs --before-runtime=/path/to/built/3eb63975/packages/interpreter/out/index.js --samples=3
node benchmarks/euler-consecutive-divisors.mjs --before-runtime=/path/to/built/3eb63975/packages/interpreter/out/index.js --samples=1 --diagnostics=1
node benchmarks/euler-consecutive-divisors.mjs --before-runtime=/path/to/built/3eb63975/packages/interpreter/out/index.js --samples=1 --engine=reference
```

For controls, run each worker against both runtimes three times, alternating
versions, without concurrent workloads:

```sh
node --expose-gc benchmarks/euler-prime-pairs.mjs --worker=bits --runtime=/path/to/out/index.js
node --expose-gc benchmarks/euler-quadrilaterals.mjs --worker=main --version=final --runtime=/path/to/out/index.js
```

Raw records: `baselines/2026-10-27-euler179-{compiled,diagnostics,reference,controls}.json`.
The primary benchmark records source and changed-runtime module SHA-256 hashes.

Delivery checks: TypeScript build and interpreter test typecheck, 8902 ordinary
interpreter tests in 393 files, 65 semantic-boundary owners and the application
form checks. Exhaustive type/differential demo audits and Nurikabe are separate
lanes and were not part of this change's ordinary suite run.
