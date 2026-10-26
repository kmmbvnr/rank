# Euler 111: ranked cells through arithmetic consumers

The unchanged `111_primerunning.ra` builds only 37,350 candidates at the default
`Size = 10`, stopping after one- and two-position replacements. Its dominant
cost was repeated ranked matrix contraction while completing `Cands`:

```rank
Shift' = Spots matmul Moves rank 2 2
Cands = Digs * Ones + Shift
```

The ranked producer already offered a prepared traversal holding its current
matrix result. The arithmetic wrapper lost that traversal and independently
read every scalar. Each scalar read invoked the producer again and completed
an entire matrix. Separate instrumented runs count 900 contractions returning
10-by-9 matrices and 36,450 returning 45-by-81 matrices before the fix; after it,
each stage performs ten contractions. The original diagnostic stage run spent
about 4.88 s completing second-stage `Cands`, versus 34 ms completing `Hit`.

Binary broadcast maps and scalar callback maps now pass prepared operand
readers through to their consumer. The cursor belongs to one traversal and
holds only the current producer cell. Separate operands, repeated traversals
and point observations remain independent. Preparation reads no cells;
ordinary output validation and execution-stack error handling remain in place.
Expanded operands retain ordinary reads so broadcasting does not reuse a
producer across distinct observations. Deep maps above the existing 128-layer
synchronous-read limit retain stack-driven evaluation. This is shared runtime
work, not new compilation of the surrounding loop.

The demo, lazy bindings, algorithm, defaults, two fixture tests, golden answers,
execution lanes and deadlines are unchanged. Tests still run the full ten-digit
input once and the independent four-digit example once. Answers remain
**612407567715** and **273700**.

## Controlled measurements

Apple M5, Node v24.15.0; baseline `56ae8c8d`. Three serial fresh processes per
version/workload/engine, with job order reversed on alternating samples. Time
includes parsing and full execution, excluding interpreter construction and
module imports. RSS is process high-water memory sampled before oracle checks;
it is not retained array storage. No tests or profiles ran concurrently.

| Engine | Workload | Before, s | After, s | Speedup | Before peak RSS, MiB | After peak RSS, MiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Compiled | Main | 5.083 | 0.206 | 24.7x | 327.2 | 183.5 |
| Compiled | Fixture | 5.109 | 0.233 | 21.9x | 334.4 | 180.9 |
| Reference | Main | 5.087 | 0.200 | 25.4x | 327.2 | 182.2 |
| Reference | Fixture | 5.148 | 0.227 | 22.6x | 329.1 | 179.3 |

Separate diagnostic samples reduce generic derived-cell computations from
26,617,490 to 52,730. Compiled-loop count remains zero and native tensor count
remains one: the speedup removes redundant runtime work rather than compiling
more operations. Typed buffer unpack count is zero in both versions.

The independent benchmark oracle enumerates replacements with scalar arithmetic
and tests primality by trial division using primes through 100,000. Every main
sample checks the exact answer, output and final ten-digit completion mask;
both ten- and four-digit oracle answers are checked. Every fixture sample checks
both tests and their printed answers. Inner-loop arrays are scoped locals and
are not inspected by this benchmark.

Three fresh-process control samples using unchanged sources and existing oracle
harnesses give Euler 093 main 1.099 → 1.107 s (+0.8%) and Euler 104 main
0.838 → 0.835 s (-0.4%). Their timing ranges overlap. Median peak RSS is
483.9 → 483.6 MiB and 395.6 → 407.2 MiB, respectively; no speedup is claimed
for these controls.

Raw results: [compiled and diagnostics](baselines/2026-10-26-euler111-mapped-traversal.json),
[reference](baselines/2026-10-26-euler111-mapped-traversal-reference.json),
[controls](baselines/2026-10-26-euler111-mapped-traversal-controls.json).

Reproduce after building, with a separately built baseline runtime:

```sh
node benchmarks/euler-prime-runs.mjs --baseline-runtime=/path/to/before/index.js --samples=3
node benchmarks/euler-prime-runs.mjs --baseline-runtime=/path/to/before/index.js --samples=3 --engine=reference
node benchmarks/euler-prime-runs.mjs --baseline-runtime=/path/to/before/index.js --samples=1 --cases=main --diagnostics=true
```

Controls use the worker commands recorded in the control artifact, alternating
`--runtime` between baseline and current output in fresh serial processes.

## Verification and remaining scope

- Build and test typecheck pass, as do semantic-boundary (65 owners) and application-form checks.
- 370 ordinary interpreter files / 8,417 tests pass. This selection excludes the exhaustive types/differential corpora and Nurikabe.
- Scoped Euler 111 type/differential audits pass four selected tests, covering both files and both engines.
- Fourteen added tests cover nested maps, per-traversal and per-operand cursor ownership, repeated point reads, partial demand, retry after failure, delayed shape failures, host read order, expanded-operand fallback and output domain checks.

General broadcasting cursor reuse and compilation of this entire loop remain
outside this change. Algorithmic pruning could skip digits already in `Found`
and prefilter decimal divisibility, but it was not needed to remove this
bottleneck and has not been applied.
