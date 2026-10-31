# Euler 296 investigation

Baseline: `ec840d4fd7c10743c7673cf5e9a145b31a6b49c2`.
Selected from the live unfinished rows of issue #447 after 295. The earlier
248 row is already explicitly completed, although it uses a different marker.
The shipping demo now adopts the pruned/native scalar variant below.
The fixture adds first-feasible/empty perimeter checks, and a full compiled
golden assertion is included in `full-scale-demos.test.ts`. Compiler code
is unchanged; the full reference exclusion is retained with an updated reason.

Problem: https://projecteuler.net/problem=296
The full input is perimeter <= 100000. The existing program returns
**1137208419**, preserved by every completed full-input variant below.

## Shipping change

Keep the existing parametrization and scalar count. Before computing gcd,
restrict P using the necessary condition that its T interval is nonempty:

```
Room = Limit // S
Top = (Room - 1) // 2
Low = (S + Top) // (Top + 1)
for P in Low to (S // 2)
  if S gcd P equal 1
    ... existing count ...
```

For Q = S-P, the lower T bound is ceil(Q/P). It can be <= Top only when
S-P <= Top*P, or P >= ceil(S/(Top+1)). This is exact integer pruning,
including empty intervals and small inputs; it does not approximate geometry.
Use the existing `numbers.gcd` instead of the handwritten Euclidean loop.
At Limit=100000 this reduces gcd candidates from 277772222 to 48226353.

## Repeated serial measurements

Node v24.15.0, macOS arm64. Three fresh processes per row, run serially without
other research processes. Host load is uncontrolled. Times include parsing and
execution, omit Node startup, and do not enable diagnostics. Different bounds
in the compiled/reference columns are deliberate: do not compare them as a
compiled/reference speed ratio.

| Variant | Full compiled, Limit=100000 | Reference, Limit=10000 |
| --- | ---: | ---: |
| Original | 19.549 s (17.300-19.606) | 9.214 s (9.108-9.319) |
| Prune P only | 4.254 s (4.246-4.262) | 2.121 s (2.112-2.121) |
| Prune P + builtin gcd | **2.498 s** (2.401-2.515) | **1.334 s** (1.316-1.347) |

Thus the recommended variant improves full compiled time about 7.8x and the
measured smaller reference workload about 6.9x. Full compiled peak RSS stays
around 160 MiB. Reference peak RSS on Limit=10000 drops from about 426 to
379 MiB. RSS is process peak, not retained program storage.

A full-input reference run of the recommended variant exceeded a 45-second
exploratory budget and was terminated. The original full reference was not
rerun for minutes. The original exclusion said it exceeded five minutes;
that historical number is not a new measurement. Its reason now records the
measured 45-second investigation budget and the new compiled golden. Keep the reference exclusion
unless subsequent delivery work establishes a suitable full reference budget.
A full compiled golden assertion has been added to
`full-scale-demos.test.ts`; bounded cross-mode fixture checks remain.

## Compiler and reference findings

At Limit=1000 the original and recommended scalar programs execute as one
Number region with no overflow or compiler rejection. The recommended full
input also executes as one Number region, without overflow or array copies.
There is no missing scalar compilation path to repair here. A large part of
the cost is avoidable enumeration plus the handwritten gcd implementation.
The reference evaluates the scalar loop bodies and exact integer operations;
pruning and the native gcd help it without requiring JIT execution.

There is a general compiler opportunity in the array alternative, but it is
separate from the best measured demo change. At Limit=1000 the `sums` variant
records `loop:unsupported-node:MaterializeExpression`,
`tensor:unsupported-node:TableFilterExpression`, `loop:unsupported-op:sum`
and repeated `tensor:scalar-evaluation-timing` fallbacks. It executes no
compiled loops. `emitIntegerSum` in `integer-loop-expressions.ts` currently
fuses only total pointwise `+`, `-`, `*` expressions. Division is deliberately
excluded to preserve ordinary array evaluation/error order. Supporting this
case needs dynamic local arrays/filter handling and a reduction strategy that
preserves division/error timing; simply extending an operator whitelist is
not justified by this experiment.

## Other prototypes (exploratory single samples)

These are not repeated medians. Some early runs overlapped the independent
verification, so they are suitable for rejecting large regressions, not small
performance claims.

- `native`: builtin gcd alone, full compiled 9.099 s.
- `vector`: filter a coprime P vector, then retain the scalar count. Full
  compiled 3.945 s / 671 MiB; full reference exceeded 45 s.
- `sums`: for each S, prepare coprime Ps, Qs=S-Ps; sum
  `min(T*Ps//Qs, Room-2*T)` over Ps for every T=1..Top. Terms before the
  original From are zero, so the count is equivalent. Full compiled
  11.893 s / 1595 MiB; full reference 12.905 s / 2028 MiB. This reduces
  reference dispatch, but its allocation/memory cost and compiled regression
  make it an unattractive default.
- `prefix`: hybrid scalar counting for S <= isqrt(Limit), otherwise prefix
  sums of a coprimality mask. Count each level K by P >= ceil(K*S/(T+K)).
  Full compiled 13.351 s / 855 MiB, reference 14.880 s / 1251 MiB. No win.

The scalar pruned/native variant is the preferred production candidate.
None of these experiments changes compiler thresholds or numeric semantics.

## Verification and reproduction

`euler296-verify.py` checks six variants (original, pruned, combined, vector,
sums, shipping), both modes, and 20 perimeter bounds:
0,1,2,3,4,5,6,7,9,10,11,20,29,30,31,50,99,100,101,200.
**240 checks passed.** The oracle enumerates sorted integer sides a<=b<=c,
requires a+b>c and perimeter<=Limit, and tests `(a*c) % (a+b) == 0`.
It is independent of the primitive-pair/counting parametrization, while
sharing the geometric BE formula. The full answer is a preserved baseline
with agreement across variants, not a separate full geometric oracle.
The prefix exploratory variant was not included in the small oracle sweep.

```
node benchmarks/euler296-investigation.mjs compiled combined 100000
node benchmarks/euler296-investigation.mjs reference combined 10000
DIAGNOSTICS=1 node benchmarks/euler296-investigation.mjs compiled combined
python3 benchmarks/experiments/euler296-repeat.py
python3 benchmarks/experiments/euler296-verify.py
```

Raw repeated samples, diagnostics, verification and exploratory runs are in
`benchmarks/baselines/2026-10-31-euler296-*.json`. No full suites or exhaustive
audits were started during research.

## Delivery checks

Scoped package-script tests passed: full compiled golden, fixture differential,
fixture inferred types (3 interpreter tests), and fixture name facts (1 common
test). The differential run completed both fixture blocks. The full golden
checks one or more Number loops and zero Number overflows. Full suites and
unfiltered audits were not run.

`euler296-original.ra` preserves the baseline for reproducible comparisons;
`shipping` selects the real demo in the investigation harness. The delivery
harness executes the real source/fixture with module loading and validates the
full answer or both test blocks. It omits diagnostic instrumentation.

Three additional serial fresh-process samples of the final shipping source:
full compiled median **2.634 s** (2.426-2.888 s), fixture compiled median
**0.120 s**, fixture reference median **0.127 s**. The full answer and both
fixture blocks passed in every sample. These are final-source confirmation
samples, separate from the controlled original/prototype comparison above.
The updated exclusion reason also passed all 3 exclusion-policy script tests.
