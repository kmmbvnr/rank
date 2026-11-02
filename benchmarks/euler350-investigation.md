# Euler 350: constrained gcd/lcm tuples

Initial research on 2026-11-03, baseline `2d406976`, Node 24.15.0.
The delivery below implements the selected program/compiler changes and
returns the complete main/default fixture to corpus execution.

## What is slow

The mathematical algorithm is appropriate. Normalize a tuple by its gcd d.
For normalized lcm m = product p^e and tuple length N, the local count is
(e+1)^N - 2e^N + (e-1)^N. These counts multiply over primes. There are
floor(L/m)-G+1 possible d for m <= L/G. Thus only Top=L/G=1000000 integers
are sieved/factored at the default; N=10^18 is handled by modular powers,
not by iterating the tuple positions. The complete answer is **84664213**.

The loops already compile. Diagnostics show a speculative Number overflow
and a mixed exact/Number fallback for products, rather than an interpreter-only
hot loop. Mod=101^4=104060401; multiplying two residues can exceed the Number
safe-integer range, and H*(L//M-G+1) can be much wider. The exact fallback is
correct and must remain. Reference dispatch and per-cell factorization account
for most of the compiled/reference gap.

The manual smallest-prime-factor sieve can use the existing `factorsieve`.
It is particularly useful for reference memory and execution. However, that
builtin accepts only 0..1048575, a documented implementation bound associated
with the retained 4 MiB factorization table. An unconditional replacement would
reject larger Top values previously handled by the demo. The guarded research
variants retain the original sieve above that bound, and pass boundary checks.
A future implementation may instead separate larger owned sieve snapshots
from the bounded factorization cache, but that would be a distinct library API
extension; it is not needed to change the current default.

## General compiler opportunity

The experimental Number loop lowering recognizes integer A*B mod M before
emitting the unsafe product. It freezes the three operands in source order.
Safe products retain the normal signed floor remainder path. Wider products
use reduced operands and the same quotient/Math.imul identity already used by
`runtime/modular-power.ts`, for 0<M<=2^30. Outside that domain it replays exactly.
There is no precision threshold increase and no Euler-specific recognition.

The program control adds `Term = H * W mod Mod` before accumulating, so its
accumulator never needs a wide integer. This ordinary binding remains present;
the compiler only fuses arithmetic inside each complete expression.

V1 always used the limb formula. It helped 350 but slowed a small-modulus
recurrence from roughly 102 to 177 ms in an initial probe. V2 keeps the safe
product path and is the recommended prototype. In three later controls, median
small-modulus timings were 94.5/92.9 ms on Mac and 246.3/250.5 ms on Intel
(baseline/V2). Their ranges overlap; no universal speedup is claimed.
The prototype is an isolated emitted-JavaScript patch, not a shipped compiler
change. Production implementation still needs callback/evaluation-order,
array-write replay, cancellation and broader modular-workload regressions.
It should reuse the existing arithmetic primitive rather than create another
independent modular multiplication implementation.

## Measurements

Five alternating serial fresh-process compiled trials per variant/host were
run after the exploratory series. Medians include parse/preparation/execution,
exclude imports/startup. RSS is whole-process peak, not retained storage.
External load was not controlled; Mac timings varied noticeably between series.

| Host | Original s | Guarded library s | Guarded library + V2 + reduced term s |
| --- | ---: | ---: | ---: |
| Mac arm64 | 0.286 | 0.277 | 0.208 |
| Intel x86_64 | 0.818 | 0.798 | 0.521 |

| Host | Original MiB | Guarded library MiB | Guarded library + V2 + reduced term MiB |
| --- | ---: | ---: | ---: |
| Mac arm64 | 186.8 | 187.8 | 172.3 |
| Intel x86_64 | 173.3 | 172.5 | 162.8 |

The combined prototype is about 27% / 36% faster than original on Mac / Intel,
with about 14.5 / 10.5 MiB less peak RSS. A diagnostic full run uses one Number
loop, no Number overflow, and no mixed integer loop. The earlier V1 best times
must not be substituted for the safer V2 results.

Reference controls (three fresh trials) establish a separate library benefit:

| Host | Original s / MiB | Library s / MiB | Reduced term + library s / MiB |
| --- | ---: | ---: | ---: |
| Mac | 7.191 / 290.8 | 6.837 / 185.3 | 6.035 / 185.6 |
| Intel | 23.134 / 273.2 | 16.902 / 172.9 | 17.854 / 173.1 |

Those initial default controls used the direct library path, before adding its
domain guard. A later guarded-library reference series gives 6.632 s / 188.5 MiB
on Mac and 17.298 s / 175.3 MiB on Intel. The compiler patch does not alter the
reference engine. Extra term reduction slightly costs Intel reference time
relative to library alone, while still beating the original program. Do not
claim reference improvements from the compiler patch.

Every full timed process asserts the golden answer. The initial Mac series
overlapped a small verification run; the later five-round compiled series is
the comparison basis for V2. Raw samples are retained without mixing series.

## Verification

The independent oracle enumerates ordered tuples, computes gcd/lcm, and counts
those satisfying the bounds. It covers all 1<=G<=L<=12 and N=1..4, plus G>L:
315 cases across five variants and both engines = 3150 comparisons per runtime.
They pass against stock and V2 on Mac, and against V2 on Intel.

729 signed modular-product cases per host cover safe-Number operand extremes,
negative/zero moduli, and the boundaries around 2^30, checked against BigInt
floor-remainder arithmetic. Positive admitted moduli must complete without
Number overflow; the verifier checks that as well as the numeric answer.
Nine N=1 checks per host compare original and guarded variants at Top=1048575,
1048576 and 1100000, using the independent result L-G+1.
The existing small/default CLI fixtures are retained. No full test suite or
exhaustive audit was run for this research-only prototype.

## Reproduction

```sh
RANK350_RUNTIME=/absolute/stock/packages/interpreter/out/index.js \
  node benchmarks/euler350-investigation.mjs demos/euler/350_constraining.ra compiled
RANK350_RUNTIME=/absolute/stock/packages/interpreter/out/index.js \
  node benchmarks/euler350-verify.mjs
```

Copy a matching emitted runtime to an isolated directory. Apply the zero-context
`experiments/euler350-modular-v2.patch` there (`git apply --unidiff-zero`, with
paths rooted at the directory containing `out`). Run the guarded reduced source:

```sh
RANK350_RUNTIME=/absolute/prototype/out/index.js \
  node benchmarks/euler350-investigation.mjs \
    benchmarks/experiments/euler350-guarded-reduced.ra compiled
RANK350_RUNTIME=/absolute/prototype/out/index.js \
  node benchmarks/euler350-modular-verify.mjs
RANK350_RUNTIME=/absolute/prototype/out/index.js \
  node benchmarks/euler350-bounds.mjs
```

Repeat each timing in fresh processes and alternate variants. The worker's
third argument is G (default 1000000), keeping L and N at their original defaults.
Do not lower G casually: that increases Top and the workload. Optional `diag`
follows G. `RANK350_KERNEL_OUTPUT` saves generated diagnostic kernels.
Raw records: `baselines/2026-11-03-euler350-investigation.json`.


## Delivery verification

The production demo uses the guarded library sieve and reduces each summand
before accumulation. All Rank lines are at most 40 characters. Inputs and the
full golden assertion remain unchanged; the small fixture adds boundary cases.
The Number loop compiler retains its safe product path, and calls the existing
`runtime/modular-power.ts` primitive for admitted wide products. Negative/wide
moduli and unsafe inputs retain exact replay. Vector errors replay before
publishing partial writes. No precision or compiler-admission budget is raised.

626 focused tests pass across twelve files, including 729 modular-product
combinations, independent tuple enumeration, large sieve boundaries, opaque
operand demand order, private-write replay, vector RHS failures, cancellation,
and the full checksum. Six scoped type/differential checks pass for the main,
full-default and small fixture; the two full differential comparisons take
about 13-14 seconds each on Mac. Both full workloads are removed from execution
exclusions. CLI small/default fixtures, seven audit infrastructure tests,
semantic/application boundaries, Langium generation and TypeScript build pass.
No full suite or exhaustive audit was run.

Delivery standalone verification passes on Mac and Intel: 3780 oracle comparisons
across six sources and both engines, 729 signed modular cases without overflow
for admitted moduli, and twelve large-bound checks including the delivered
source. Every full benchmark checks 84664213.

Three alternating serial fresh-process samples per mode and variant/host:

| Host/mode | Before s | Delivered s | Before MiB | Delivered MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac compiled | 0.259 | 0.202 | 186.8 | 175.8 |
| Intel compiled | 0.815 | 0.527 | 172.2 | 171.3 |
| Mac reference | 7.779 | 6.605 | 290.7 | 187.6 |
| Intel reference | 23.125 | 17.542 | 272.6 | 175.7 |

Raw delivery samples are appended separately to the baseline JSON. External
load was not controlled; the first Mac compiled pair overlapped a short audit
infrastructure check. Compiled peak memory does not materially grow, and the
reference peak falls by roughly 100 MiB. Final controls use the production
runtime helper and source, rather than the inline emitted-JavaScript prototype.

The broader checks also exposed four existing escaping self-slice result
failures, reproduced before both this work and the Euler 343 cache change.
Separate commit `3acbc580` retains ordinary execution when a returned self-slice
must follow a binding after COW. Existing alias/result assertions now pass;
the numeric results of Euler 350 do not depend on that repair. The old modular
overflow regression now uses a modulus beyond 2^30 so it still exercises replay;
admitted wide products are explicitly required not to overflow in the new test.

The delivery is rebased onto concurrent Euler 644 commit `7c08c400`; 741 focused
modular/loop and axis tests pass on the integrated source before push.
