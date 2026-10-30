# Euler 264: Triangle Centres investigation

Base runtime: `6dfdfa61`, macOS arm64, Node v24.15.0, 2026-10-30. At investigation start, issue #447 had neither the main nor fixture marked done. Historical table times (193.2/1.4 s for main; 169.4/1.5 s for fixture) do not reproduce on the current runtime. Concurrent later commits changed ACMP demos/index; runtime sources did not change during this investigation.

## Findings

The main search already compiles as one Number-loop region: one compiled loop, one Number loop, zero overflow retries and no compiler rejection. Thus this case does not reveal a missing compiler construct. The reference engine performs the same search with ordinary statement, binding and expression evaluation, including millions of small Euclidean steps.

The current algorithm uses primitive directions and a modular congruence to avoid enumerating triples of lattice vertices. Retain this number-theoretic approach. Two short source changes remove substantial unnecessary work:

1. Replace the hand-written unsigned Euclidean loop with `G1 = X gcd Y`. The native operation preserves the gcd for signed inputs; only the final G1 is consumed. The old scratch bindings G2/Rr are unused afterward. This improves reference execution while retaining compiled support.
2. Change `for X in (0 - Lm) to Lm` to `for X in 1 to Lm`. C is the lexicographically least vertex, hence Cx <= Ax and Cx <= Bx. Since Ax+Bx+Cx=5, Cx <= 5/3 and Sx=Ax+Bx >= 10/3 > 0. The source constructs Sx=G*X with G>0, so nonpositive X cannot produce an accepted triangle. This is a consequence of the existing canonical ordering, not a heuristic.

An optional third change bounds Y by `isqrt(max(Qm-X*X,0))`. The existing Q>Qm rejection makes the omitted corners ineligible already. This saves about 21.5% of direction visits, but its timing gain is small/noisy relative to the first two changes. Prefer the two-line range/native-gcd solution unless a later controlled comparison establishes value for the extra bound. Do not introduce reflection symmetry without proving the canonical-vertex tie cases.

## Full input measurements

Limit=100000, exact expected rounded Answer=2816417.1055 in every run. Times include parsing, execution and diagnostics, exclude module imports. Serial fresh processes, three samples per cell, medians below. Original/gcd/circle order rotated per round; positive-X controls were measured later, so this is not a randomized interleaved before/after experiment. External machine load was uncontrolled.

| Source | Compiled median (range), s | Reference median (range), s |
| --- | ---: | ---: |
| original | 0.557 (0.542-0.625) | 32.046 (30.602-35.144) |
| gcd | 0.528 (0.527-0.543) | 23.272 (23.072-26.664) |
| gcd-circle | 0.518 (0.515-0.528) | 23.297 (22.716-23.425) |
| gcd-positive | 0.326 (0.309-0.383) | 11.638 (11.347-12.079) |
| gcd-circle-positive | 0.307 (0.302-0.309) | 11.549 (11.501-11.746) |

The preferred two-change `gcd-positive` source is 2.75x faster reference and 1.71x faster compiled in these samples. The circle variant is 2.77x / 1.81x. Do not read the small difference between the two positive-X variants as a proven general gain.

A single diagnostic positive-X-only run (manual Euclid retained) took 0.310 s compiled and 15.643 s reference. This isolates the major effect of omitting ineligible directions, but is not a repeated median.

All full runs retain Nc=155 buffered candidates before the perimeter filter. No buffer-capacity or peak-memory-saving claim is made; six 20,000-cell scratch arrays remain unchanged.

## Reference runtime opportunities

A separate CPU profile at Limit=10000 confirms distributed reference overhead in expression/statement execution, binding updates and loop delivery. Repeated `resolveCompilerCapabilities` plus its `flag` closure account for about 14.2% of whole-process self samples, including startup/imports. This is a general runtime follow-up candidate, not a measured optimization or a 14% guaranteed speedup. The getter currently rebuilds the complete capabilities record on repeated accesses. Any cache must preserve supported changes of compiler options/hooks and inspection state; freezing flags blindly would change behavior. No runtime patch is proposed as verified here.

## Verification and scope

- Fresh full-input probes assert Answer=2816417.1055 in both engines for every timed variant.
- The independent oracle enumerates lattice points grouped by squared circumradius, chooses A/B, derives C=(5,0)-A-B, verifies noncollinearity and filters the perimeter. It does not use the modular-direction search. Its conservative radius bound follows from sum(side^2)=9R^2-25 and sum(side^2)<=perimeter^2.
- The initial verifier accidentally applied the circle bound to every gcd variant, including the variant labelled gcd-positive. Its sum/set comparisons passed, but did not separately verify the intended two-change source. Delivery fixes that selector: only variants containing circle receive the bound. Original, gcd-circle, gcd-positive, gcd-circle-positive and the actual shipping demo now pass in both engines at Limits 20, 30, 50, 75, 100, 150, 300 and 1000: **80 comparisons**, each checking the rounded answer and complete canonical triangle set.
- Existing fixture expected values 291.0089 (50), 3082.1168 (300), and the full 2816417.1055 are preserved. The shipping demo receives only the positive-X bound, its proof comment and the native gcd replacement. Fixture, compiler, audit exclusions, timeouts and assertions are unchanged. No exhaustive audit or full suite was run.
- Harness syntax and TypeScript language/interpreter build passed.
- Initial investigation did not change the demo or GitHub. The user subsequently authorized implementation, commit/push and one consolidated issue update; final delivery measurements and verification are recorded below.

## Reproduction

```sh
./node_modules/.bin/tsc -b packages/language packages/interpreter
node benchmarks/euler264-investigation.mjs compiled 100000 original
node benchmarks/euler264-investigation.mjs reference 100000 shipping
node benchmarks/euler264-investigation.mjs reference 100000 gcd-circle-positive
node benchmarks/euler264-verify.mjs
```

`RUNTIME` optionally selects another built interpreter. The harness uses the frozen original source in `experiments/euler264-original.ra`, applies the named transformation and asserts the default golden answer. The raw sample file retains individual diagnostics and timings.


## Final delivery

The shipping source uses the native gcd and the positive-X bound, with the bound's proof alongside the loop. The optional circle bound is retained only as an experiment. The fixture, default Limit=100000, buffers, assertions and rounding are unchanged.

A first delivery series was discarded because another session rebuilt the shared runtime outputs during sampling. The authoritative measurements below use a separately rebuilt, frozen runtime from committed `839a25d0` sources and its own language output. Original source and actual shipping source share that runtime. There are three serial fresh processes per cell, rotating the four source/engine cases per round. No own tests/builds overlap this series; other machine activity remains uncontrolled. The raw file records the runtime/source digests and all samples. Do not pool these measurements with the earlier exploration.

| Engine | Original median (range), s | Shipping median (range), s | Speedup |
| --- | ---: | ---: | ---: |
| reference | 37.643 (36.819-37.727) | 13.280 (12.601-14.150) | 2.83x |
| compiled | 0.691 (0.549-0.706) | 0.372 (0.354-0.375) | 1.86x |

Every full sample returns Answer=2816417.1055 and Nc=155. Compiled main entries retain one Number-loop region, no overflow retries and no compiler rejections. Reference samples execute zero compiled regions. No peak-memory improvement is claimed.

Final verification:

- Frozen language/interpreter TypeScript build and all three harness syntax checks passed.
- Independent oracle: 80 exact canonical-set and rounded-sum comparisons, including the actual shipping source in both engines.
- `npm test --workspace @arrrank/interpreter -- test/types.test.ts test/differential.test.ts -t euler/264_trianglecentres`: two files, four selected checks passed. Both main and fixture pass; the fixture keeps its two blocks and three program executions (default, 50, 300) per engine. No audit exclusions or timeout changes.
- The package checks used current workspace sources; final benchmark/oracle verification used the frozen committed runtime. No compiler or interpreter production change is part of this commit.
- Exhaustive corpus audits and the full workspace suite were not run.
