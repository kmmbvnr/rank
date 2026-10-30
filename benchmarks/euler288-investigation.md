# Euler 288 investigation

Investigated at `11709fa5b67a0f44283e0d88de4caa0ef98f8fe0`, Node v24.15.0, macOS arm64. Issue #447's next unfinished problem by number is 288, both `288_enormousfactorial.ra` and its fixture. The problem defines a pseudorandom base-p integer and asks for its factorial's p-adic valuation modulo p^Exp: <https://projecteuler.net/problem=288>.

The investigation sections below record the original runtime and separate research controls at that revision. The delivery section records the subsequent production changes and their verification. Historical prototype timings are not measurements of the final source.

## Existing algorithm and current performance

The demo already avoids constructing N or its factorial. Legendre's formula reduces the valuation to `(N-digitSum(N))/(p-1)`. The first Exp digits need positional weights; all later digits can be combined into one tail sum. Time is O(Q+Exp), storage O(1) for a fixed Exp, with Q+1 sequential generator steps. There is no large intermediate array. The initializer `Mod` is unused.

The old issue timings, 62.1 s reference and 0.3 s compiled, are historical. The current unchanged full source takes around 6.5–7.3 s reference and 0.22 s compiled in repeated local runs. Do not attribute the historical reference improvement to this experiment.

Diagnostics on the full original input: one successful compiled loop, two Number attempts, one Number overflow and one mixed-integer attempt; no compiler rejection. The prefix contains genuinely large integers (`61^10` is outside safe Number), so dropping the overflow guard would be incorrect. The mixed lowering emitted here uses BigInt for the data arithmetic. It completes the hot loop quickly; the overflow is early in the short prefix and is not an expensive late replay.

Reference execution repeatedly evaluates source statements, reads names and publishes checked writes. A Q=1,000,000 CPU profile, including module import/startup, attributes 13.18% self time to `BindingEnvironment.assign`, 8.53% to prepared name readers, 5.84% to `LocalFrame.get`, and 5.33% to block execution. This is dispatch/binding overhead, rather than expensive primality work or array materialization. The profile is attribution, not a benchmark sample.

## Source variants

- `original`: frozen production source.
- `reduced`: remove the repeated Total digit-sum update. Accumulate `T*(Pw-1)` in the prefix, then divide `Low + Tail*(p^Exp-1)` by p-1. Same single loop and arithmetic result.
- `split`: accumulate the prefix valuation directly using `W_0=0`, `W_(k+1)=W_k+p^k`. For k >= Exp, `W_k mod p^Exp = W_Exp`. A separate tail loop needs just `Tail += S mod P` and the generator update. Handle Q < Exp by stopping the prefix at Q; Exp=0 naturally gives zero modulo one.

Splitting reduces interpreter work, but initially regresses compiled performance: its tail takes the pure Number backend and `%` over floating-point Number values is costly on this workload. The original mixed BigInt kernel is faster here. Thus merely replacing the demo with the split variant is insufficient.

## General runtime/compiler prototypes

`euler288-binding-loader.mjs` changes the existing prepared scalar writer to select `assignmentScope(name)` before looking up its cached frame slot or global type. The stock implementation selects `current`, which may be a loop block even when the target binding belongs to an enclosing/global scope. Such writes miss the local cache and repeatedly take `assign`'s full checking path. The prototype retains the existing constant/plan/type checks and frame/global write methods. This is a general reference-interpreter opportunity, independent of the mathematical rewrite.

`euler288-remainder-loader.mjs` changes emitted integer Number remainder to

```
0 <= a < 2^52 and b > 0: a - floor(a/b)*b
otherwise:             a % b
```

Existing division-by-zero, floor-mod sign correction and safe-integer checks remain. Operands at this code-generation point are integer literals or registers/temporaries, so the expression does not repeat source evaluation. The loader also guards `typeof a === 'number'`; mixed BigInt arithmetic retains `%`.

For the guarded integer domain, division's absolute rounding error is less than 1/(2b). A nonintegral exact quotient is at least 1/b from the next integer, so floor cannot cross that boundary. An integral quotient is representable exactly. The product floor(a/b)*b is at most a, so the integer multiplication and subtraction also stay exact. Above the bound or for other signs, retain the current remainder operation. This follows the bounded-quotient strategy already used for integer `//` in `jit/integer-loop-expressions.ts`; it does not relax Number admission or exact overflow handling.

Both loaders modify modules/generated functions only in their own process. Neither was a delivered runtime fix at the investigation stage. A production change needs focused scoping/protection/error-state tests and compiler regression checks across other programs, especially before changing arithmetic code generation generally.

## Repeated measurements

Three fresh processes per case, rotating order within each series. Imports excluded; parse and compilation included. No oracle, diagnostic, profile or other agent benchmark overlaps timed series; other host activity is uncontrolled. RSS is process high-water memory, not retained storage. Every sample uses full Q=10,000,000 and asserts 605857431263981935.

| Series | Mode | Variant/runtime | Median seconds | Peak RSS MiB |
| --- | --- | --- | ---: | ---: |
| Initial | compiled | original, stock | 0.222 | 172.1 |
| Initial | compiled | split, stock | 0.745 | 151.9 |
| Initial | reference | original, stock | 7.290 | 172.9 |
| Initial | reference | split, stock | 4.459 | 173.1 |
| Follow-up | compiled | original, stock | 0.217 | 172.8 |
| Follow-up | compiled | reduced, stock | 0.198 | 172.8 |
| Follow-up | compiled | split, remainder prototype | 0.180 | 139.3 |
| Follow-up | reference | reduced, stock | 5.059 | 173.6 |
| Binding control | reference | original, stock | 6.543 | 173.8 |
| Binding control | reference | original, binding prototype | 5.376 | 173.2 |
| Binding control | reference | split, binding prototype | 3.176 | 173.8 |

The binding control saves about 18% on unchanged source. The mathematical split plus binding prototype takes about half the reference time. The remainder prototype removes the compiled split regression, with a modest full-program gain over the already fast original. The lower compiled split RSS is observed process peak, not an O(Q) storage saving; every source variant already uses constant-size state. Do not compare different series as a precise paired effect: host load shifts between them.

## Verification and recommendation

`euler288-verify.mjs` builds the actual N with BigInt for small inputs, then computes the valuation by repeated division in Legendre's formula, independently of the digit-sum/tail identity. It includes Q=0, Exp=0, Q below/at/above Exp, large prefix weights, and the official P=3,Q=10000,Exp=20 golden. Each of three variants runs in both compilation modes: 72 comparisons per runtime configuration, passing stock, binding, remainder and both loaders together (288 total).

Each configuration additionally checks 84,743 native remainder comparisons against BigInt, including multiples +/-1 near 2^52, negative operands/divisors and safe values outside the fast domain. A generated Number loop checks all 624 sign/boundary pairs against exact floor-mod expectations, with zero Number overflow. These checks validate the investigated domains; they are not a broad runtime regression suite.

The language/interpreter TypeScript build passed. Scoped fixture type and differential checks passed: 2 tests, 2 fixture blocks, 28 compiled entries and 3 Number loop entries. The differential check takes 14.84 s because it executes the default fixture as well as the small example.

The investigation recommended implementing the general prepared-writer scope repair, add a guarded Number remainder optimization with focused regression coverage, and then adopt the split demo. Keep the full golden in a dedicated compiled full-scale test; make the ordinary fixture cover small independent/edge cases rather than replaying all ten million generator steps. Existing full-reference fixture execution currently repeats the expensive workload already represented by the main program. Broad/exhaustive suites and Intel measurements were not started.

Reproduce:

```
node benchmarks/euler288-investigation.mjs reference original
node benchmarks/euler288-investigation.mjs compiled split
node --import ./benchmarks/experiments/euler288-binding-loader.mjs benchmarks/euler288-investigation.mjs reference split
node --import ./benchmarks/experiments/euler288-remainder-loader.mjs benchmarks/euler288-investigation.mjs compiled split
node benchmarks/euler288-verify.mjs
node --import ./benchmarks/experiments/euler288-binding-loader.mjs --import ./benchmarks/experiments/euler288-remainder-loader.mjs benchmarks/euler288-verify.mjs
```

Raw samples, profile attribution, diagnostics, source hashes and verification counters: `baselines/2026-10-31-euler288-investigation.json`.


## Delivery

The production demo now separates the weighted prefix from the tail. Its comments explain why the tail coefficient is constant modulo p^Exp; the unused Mod initializer and repeated Total updates are gone. Runtime changes select the actual assignment scope for prepared scalar writers and emit the guarded Number remainder, with the old remainder retained outside the proven domain. There are no Euler-specific runtime paths or changes to Number admission, overflow replay, or binding semantics.

The full Q=10000000 golden moved to a dedicated compiled test. It asserts the exact answer and distinguishes the short prefix's expected Number overflow from the successful Number tail. The ordinary fixture retains the official example and adds Q=0, Q below/at/above Exp, Exp=0, and a prefix with weights above Number's safe range. The main program remains eligible for normal execution audits.

Validation: TypeScript build; 679 tests across 10 targeted runtime suites; full compiled golden; scoped type/differential fixture checks (7 test blocks, 100 compiled entries, 18 Number loop entries); and 96 independent variant/mode comparisons. The arithmetic verifier also checks 84,743 native cases and 624 generated Number-loop cases. Reference, exact BigInt and Number results agree on signs, boundaries and later division-by-zero publication. Broad suites/exhaustive audits and Intel timing were not run.

The cached writer tests verify that nested blocks actually reuse global/enclosing-local caches, that distinct invocations sharing a layout write their own frames, that escaped frames still publish correctly, and that type/mutation guards remain active. Number-loop tests cover all operand signs, multiples +/-1 near 2^52, safe values outside the optimized range, and state retained before a zero divisor.

The delivery benchmark repeats full workloads in fresh serial processes on the same built runtime. Its legacy loader rolls back only these two runtime changes in memory; no source files or other work are rolled back. This interleaves old/new controls so small differences in the separate before/after batches do not become unsupported regression claims. All samples assert exact goldens; host load remains uncontrolled.

| Final paired control | Mode | Before seconds | After seconds |
| --- | --- | ---: | ---: |
| Euler 288 full, original/legacy vs shipping/current | reference | 6.866 | 3.561 |
| Euler 288 full, original/legacy vs shipping/current | compiled | 0.220 | 0.181 |
| Euler 129 unchanged source, legacy/current | compiled | 0.127 | 0.129 |
| Euler 104 unchanged source, legacy/current | compiled | 0.857 | 0.896 |

Euler 288 improves by about 1.9x in reference and 18% in compiled elapsed time. The fixture's scoped differential check drops from 14.84 s to 0.206 s by moving the full input to compiled-only coverage. Euler 129 differs by about 2%; Euler 104 is about 4.5% slower in these three pairs (legacy 0.791–0.894 s, current 0.819–0.914 s). Preserve that observation rather than claiming a universal speedup; more extensive timings would be needed to distinguish the small effect from host/GC variation. Two additional one-off arithmetic controls (explicit Int32 remainder and restricting the division shortcut to numerators >=2^31) were not adopted: the former did not improve the sampled 104 run, and the latter regressed the sampled full 288 run to 0.431 s. Those are exploratory single samples, not comparative benchmark conclusions.

A further eight focused suites passed 193 tests (872 targeted runtime tests overall). After rebuilding against the current source, the independent verifier and full compiled golden still pass. Final delivery samples, control ranges, diagnostics, checks and hashes are appended under `delivery` in the baseline JSON. Historical loaders are retained as investigation artifacts; the forward binding loader is a no-op on builds that already contain its repair. To repeat the final old/new arithmetic and binding control against the same build:

```
node --import ./benchmarks/experiments/euler288-legacy-loader.mjs benchmarks/euler288-investigation.mjs reference original
node benchmarks/euler288-investigation.mjs reference shipping
node --import ./benchmarks/experiments/euler288-legacy-loader.mjs benchmarks/euler288-controls.mjs demos/euler/104_pandigitalfib.ra
node benchmarks/euler288-controls.mjs demos/euler/104_pandigitalfib.ra
```
