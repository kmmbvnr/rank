# Euler 299 investigation

Baseline: 40adaba7343825befd09faf51d4e83582d20905f. Selected from the live
unfinished rows of issue #447, following 298. The initial measurements below
use that baseline. A subsequent local compiler change is described in
"Private numeric vector stages" below. Production demos and GitHub remain
unchanged; algorithm variants are research files.

Problem: https://projecteuler.net/problem=299
The official statement gives 92 for b+d<100 and 320471 for b+d<100000.
The full default Limit=100000000 answer remains **549936643**.

## Findings and recommended variant

The existing parametrization is appropriate, but it enumerates overlapping
parameter domains for two symmetric contributions, computes gcd by a Rank
Euclidean loop, and checks the quadratic bounds inside the V loop. The outer
U/V/gcd search already compiles into a single Number region. Diagnostics show
no Number overflow, mixed execution or array copying; there is no missing
scalar compilation path to fix here.

Use the existing native `numbers.gcd`, combine the two symmetric families,
and calculate the V upper bound once per U. The `symmetry` prototype is the
preferred compiled-speed/memory variant:

```
Max = Limit - 1
Total = 0
for U in 1 to ((Max + 2) isqrt - 2) by 2
  Hi = ((Max + U * U) // 2) isqrt - U
  for V in 1 to Hi
    if U gcd V equal 1
      Qa = U * U + 4 * U * V + 2 * V * V
      Q2 = 2 * (U * U + 2 * U * V + 2 * V * V)
      Total += 2 * (Max // Qa) + Max // Q2
    end
  end
end
```

Proof of the rewrite:

- Qb(U,V)=Qa(V,U). Exchanging U/V preserves positivity and coprimality and
  converts the original V-odd condition to U-odd. Thus the total first-family
  contribution is twice the Qa sum over positive coprime pairs with U odd.
  The official statement explicitly distinguishes swapping b/d, consistent
  with the original two sums; this is a reindexing, not deduplication.
- Qa=2*(U+V)^2-U^2. Hence Qa<=Max exactly when
  V<=isqrt((Max+U^2)//2)-U. Requiring V>=1 gives
  U<=isqrt(Max+2)-2. No floating-point square roots or approximations are used.
- Q2-Qa=U^2+2*V^2>0, so the Qa domain also includes all nonzero Q2
  contributions. Max//Q2 is zero when its bound fails; both denominators are
  positive. The Limit-1 conversion preserves strict b+d<Limit boundaries.

At the full bound, gcd candidates drop from **36185049 to 15578139**. The
asymptotic lattice enumeration remains the same; this reduces its constant
and per-candidate work. Reference time is dominated by interpreted scalar
statements, particularly the handwritten gcd. Using the builtin avoids that
inner interpreted loop; the compiler already knows how to call it.

## Repeated serial measurements

Three fresh processes per case, with case order rotated across rounds.
Node v24.15.0/macOS arm64; includes parsing/execution, excludes imports/startup.
No own oracle/profile/build/test work overlaps samples. Other host load is
uncontrolled. RSS is process peak, not retained collection size.

| Compiled, full Limit=100000000 | Median | Range | RSS median |
| --- | ---: | ---: | ---: |
| Original | 2.321 s | 2.261-2.347 s | 158 MiB |
| Native gcd only | 1.550 s | 1.422-1.642 s | 158 MiB |
| Symmetry + exact bounds + native gcd | **0.643 s** | 0.639-1.124 s | **158 MiB** |
| Array vector variant | 1.400 s | 1.393-3.619 s | 586 MiB |

The preferred scalar variant is about **3.6x faster compiled**, with no
meaningful peak-memory change.

| Reference workload | Original | Symmetry scalar | Array vector |
| --- | ---: | ---: | ---: |
| Limit=1000000 | 1.184 s (1.178-1.477) | 0.268 s (0.264-0.319) | not measured |
| Full Limit=100000000 | exceeded 30 s | 16.830 s (16.450-18.142) | 1.395 s (1.386-1.765) |

The matched smaller reference case improves about **4.4x**. The original full
reference was terminated after 30 seconds, so no full-reference speed ratio
is claimed. The optimized scalar full reference uses about 177 MiB peak RSS;
the array variant about 665 MiB. The array version is a reasonable alternative
if reference speed is the main goal, at roughly twice the preferred scalar
compiled time and about four times the memory. It is not the preferred default
for compiled execution or constrained memory.

## Other experiments

Exploratory single full-input samples, not medians; do not interpret small
relative differences as established improvements:

| Variant | Compiled | Reference | Peak RSS, compiled/reference |
| --- | ---: | ---: | ---: |
| Native coprime vector, scalar contribution loop (`hybrid`) | 0.968 s | 8.381 s | 510/430 MiB |
| Deferred Qa'/Q2' (`lazy`) | 2.733 s | 14.625 s | 612/512 MiB |
| Explicitly materialized coprime vector (`eager`) | 2.889 s | 1.841 s | 581/560 MiB |
| Completed-square polynomial expressions (`squares`) | 2.415 s | 1.490 s | 579/647 MiB |

The vector version builds/filter Vs and evaluates all contributions with
array arithmetic and one sum per U. Deferred variables did not help this
consumer pattern. More allocation/materialization or algebraically shorter
array expressions did not eliminate the memory/speed tradeoff.

There is a general array-compiler opportunity, separate from the scalar fix.
At Limit=1000000 the vector variant executes 998 compiled tensor kernels but
no compiled loops. The U region rejects MaterializeExpression, while tensor
lowering encounters dynamic filters and scalar-evaluation timing; division
expressions also miss scalar operator guards. Useful further work would
connect dynamically built/filtered local arrays to their loop consumers while
preserving binding, error and evaluation order. It is not required to get the
0.643-second scalar result, The implementation experiment below addresses this separately; no admission
threshold was raised.

## Independent correctness checks

`euler299-oracle.py` enumerates integer a,b,d and every interior integer
P=(x,a-x). It compares the three triangles using sorted squared side lengths
and exact cross-products, counting each triple once even if several P work.
It uses neither primitive u/v pairs, gcd enumeration nor the two-family
parametrization. It independently recovers the published 92 triples below 100.

**1600 comparisons passed**: all limits 1..100, eight variants (original,
native, symmetry, vector, hybrid, lazy, eager, squares), both compiled/reference.
Both published companion checks and the unchanged full golden are asserted by
the benchmark harness where applicable. Every repeated full sample preserves
549936643. The full answer is agreement with the existing golden and variants;
it is not a separate full-bound geometric enumeration.

The full compiled answer is already in full-scale-demos.test.ts. Following
implementation, extend strict-boundary fixture cases, run scoped differential,
type and name-facts checks for both full files, and reassess removing the full
reference exclusions now that the scalar run completes in about 17 seconds.
No full suites or unfiltered audits were started for this research.

```
python3 benchmarks/experiments/euler299-oracle.py
node benchmarks/experiments/euler299-verify.mjs
node benchmarks/experiments/euler299-samples.mjs
DIAGNOSTICS=1 node benchmarks/euler299-investigation.mjs compiled symmetry
```

Raw oracle, samples, diagnostics and the timed-out full reference control are
saved as `benchmarks/baselines/2026-10-31-euler299-*.json`.


## Private numeric vector stages

Following the request to improve array compilation itself, the local compiler
first lowered rank-one eager integer array stages into one speculative Number
region: dynamic materialized ranges, simple boolean-mask filters, pointwise
arithmetic/comparisons/native gcd, and sum consumers. Scalar subexpressions
are evaluated once, including for empty arrays. Unsupported expressions keep
the existing compiler/evaluator paths; native unbound range sums remain native.

Each ordinary `=` still completes an array before its next statement. Fusion
happens within an expression or its filter/reduction consumer. No stage is
moved across ordinary binding boundaries, and unused deferred plans remain
unused. Division failures, incompatible shapes and unsafe integer results
replay the original region, retaining exact arithmetic and ordinary error
order. Cancellation only publishes completed bindings.

Private arrays begin with Int32 storage and widen to Float64 without truncating
values. A per-invocation buffer pool reuses only storage no longer retained by
a binding, alias, previous result or current operand. Published values never
return to the pool. This avoids retaining every obsolete DP/vector version
without changing observable value semantics. It does not remove all ordinary
array materializations. These measurements cover the first rank-one version;
the subsequent multidimensional/real extension and backend selection are
documented in [numeric-array-stages-results.md](numeric-array-stages-results.md).
That report also records the concurrent base changes; later working-tree
measurements against 40adaba7 include those changes and do not isolate this
patch's entire performance or memory effect.

Matched serial measurements against the archived 40adaba7 runtime, three fresh
processes per case, rotating order, full Limit=100000000:

| Version / variant | Median | Range | Peak RSS median |
| --- | ---: | ---: | ---: |
| Baseline compiler, array variant | 1.360 s | 1.330–3.310 s | 598.7 MiB |
| New compiler, same array source | 1.028 s | 0.792–1.356 s | 175.2 MiB |
| New compiler, optimized scalar variant | 0.647 s | 0.626–0.756 s | 151.7 MiB |
| Reference, array variant | 1.445 s | 1.340–1.949 s | 665.8 MiB |
| Baseline compiler, original source | 3.478 s | 2.295–4.135 s | 143.8 MiB |

The same array program improves about 1.3x by medians and reduces process peak
RSS about 71%. It is about 1.6x slower than the optimized scalar loop here;
the best array sample is about 1.2x the scalar median, but host variability is
too large to promise that ratio. Earlier ~0.8-second samples were exploratory.
These are macOS/Node results, not an Intel measurement or a general speedup
claim. The production demo remains unchanged so the compiler and algorithm
comparisons stay separable.

Full vector diagnostics now report one compiled Number loop, zero compiled
tensor kernels, zero mask materializations, and zero Number overflows. The
full answer remains 549936643. Validation: ordinary interpreter suite 447 files /
10244 tests passed with exhaustive audits excluded; 26 focused vector tests
cover aliases, widening, replay, empty/singleton broadcasts, shadowed gcd,
deferred bindings and demand budgets. TypeScript project build passed. The
geometry oracle checks all 1600 variant/mode/bound combinations independently.

Reproduce the compiler comparison after building both interpreter versions:

```
node benchmarks/experiments/euler299-vector-samples.mjs /absolute/baseline/packages/interpreter/out/index.js
```

Raw matched samples: `baselines/2026-10-31-euler299-vector-compiler.json`.
