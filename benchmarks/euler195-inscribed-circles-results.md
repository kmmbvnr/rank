# Euler 195 optimization

Measured against `f9e7fe91d025d5dff05fe8e1a8daae82b6ee1260` on Apple M5,
macOS arm64, Node v24.15.0. The Rank demo keeps its array/filter/sum form.
The default limit, answer, fixture assertions and execution lanes are unchanged.

| Full default, Limit=1053779 | Median execution | Median peak RSS |
| --- | ---: | ---: |
| Original source, baseline runtime | 13.326 s | 808.3 MiB |
| Table-free source, baseline runtime | 5.424 s | 454.0 MiB |
| Same table-free source, new runtime | **0.808 s** | **444.1 MiB** |

Three serial fresh processes per variant, with alternating forward/reverse order.
Ranges: original 12.821–14.009 s, table-free baseline 5.367–5.938 s, optimized
0.806–0.825 s. This measures 16.5x overall acceleration; runtime changes account
for another 6.72x on the same table-free source. Most peak-memory savings come
from removing the tables. RSS is whole-process peak and varies with GC; it is
not retained memory or allocated-byte accounting.

Timers include interpreter construction, parse, compilation and execution;
imports, answer assertions, oracle and disposal are excluded. Samples ran in a
clean archive of the baseline plus only these changes, with separate dependencies
and generated parser: unrelated ML/grammar/mobile work was in progress in the
shared workspace. The baseline runtime was copied before this implementation.

Separate single correctness observations: new main reference 6.124 s, new fixture
1.115 s compiled / 7.114 s reference. These are not repeated medians. The existing
fixture still executes the full default once and all three statement values.

## Exact source simplification

For positive q, `isqrt(C*C // (3*q*q))` is exactly `Q // q`, where the program
already computes `Q = isqrt(C*C // 3)`. For any integer k >= 0, either count is at
least k precisely when `3*(k*q)^2 <= C*C`. No floating-point approximation is
introduced. Both large tables and their input/construction stages are removed;
`Tb (Qv - 1)` becomes `Qb // Qv`, likewise Ta/Qa. The primitive pair enumeration,
gcd predicates, two outer loops and deferred array stages remain.

## General runtime changes

- Native integer/boolean recipe graphs can feed mask-position construction and
  selected-value summation using private, checked Number registers. Only stored
  integer inputs and supported native operations qualify. Shape/rank/broadcast,
  reader/revision and compilation-policy guards retain ordinary fallback.
- The mask is still computed and validated before any selected source values are
  read. Its selected positions are snapshotted as before. The sum then streams
  only those source positions; it does not complete the full value array.
- Integer overflow or unsafe conversion discards the private consumer state and
  repeats the demand using ordinary exact arithmetic. Zero divisors likewise
  retain ordinary error reporting. Partial sums/positions are never published.
- Uniform scalar-kind contracts are checked at their first actual cell. This
  reuses the existing internal scalar-check capability; index-dependent checks,
  callbacks, foreign readers and unsupported layouts retain ordinary execution.
  Unused plans stay unevaluated and repeated demands do not cache results.
- Stored integer gcd maps use checked Number Euclid with compact output when it
  fits Int32; unsafe inputs or wider results retain exact arithmetic. Native
  identity guards remain in the existing ranked-call dispatcher.

Separate full diagnostics: `numberTensors=4750`, `compiledTensors=4750`,
`cellsComputed=8398`, `typedUnpacks=0`. Original diagnostic execution computed
169,461,099 ordinary cells; table removal alone left 72,742,983. The surrounding
array loops still use ordinary execution: `compiledLoops=0`. The implementation
accelerates their consumers and gcd maps, and does not claim whole-loop lowering.
Candidate arrays, completed gcd arrays and selected-position storage still exist.

## Correctness

Both engines return **75085391**. Ten smaller limits (1, 2, 3, 5, 10, 20, 50,
100, 1000, 10000) agree in both engines, including all statement values. An
independent direct triangle oracle checks the six bounds up to 20 in both engines.
It enumerates unequal sides a < b adjacent to 60 degrees, checks
`c*c = a*a + b*b - a*b`, then the exact squared inradius inequality
`3*a*a*b*b <= 4*Limit*Limit*(a+b+c)^2`.

Enumeration bounds follow independently: the perimeter is at most 3b, giving
`a*a <= 12*Limit*Limit`; factoring
`(2c-(2b-a))*(2c+(2b-a)) = 3a*a` gives
`b <= floor((3a*a+2a-1)/4)`. The earlier investigation additionally compared three
source forms and both engines on these inputs; its raw results remain separate.

Focused regression coverage includes signed division/modulo, mixed real fallback,
empty/fully filtered domains, mask shape/type errors, errors in masks versus
unselected source cells, unsafe intermediates and sums, integers beyond Number
and Int64, snapshots and ordinary completion, repeated demands, opaque read order,
replaced selection iteration, cancellation and wide/minimum-Int32 gcd.

Verification passes: parser generation and TypeScript build, test typecheck,
semantic-boundary checks (65 owners), application-form checks, 327 focused tests,
**9,053/9,053 ordinary interpreter tests across 400 files**, and four scoped
type/differential checks for the full main and fixture. The broad selection
excludes exhaustive types, the full differential corpus and Nurikabe; Euler 195
has its own scoped checks. A first four-worker run had three simultaneous
5-second test timeouts during a roughly 44-second delay and one obsolete exact
kernel-count assertion. The focused rerun and final two-worker broad run pass;
no test deadlines or execution-lane settings were changed.

## Reproduction

After building, run each timing sample in a fresh process:

```sh
node benchmarks/euler195-inscribed-circles.mjs
node benchmarks/euler195-inscribed-circles.mjs --reference
node benchmarks/euler195-inscribed-circles.mjs --fixture
node benchmarks/euler195-inscribed-circles.mjs --fixture --reference
node benchmarks/euler195-inscribed-circles.mjs --diag --phases
node benchmarks/euler195-inscribed-circles.mjs --limit=20 --oracle --reference
```

`--runtime=/absolute/path/to/baseline/out/index.js` selects a built baseline;
`--source=benchmarks/fixtures/195-inscribedcircles-original.ra` restores the
original workload. The benchmark also retains the earlier quotient/scalar control
variants. They are experimental source rewrites, not alternate shipped demos.

[Implementation measurements and source snapshots](baselines/2026-10-27-euler195-optimization.json).
[Earlier investigation and independent source controls](baselines/2026-10-27-euler195-investigation.json).
