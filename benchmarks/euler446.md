# Euler 446: retractions

The full answer remains **907803852**. The [problem](https://projecteuler.net/problem=446)
asks for the sum of `R(n^4 + 4)` through ten million, modulo 1000000007. Its
published checkpoint at 1024 reduces to 376757876, retained in the fixture.

For each prime power, an idempotent affine map contributes either one choice
or the whole prime power's choices. Excluding constant maps gives
`R(m) = product(1 + p^e) - m`. The existing Sophie Germain decomposition into
`(n-1)^2 + 1` and `(n+1)^2 + 1` is retained. These factors are coprime for odd
n; for even n, replace their two unitary factors of 3 by the factor 5 for 4.
The code precomputes that modular correction once.

The old large-prime sweep repeatedly sorted hit positions and grouped equal
positions into separate passes. It also retained many full-size intermediates.
The replacement constructs hit runs within blocks of 131072 rows, including
two neighboring rows for the final products. `scan` expands the runs and
`reduce * by ... with 1 size ...` combines factors by position without sorting.
Empty groups keep identity 1. After small factors are removed, the remaining
factor of each quadratic is prime. Only still-divisible events continue
through prime-power extraction.

Library `powmod` replaces the hand-written vector exponentiation loops. Root
search continues until every prime is handled, rather than stopping at an
arbitrary seed limit. The program has one loop per helper/main, with no nested
Rank loop statements. A direct scalar sieve and lazy final-stage alternatives
were also explored; the block implementation gives fast reference execution
without their larger working sets.

A general compiler improvement lowers numeric mask `indices`, allowing the
prime-power helper's fresh arrays, shrinking selection and writes to execute
as one Number region. Completed packed masks retain their native backend;
see [constructor controls and semantics](compiled-mask-indices.md).

Measurements compare `cd112cc9` source/runtime with the new source/runtime.
Each host runs three alternating before/after pairs per mode, in fresh Node
v24.15.0 processes. Timings include parsing and execution; RSS is process peak.
Intel `vmstat` readings are retained with each sample to distinguish host load
from implementation effects. Mac observations include background load and
some timing spread, so medians and raw samples are both retained.

| Host / mode | Before, ms | After, ms | Before RSS, MiB | After RSS, MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac, compiled | 10836.75 | 5993.25 | 1480.00 | 378.45 |
| Mac, reference | 13667.37 | 6345.52 | 1737.70 | 371.61 |
| Intel, compiled | 25829.87 | 12111.18 | 1217.12 | 364.30 |
| Intel, reference | 28908.93 | 13532.43 | 1193.12 | 367.27 |

The default is 1.81–2.15 times faster, with 69–79% lower peak RSS.
Intel pre-run samples show 98–100% CPU idle and no active swap traffic.

All 24 full-input samples return the same golden answer. Reference execution
now stays close to compiled execution. The full execution exclusion is removed;
the bounded Rank fixture avoids duplicating the default run, and a dedicated
ordinary test preserves the full compiled golden answer.

Verification: 557 focused tests across 16 files pass on both hosts. Direct
factorization of `n^4 + 4` supplies 60 independent whole-prefix/interval checks
per host across Number compilation, exact compilation and the interpreter.
These cover zero, parity, repeated prime powers, empty groups and interval
halos. The three-test Rank fixture passes in all three modes on both hosts.
Source/test TypeScript checks pass. Exhaustive audits were not run.

Raw measurements: [24 full runs](baselines/2026-11-07-euler446.json).
Reproduce from repository root:

```sh
git show cd112cc9:demos/euler/446_retractionsb.ra > /tmp/euler446-before.ra
node benchmarks/euler446.mjs compiled 10000000
node benchmarks/euler446.mjs reference 10000000
```

For exact before controls, build an interpreter at `cd112cc9`, set
`RANK446_RUNTIME` to its `out/index.js` file URL, and pass
`/tmp/euler446-before.ra` as the third argument to the benchmark runner.
