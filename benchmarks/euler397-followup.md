# Euler 397: delivery and investigation

## Delivered implementation

Integrated on `9b78d09b` (its changes since the investigation baseline are ACMP
files only). `integer-loop.ts` now tries exact output registers before the broad
mixed tier for ordinary loops and fresh-array function prefixes. The broad tier
is compiled lazily only if needed; the original publishing backend remains the
last fallback. This is a general AST read-use policy, with no Euler names or
new thresholds. Checked Number arithmetic, private storage, polling and error
publication rules are unchanged.

The delivered demo uses the pruned formulas and 8008-cell buffer. The strict
D/U guards also prove nonzero denominators and A<B<C: T>S follows from
D+U>2*N, while each guarded quotient has V>T. Therefore B need not be computed
and the duplicate ordering tests are removed. The direct geometry oracle checks
this final source separately. All production Rank lines fit 40 columns.

Fresh-process delivery confirmation (three samples per row):

| Host / workload | Delivered seconds | Broad-tier control seconds | Delivered RSS MiB | Control RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac, full compiled | 3.655 | 22.351 | 204.9 | 214.1 |
| Intel, K=100000 compiled | 1.640 | 5.930 | 209.0 | 221.6 |
| Intel, full compiled | 8.825 | not repeated | 217.9 | — |
| Mac, K=10000 reference | 3.516 | — | 322.0 | — |
| Intel, K=1000 reference | 1.061 | — | 179.3 | — |

The paired control uses the same delivered demo and runtime, disabling only
output-first selection through `experiments/euler397-broad-control.mjs`. On Mac
the isolated compiler speedup is 6.12x. Against the original program's earlier
three-run median, the final Mac time is 30.117 -> 3.655 s and RSS 308.6 ->
204.9 MiB. Original Intel full input had one sample, 78.596 s /268.9 MiB; do
not present its ratio to the delivered three-run median as a precise estimate.
The earlier reduced Intel research prototype's RSS increase did not recur in
this paired delivery series; no claim of universal RSS reduction is made.

Nine other demos were compared three times each with output-first selection
on/off: 393, 185, 275(N=12), 283(Top=30), 324(Exp=500000), 337(Limit=10000),
391(Limit=100), 362(Limit=100000), 364(N=10000). All answers matched. Median
time ratios were 0.985–1.015, insufficient evidence of a meaningful regression
or speedup on those controls. These cases do not cover all possible programs;
programs whose intermediates also overflow may incur one extra rejected tier.

Validation:

- 777 tests in 28 files passed on Mac and the same 777 on Intel, including
  numeric loops/functions, 393/397 full goldens, Euler 337, capabilities,
  array compilation, return preparation, inspection and interruption.
- Added tests cover output accumulation, intermediate overflow through both
  mixed tiers, private array/index rollback, COW aliases, cached calls with
  changing inputs, exact store fallback, errors, function prefixes and budgets.
  Two prior diagnostic-counter assertions now count the additional rejected
  tier; their reference/exact result comparisons remain unchanged.
- Full Euler 283 exact-wide search passed separately on Mac.
- 96 standalone result comparisons per host: final/original/pruned/compact
  sources in both engines, independent geometric oracle for small inputs,
  X=10^20; buffer bound checked independently for all one million inputs.
- TypeScript build and interpreter-test typecheck, 65 semantic owners,
  application-form checks, syntax and whitespace checks passed. No full suite
  or exhaustive corpus audits were run. The default reference corpus exclusion
  remains: the reduced reference improvement does not make 101 million
  interpreted divisor visits suitable for the shared audit.

Raw delivery samples and hashes: `baselines/2026-11-04-euler397-delivery.json`.
Run `experiments/euler397-delivery-series.py` from the repository root for Mac
confirmation, and `euler397-controls.py PATH` for other-demo controls. The
original narrow-only research loader below is for the baseline investigation,
not the delivered policy: it removes the broad-tier fallback.

## Earlier investigation (before implementation)

Baseline: `08df1964fe25868de4468789fdc48d6d7fb3ca12`, remote main checked
2026-11-04. The shared original checkout was stale and had another session's
work, so this investigation uses `/tmp/rank393-delivery` at that revision.
At this investigation stage production interpreter and demo files were unchanged;
the following variants and narrow-only loader were experimental controls.

Issue #447 still lists `397_parabola.ra` as unfinished. The older #395 work
already put the entire divisor traversal in one compiled region. This is not
a missing-compilation case. The existing algorithm visits 101,394,686 divisors
at the default K=10^6, X=10^9; its final answer is 141630459461893728.
Problem: https://projecteuler.net/problem=397

## Main compiler finding

On safe-Number overflow, `jit/integer-loop-wide.ts::wideLoopScalars` widens
nearly all scalar values that are not required for iteration/index geometry.
For this program that includes D0, D, U, S, T, bounds, corrections and Total,
although the final Answer is the value that actually needs wide accumulation.
This spends BigInt arithmetic throughout the hot 101-million-element loop.

The research loader `experiments/euler397-wide-sink.mjs` further restricts the
existing candidate set to names with no explicit NameExpression read inside
the region. Compound assignments have an implicit self-read, so an accumulator
such as `Answer += Total` qualifies. There are no Euler-specific variable names
in the selector. It leaves normal checked Number operations everywhere else.

This is a proof of opportunity, not a finished general compiler policy. It
replaces the normal broad mixed-tier selector in memory. Production should
try this narrower tier before the existing broad mixed tier, retaining private
state, checked operations, exact replay, polling and publication rules. Removing
the existing fallback would penalize programs with wide intermediate values.
Tests must cover intermediate overflow, predicates, writes, inspection/turbo,
wide entry inputs, cancellation and rollback, plus other demo workloads.

## Program findings

Two corrections currently form products of magnitude up to 2*N^3. With
D0=2*N*N, U=D0/D, the same exact tests and quotients can use smaller operands:

- Den=2*N-U: -N*U = N*Den-D0. Divisibility is D0 mod Den=0;
  the quotient is N-D0//Den.
- Den=2*N-D: N*D = D0-N*Den. The quotient is D0//Den-N.

Zero denominators remain guarded. The compact variant retains the original
Side loop and replaces these formulas, plus the buffer allocation.

The pruned variant also expands the two correction cases and rejects impossible
ordering before the remainder test. The first correction requires U>2*N and
the second D<2*N. For example, if U<2*N the first required inequality V>T
would imply D+U<2*N, impossible since D*U=2*N*N. Denominator equality is already
invalid. The second case with D>2*N gives V<-N<T. The full divisor enumeration
remains; this is a constant-factor improvement, not a new asymptotic algorithm.

Buffer size need not be 2*K+2. For N=2^a times odd prime powers,

    tau(2*N*N) = (2*a+2) product(2*e+1) < 8 sqrt(N).

Proof: the ratio to sqrt(N) is bounded by 3 for prime 2, sqrt(3) for prime 3,
3/sqrt(5) for prime 5 and 3/sqrt(7) for prime 7. For every prime >=11 its
factor is at most 1. These follow by checking exponent 0 and 1 (also 2 for
prime 2), after which consecutive ratios decrease. Their product is
27*sqrt(3/35)<8. Thus `8 * (K isqrt + 1)` cells suffice. At K=10^6 this is
8008 cells instead of 2000002, ~64 KiB rather than ~16 MB for Float64 storage.
The independently computed maximum is 4050 at N=720720. The buffer is not
sorted and is reused as before.

## Mac measurements

Apple M5, Node v24.15.0, fresh process per sample, parsing and execution timed;
module import is outside timing. Three samples per row. Processes for this
series were sequential. The development machine is shared, so results are not
latency guarantees. RSS is process peak, including startup, parsing and JIT.

| Default compiled workload | Median seconds | Range | Peak RSS median MiB |
| --- | ---: | ---: | ---: |
| Original | 30.117 | 29.984–30.793 | 308.6 |
| Pruned program, existing compiler | 24.714 | 24.395–25.140 | 233.0 |
| Pruned program, narrow-wide prototype | 3.573 | 3.564–4.103 | 227.9 |
| Compact program, narrow-wide prototype | 4.825 | 4.772–4.936 | 200.2 |
| Manual JS, same pruned divisor algorithm | 2.398 | 2.378–2.399 | 56.0 |

The first-to-third ratio is 8.43x. The isolated compiler comparison on the same
pruned source is 6.92x. The compact source is an alternative if retaining the
Side loop and a lower measured RSS matters more than the additional ~1.25 s.
The manual JS keeps per-N totals as checked Numbers and accumulates the final
answer in BigInt; it is a default-input control, not a general arbitrary-integer
Rank implementation. It has no interpreter/parser/module or inspection costs,
so its RSS is not a like-for-like runtime memory comparison.

Reference at K=10000 (not the full workload):

| Program | Median seconds | Range | Peak RSS median MiB |
| --- | ---: | ---: | ---: |
| Original | 6.294 | 5.046–6.431 | 447.5 |
| Pruned | 3.965 | 3.850–3.975 | 325.1 |

A separate reference CPU profile at K=10000 shows prepared expression/name
reads, assignments, binding/frame lookup, loop execution and range construction
spread across the hot path. It does not identify GC as the primary cost.
The full reference input was not run or extrapolated as a measured result.
The historical 16-second #395 compiled result was on another revision/date;
this investigation does not establish the cause of any regression from it.

## Intel measurements

Intel Core i7-10750H, Node v24.15.0, Linux x64, verified through the saved SSH
endpoint. Runtime snapshot `/tmp/rank393-final-20261104` corresponds to the
same integrated source as the Mac baseline. Three sequential fresh samples,
K=100000 for compiled rows and K=1000 for reference rows:

| Workload | Program / compiler | Median seconds | Peak RSS median MiB |
| --- | --- | ---: | ---: |
| Compiled | Original | 7.384 | 213.5 |
| Compiled | Pruned / existing | 6.109 | 207.3 |
| Compiled | Pruned / narrow-wide prototype | 1.584 | 226.8 |
| Reference | Original | 1.448 | 213.1 |
| Reference | Pruned | 1.043 | 178.9 |

The reduced compiled prototype raises median RSS ~13 MiB versus original;
it is incorrect to claim the compiler selector always lowers process memory.
Buffer storage savings are deterministic, while process peak includes several
compiled kernel variants and runtime allocations.

Full Intel input: original 78.596 s /268.9 MiB, pruned with existing compiler
64.428 s /223.3 MiB (one sample each). First narrow-wide prototype run:
8.937 s /223.5 MiB, correct full answer. Two confirmation runs took 9.075 and 8.799 s. The three-run prototype median
is 8.937 s /223.5 MiB. Compact prototype: 10.846 s /214.4 MiB; manual JS:
2.033 s /57.5 MiB (one Intel run each). Full baseline values have only one
sample and do not establish a precise speedup ratio.

Raw samples, source hashes and verification summaries:
`baselines/2026-11-04-euler397-followup.json`.

## Verification and reproduction

- `experiments/euler397-verify.mjs`: 72 result comparisons per invocation:
  original/pruned/compact, both engines, direct geometry enumeration on small
  inputs, empty domains, published examples and X=10^20. Ran normally and with
  the prototype on Mac; the same 72 comparisons also ran with the prototype on Intel.
- Independently verifies the buffer bound for every N=1..1000000.
- Existing independent C++ four-count oracle returns 141630459461893728.
- Every timed known-bound run has that bound's expected answer. The harness
  now asserts the known values for future reproduction.
- No full package suite or exhaustive corpus audit was run; production is
  untouched. This is not a generic compiler regression-test claim.

With baseline build output present:

    node benchmarks/euler397-followup.mjs 1000000 compiled benchmarks/experiments/euler397-original.ra
    node benchmarks/euler397-followup.mjs 1000000 compiled benchmarks/experiments/euler397-pruned.ra
    SINK=1 node --import ./benchmarks/experiments/euler397-wide-sink.mjs benchmarks/euler397-followup.mjs 1000000 compiled benchmarks/experiments/euler397-pruned.ra
    node benchmarks/experiments/euler397-verify.mjs
    node --import ./benchmarks/experiments/euler397-wide-sink.mjs benchmarks/experiments/euler397-verify.mjs
    node benchmarks/experiments/euler397-direct.mjs

The loader asserts its target string is present. It does not write emitted JS
or production TypeScript files. PROFILE and DIAG enable separately instrumented
runs; those exploratory runs are not part of the confirmation timing medians.
