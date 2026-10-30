# Euler 283 investigation

Investigated on main at `be2c200bbe27bcc17ee4121768eb3a029d2e3258`, Node v24.15.0, macOS arm64. The investigation sections record that original state and the separate prototypes; the delivery section records the accepted demo change on the newer main.

## Workload and diagnosis

At the start of the investigation, the next unfinished problem in issue #447 was 283. Both `euler/283_integertriangles.ra` and its fixture are execution-budget exclusions. The official problem asks for the sum of perimeters with integral area/perimeter ratio from 1 through 1000: <https://projecteuler.net/problem=283>.

The original algorithm builds a smallest-prime-factor table through `16*Top^2` (16,000,001 cells at the default), then visits 1,733,282 `(K,X)` pairs. It factors `K^2*(X^2+K^2)` using the separate factorizations of K and `X^2+K^2`, constructs every divisor into a 200,000-cell scratch buffer and tests the resulting Y,Z. It also repeatedly factors the same K for each X.

Let `K=2*k`, with ordered incircle tangent lengths `X <= Y <= Z`. Heron's formula gives

```
XYZ = K^2 (X+Y+Z)
D = XY-K^2
C = K^2 (X^2+K^2)
D * (XZ-K^2) = C
```

The original code already compiles both outer loops. At Top=10 and 100 there are two successful Number loops, no overflow and no compiler rejection. At Top=1000 the initial Number attempt and the mixed attempt both overflow; the exact BigInt backend completes. Large rejected divisors make `K^2*(X+Y)` unsafe even though the divisor product C itself is safe for these inputs. The final sum, 28038042525570324, also needs BigInt. The overflow fallback is correct; dropping its guard would corrupt results.

## Experiments

- `original`: frozen shipping source.
- `safe`: retain every divisor but compute `Sm=C//D+K^2`, test `Sm mod X`, and set `Z=Sm//X`. Equivalent to the original expression because D divides C. This avoids the excessive numerator; mixed mode succeeds with one preceding Number overflow.
- `capped`: use `Y<=Z`, equivalently `D<=isqrt(C)`, while constructing divisors. Partial products above the cap cannot later become smaller because all prime multipliers exceed one. Keep the original Y,Z arithmetic. Mixed mode succeeds with one preceding Number overflow. At the default, retained D is at most 8,000,000, so it also stays in compact Int32 storage; this is a storage benefit in addition to less enumeration and safer arithmetic.
- `pruned`: capped plus an early break when the prime power exceeds the cap. Initial full run did not improve on capped.
- `hoisted`: pruned plus factoring K once per k and restoring its base exponents per X. Initial full run did not improve on capped.
- `congruent`: capped plus the necessary congruence condition `gcd(X,K^2) | D`. Start the divisor buffer at that gcd and subtract its prime exponents from the enumerated factorization. This enumerates divisors C that are multiples of the gcd, without generating the other divisors first.

All variants are separate experiment sources. There is no change to ordinary/deferred assignment semantics, Number admission thresholds, compiler budgets or error timing.

## Verification and reproduction

`node benchmarks/euler283-verify.mjs` enumerates X,Y directly for small inputs, without factorization or divisor construction. It checks Heron's identity with BigInt for each accepted triangle and compares fresh interpreter instances in both compilation modes. Limits include zero, fixture goldens and 100. Full compiled experiment runs assert the existing golden 28038042525570324.

```
node benchmarks/euler283-investigation.mjs compiled original 1000
node benchmarks/euler283-investigation.mjs compiled capped 1000
DIAGNOSTICS=1 STAGES=1 node benchmarks/euler283-investigation.mjs compiled capped 1000
node benchmarks/euler283-investigation.mjs reference capped 100
node benchmarks/euler283-verify.mjs
```

Fresh-process samples run serially; imports are excluded, parsing is included. RSS is process high-water memory, not retained storage. Other host workloads are uncontrolled. Full reference, exhaustive audits and ordinary full suites were not started. Scaled reference results must not be presented as measured default-input times.

## General compiler experiment

`experiments/euler283-wide-predicates-loader.mjs` patches two compiled modules in memory, guarded by their current source layout. It does not write runtime files. The normal mixed proof conservatively requires Number for ordinary if conditions and boolean-local dependencies. The experiment removes those requirements and lowers conditions/assignments mentioning wide registers through the exact expression backend.

It lets the original source complete its mixed attempt (one overflow instead of two), with an initial full sample of 37.477 s versus the stock repeated median of 60.740 s. However, indiscriminate widening makes the capped source's `Cap=isqrt(C)` a BigInt calculation too. That operation runs once for each of the 1,733,282 parameter pairs. The first plain full capped sample under the loader took 43.040 s versus 7.603 s stock. Therefore this prototype is **not suitable to ship** despite improving the original source. No general interpreter speedup is claimed.

A possible follow-up is overflow-driven selection of wide scalar producers and their dependents while preserving safe Number calculations. This needs compiler/runtime feedback, dependency analysis and cross-program regression checks. It is an open design direction, not implemented behavior. The algorithmic cap can be delivered independently.

Reproduce the research compiler only:

```
node --no-warnings --loader ./benchmarks/experiments/euler283-wide-predicates-loader.mjs benchmarks/euler283-investigation.mjs compiled original 1000
node --no-warnings --loader ./benchmarks/experiments/euler283-wide-predicates-loader.mjs benchmarks/euler283-investigation.mjs compiled capped 1000
```

A stronger congruence experiment, `reduced`, uses both ordered factors: `D=XY-K^2` and `D'=XZ-K^2` are multiples of `G=gcd(X,K^2)`. Thus `D/G` divides `C/G^2`. Start at D=G, subtract **twice** the prime exponents of G from C's factorization, and enumerate the remaining multipliers under the original cap. `G^2` divides C because it divides both terms `K^2*X^2` and `K^4`. The original integrality/order checks are retained. This is stronger than the first `congruent` control, which only requires the first factor to be a multiple of G.

## Repeated timing results

Three fresh serial processes per case; medians. The main series rotates case order; the final paired series alternates capped/reduced. All default samples assert the full golden.

| Series | Mode | Variant | Top | Time (s) | Peak RSS (MiB) |
| --- | --- | --- | ---: | ---: | ---: |
| Main | compiled | original | 1000 | 60.740 | 348.6 |
| Main | compiled | capped | 1000 | 7.603 | 328.6 |
| Main | compiled | safe | 1000 | 31.973 | 338.8 |
| Main | reference | original | 100 | 4.256 | 419.0 |
| Main | reference | capped | 100 | 3.441 | 413.5 |
| Compiler prototype | compiled | original | 1000 | 36.230 | 364.7 |
| Compiler prototype | compiled | capped | 1000 | 43.040 | 367.4 |
| Reduced follow-up | compiled | reduced | 1000 | 6.737 | 336.7 |
| Reduced follow-up | reference | reduced | 100 | 3.508 | 407.9 |
| Final paired | compiled | capped | 1000 | 9.263 | 328.8 |
| Final paired | compiled | reduced | 1000 | 6.637 | 336.0 |

Verification: 273 comparisons in the stock runtime and 273 under the research loader (546 total). Each variant is checked at 13 limits in compiled, reference and forced-wide-seed scenarios. The seed scenario starts Total at 2^53 and subtracts it from Answer, exercising mixed lowering even on small inputs. Both runs pass. These are oracle comparisons, not a broad compiler regression suite.

The reference CPU profile at Top=100 spreads self samples across evaluation (37.29%), binding (7.39%), array/application access (3.21%), sequences (2.72%) and GC (2.93%), with the remainder elsewhere. No single numerical primitive dominates; profiling includes parse/execution and is diagnostic, not timing evidence.

Recommendation: deliver the reduced factorization with the divisor cap. It passes all checked cases and the three final paired rounds favor it: capped 9.263 s versus reduced 6.637 s (about 28% less time). The reference difference at Top=100 is within the observed variation; no additional reference gain from the stronger reduction is established. Keep the compiler prototype experimental: widening safe predicate producers indiscriminately regresses the improved algorithm. A selective widening design remains separate work. Full reference performance and removal of the execution exclusions remain unverified.

Raw samples, source/build hashes, diagnostics and oracle results: `baselines/2026-10-31-euler283-investigation.json`.

## Delivery

The shipping demo now uses the reduced divisor factorization and cap; comments explain both proofs. No interpreter/compiler change is included. The full Top=1000 golden (28038042525570324) moved from the execution-excluded fixture to a dedicated compiled test in `full-scale-demos.test.ts`. The fixture retains all four original small goldens and adds Top=0, 3 and 100; it is now eligible for regular execution audits. The full reference workload remains manual.

After fast-forwarding main to `d50ed27fc87d48b9c3e3daf50d404757ed25100e` and rebuilding language/interpreter, three fresh serial samples per case on the same runtime gave:

| Mode | Top | Source | Median time (s) | Median peak RSS (MiB) |
| --- | ---: | --- | ---: | ---: |
| compiled | 1000 | original | 54.343 | 346.2 |
| compiled | 1000 | shipping | 5.304 | 336.1 |
| reference | 100 | original | 4.157 | 418.7 |
| reference | 100 | shipping | 2.839 | 407.2 |

All six full-input samples assert the exact golden. The original and shipping sources run against the same final runtime. These are local measurements with uncontrolled other host load; Top=100 reference timings are not default-input measurements.

Validation: TypeScript build passed; the focused full-scale test passed (5.25 s); scoped fixture type/differential checks passed; semantic-boundary checks passed (11 tests, 65 owners); all 312 fresh-instance oracle comparisons passed, including shipping, reference and forced-wide-seed cases. Broad suites and exhaustive audits were not started. Historical prototype results above remain research only, including the rejected wide-predicate loader.
