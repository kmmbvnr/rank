# Euler 311: private helper Number compilation

## Delivered implementation

Implemented on 2026-11-01 after research at `205906ca` for
[#447](https://github.com/kmmbvnr/rank/issues/447). The demo retains its
algorithm and helper; the default block changes from 4 million to 1 million.
Private Number helpers now support guarded `floor`/`ceil` calls and integer
powers. Floor/ceil code generation is shared with loop compilation; higher
integer powers reuse the loop runtime's checked repeated squaring, rather
than approximate JS power. Unsafe arithmetic still replays exactly. Warmed
callers also recheck the original builtin's call implementation, covering
both binding replacement and mutation of the same native function object.
The operation catalogue admits both numeric input types for these bounds.

Final-code fresh-process results:

| Input and host | Before | After | Before MiB | After MiB |
| --- | ---: | ---: | ---: | ---: |
| 10^8, Mac, medians of three | 1.837 s | 0.300 s | 519 | 209 |
| 10^8, Intel, medians of three | 4.601 s | 0.739 s | 503 | 195 |
| 10^10, Mac | 189.204 s (one exploratory sample) | 16.716 s (median of three) | 608 | 211 |
| 10^10, Intel | not measured | 40.573 s (one confirmation) | — | 199 |

All full answers are 2466018557; all final full runs record 2500 Number
helper entries and zero fallbacks. The smaller input shows about 6.1x and
6.2x speedups in repeated cross-host comparisons. Full Mac baseline caveats
are recorded below; the original full sample overlapped brief probes.

Validation: TypeScript build; 449 tests across 11 focused interpreter suites
(including the new 23-case suite); 1492 language
tests; scoped type, differential, name-facts and full compiled checks for
311; 120 independent oracle comparisons on each final Mac and Intel runtime;
semantic-boundary/application-form checks. An existing stale reverse-signature
expectation from the prior rope change was corrected to include its already
implemented three-argument overload. Exhaustive audits/full npm test were
not run. The full reference execution-budget exclusion is retained.

Delivery data: `baselines/2026-11-01-euler311-delivery-{mac,intel}.json`.

```sh
node benchmarks/experiments/euler311-delivery.mjs /tmp/euler311-full.json
node benchmarks/experiments/euler311-verify.mjs
```

The rest of this report records the initial research and alternative controls.

## Finding

The main avoidable cost is compiled BigInt arithmetic inside
`biclinic_block`, rather than interpretation of its individual statements.
The outer loop compiles and calls the compiled helper, but its private-array
Number kernel rejects both `floor` and the `integer-power` proof operation.
Neither construct requires BigInt for this workload. Supporting both in an
isolated Number-kernel prototype makes the unchanged algorithm much faster
and reduces memory. A smaller block improves both hosts in the repeated
reduced-scale comparison.

The initial recommended direction was general, guarded numeric builtin
lowering and integer-power handling to private helper compilation, preserving
overflow replay and builtin-identity checks. Prefer sharing lowering with
the existing Number region backend over duplicating numeric semantics. The
existing function-prefix backend already handles these constructs; the
scalar-call compiler currently takes precedence and bypasses it.

## Repeated measurements

Node 24.15.0 on Apple M5 and Intel i7-10750H (`root@jack.lan`). Limit is
10^8, answer is 11548848. Three fresh, serial processes per case; table
shows medians. Import/startup excluded, parse and execution included.
RSS is process high-water including imports. Cases rotate between rounds.
The original algorithm with block 1 million was measured in a separate
trailing three-process series. Other machine activity can affect timings.

| Variant | Mac seconds | Mac MiB | Intel seconds | Intel MiB |
| --- | ---: | ---: | ---: | ---: |
| Original, block 4 million | 1.837 | 519 | 4.601 | 503 |
| Number helper prototype, same demo | 0.337 | 210 | 0.942 | 198 |
| Number helper, block 1 million | **0.296** | **211** | **0.721** | **196** |
| Existing Number prefix, scalar-call compiler disabled | 0.338 | 272 | 0.880 | 258 |
| Manual inline control, existing compiler | 0.325 | 247 | 0.871 | 230 |
| Online counting, Number prefix, block 4 million | 0.266 | 257 | 0.837 | 260 |
| Online counting, Number helper, block 4 million | 0.324 | 212 | 1.301 | 200 |
| Online counting, Number helper, block 1 million | 0.285 | 213 | 0.912 | 199 |

The compiler-only prototype improves the unchanged demo about 5.5x on Mac
and 4.9x on Intel. Including the smaller block gives about 6.2x and 6.4x.
The online algorithm adds arithmetic to every representation update and
regresses Intel relative to the original algorithm in the same Number
helper backend. Do not select it from the Mac timing alone.

## Full input

Limit 10^10, answer **2466018557** in every completed full run.
These are exploratory single samples, not medians. The original full run
overlapped brief diagnostic probes; subsequent full samples ran serially.
The repeated 10^8 series above is the controlled cross-host evidence.

| Variant | Mac seconds | Peak MiB |
| --- | ---: | ---: |
| Original | 189.204 | 608 |
| Manual inline control | 24.280 | 314 |
| Number helper, original block 4 million | 21.865 | 271 |
| Number helper, original algorithm, block 1 million | **17.241** | **210** |
| Existing Number prefix, original block 4 million | 19.969 | 439 |
| Online counting, Number prefix, block 4 million | 16.569 | 378 |
| Online counting, Number helper, block 4 million | 20.527 | 273 |
| Online counting, Number helper, block 1 million | 14.944 | 220 |

No full-input Intel or full-input reference run. At 10^8, one reference
sample took 20.488 seconds / 244 MiB. This is distinct from the compiled
BigInt path. The full reference remains excluded by the existing execution
budget; no exclusion has been changed.

## Why the search is still substantial

For `Top = Limit // 4 = 2500000000`, the current code performs exactly
981704953 positive unequal square-pair updates. Its 625 blocks additionally
visit 14748473 Y values and scan 2500000000 count cells. Blocks bound live
storage but do not reduce this work. Better compilation can remove BigInt
overhead; further large gains would require reducing the mathematical search.

The existing count formula is `choose(R, 3)`, plus `choose(R, 2)` when
N is twice a square. The experimental online version uses the difference
`choose(R+1,3) - choose(R,3) = choose(R,2)` during each pair insertion,
then visits only twice-square N for the correction. It removes the long
final scan but increases work per pair. It is retained only as a control.

## Compiler evidence

`scalarFunctionResult` for `biclinic_block` reports local array writes,
`nativeReads = [floor]`, no user calls, captures, or deferred plans.
`compileScalarNumberKernel` in `scalar-function-kernel.ts`:

1. Rejects any native read other than `len`.
2. Rejects all compiled numeric call expressions, including `floor`.
3. Rejects the `integer-power` proof input used for `(Y + 1) ** 2`.

The isolated patch allows `floor`, lowers its result through the existing
safe-integer guard, and handles nonnegative integer powers with the same
guard. Existing exact-call binding checks remain in place. No global
threshold or Number admission limit was changed. After this patch the full
original run records 625 Number helper entries and zero Number fallbacks.
This historical patch was a benchmark prototype. The delivered compiler
uses checked products for powers and adds the focused tests for overflow
replay, errors, negative bases, numeric bounds, and replaced builtin bindings.

## Verification and reproduction

The verifier independently factors N. If a prime congruent to 3 mod 4 has
odd exponent, there are no representations. Otherwise, with
`D = product(e + 1)` over primes congruent to 1 mod 4,
`R = (D - isSquare(N) - isTwiceSquare(N)) / 2`.
It sums the same combinatorial interpretation using these independently
obtained counts. It verifies the published examples 49 and 38239 from the
[problem statement](https://projecteuler.net/problem=311).

120 program/oracle comparisons passed on each of: current Mac runtime,
copied Mac prototype, copied Intel prototype. They cover both original and
online programs, both engines, ten limits including 0 and 10000 boundaries,
and blocks 7, 97 and 4000. Full variants agree on the answer above.
No production source changed during that research phase. Delivery verification
is listed at the top of this report.

```sh
node benchmarks/experiments/euler311-number-prototype.mjs /path/to/baseline/out/index.js
# Save its printed temporary runtime path as PROTOTYPE_RUNTIME.
node benchmarks/euler311-investigation.mjs compiled 100000000 4000000
RANK_BENCH_RUNTIME="$PROTOTYPE_RUNTIME" \
  node benchmarks/euler311-investigation.mjs compiled 100000000 1000000
node benchmarks/euler311-investigation.mjs prefix 100000000 4000000
RANK_BENCH_RUNTIME="$PROTOTYPE_RUNTIME" \
  node benchmarks/experiments/euler311-series.mjs \
  "$PROTOTYPE_RUNTIME" /tmp/euler311-series.json
RANK_BENCH_RUNTIME="$PROTOTYPE_RUNTIME" \
  node benchmarks/experiments/euler311-verify.mjs
```

Raw results: `baselines/2026-11-01-euler311-{mac,intel}.json` and
`baselines/2026-11-01-euler311-full-and-verification.json`.
The historical prototype requires a pre-fix build at `205906ca`; the current
compiler already includes the repair. Historical before/after series should
be run from that baseline checkout.
