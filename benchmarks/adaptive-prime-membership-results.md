# Adaptive prime membership

Measured on 2026-10-25, Node v24.15.0, Apple M5. Three serial fresh processes
per runtime and workload, with alternating order. Execution includes parsing.
Both frozen builds share identical surrounding interpreter and language modules;
only `prime-sequence.js` and `prime-sieve.js` differ. Demo sources are unchanged.

The earlier fixed 32-query experiment slowed the full Euler 263 search in all
seven alternating pairs: median 5.138 s before, 5.481 s after (+6.7%). That
experiment retained the older surrounding build and is separate from the final
comparison below. Its loss was reproducible rather than one slow observation.

## Final comparison

| Workload | Original two-query policy | Adaptive policy | After / before |
| --- | ---: | ---: | ---: |
| euler058 | 1.025 s | 0.259 s | 0.253 |
| euler060 | 5.034 s | 3.868 s | 0.768 |
| euler263 | 5.622 s | 5.628 s | 1.001 |
| euler293 | 0.671 s | 0.178 s | 0.266 |
| direct-membership | 0.126 s | 0.127 s | 1.010 |
| bounded-membership | 0.157 s | 0.162 s | 1.029 |

These are local measurements, not portable acceptance thresholds. Differences
of a few percent should not be treated as demonstrated gains. An earlier
adaptive prototype series put Euler 263 about 1.5% above its own baseline;
the final series is reported above, without claiming an exact zero cost.

## Policy

An unbounded membership observer starts with a two-query sieve warmup. When
it leaves a segment, a short run raises the warmup toward 32; a long run pays
that penalty back toward two. Prepared cells are reused immediately, including
composite results. History belongs to the observer and uses no wall-clock probes.
Bounded membership still uses the sieve directly. Each workspace retains one
4 KiB segment and the existing capped base-prime table; no retained/peak-memory
improvement is claimed. Iteration, arbitrary-precision fallback and bounds are
unchanged.

## Verification and reproduction

- 71 focused interpreter tests passed, including numeric bounds, pseudoprimes,
  sparse/dense/reverse transitions, independent observers and cancellation.
- 26 full Euler programs and nine reduced inputs retained their answers.
  Full Euler 216, 245 and 248 had exceeded the earlier 15-second audit budget
  in both policies, so they are represented by reduced inputs here.
- Eleven Euler fixtures passed all 29 embedded tests with the adaptive runtime.
- TypeScript build and interpreter test typecheck passed.

```sh
npx tsc -b tsconfig.build.json
node benchmarks/prime-sequences.mjs --cases=euler058,euler060,euler263,euler293,direct-membership,bounded-membership --trials=3 --baseline=/path/to/before/out/index.js
```

Use `--candidate=/path/to/frozen/out/index.js` to freeze the candidate too.
Run without concurrent builds, tests or profilers. The benchmark checks exact
answers on every sample.

[Raw samples and validation](baselines/2026-10-25-adaptive-prime-membership.json).

## Update: 2026-10-26

The current warmup ceiling is 64 rather than the 32 measured above. The historical
samples remain unchanged. Euler 118 gains from delaying premature sieve work;
Euler 058's five-pair repeat costs 3.7% (about 9 ms). See the
[Euler 118 report](euler118-pandigital-prime-sets-results.md) for current controls,
prototype comparisons and the separate direct-permutation improvement.
