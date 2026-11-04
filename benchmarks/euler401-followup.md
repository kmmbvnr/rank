# Euler 401 follow-up

Measured runtime base: `2b2c6eb7`. Delivery also includes `109cf1b6`
(the intervening commits add only unrelated Euler 702–704 demos). See [the initial investigation](euler401-investigation.md)
for exploratory candidates and profiles. The delivered program remains an
array-oriented O(sqrt(N)) hyperbola calculation with exact integer arithmetic.

## Delivered changes

The demo uses the identity

    S2(q) mod M = ((x (x+1) mod 6M) (2x+1) mod 6M) / 6,
    x = q mod 6M.

The retained remainder is divisible by six. This removes a parity mask and two
`choose` arrays. Intermediate products use BigInt; wide products never round
through Number. Batches of 65,536 divisors bound the live intermediate buffers.
The input, final hyperbola correction and default answer are unchanged.

The compiler separately canonicalizes repeated references to a protected array
slot within one function-plan consumer. Direct uses and uses through named lazy
stages share the same IR input, enabling the existing inline emitter to reuse
one scalar cell temporary at the same address and in the same generated loop
body. The investigated helper now emits one input load per cell instead of
three. No runtime result buffer or computed-cell cache is added.

Existing entry/linked-call proofs admit completed tracked storage; opaque input
completion and guards remain in their ordinary order. Different slots,
addresses, loop bodies and consumers stay separate. Binding completion, lazy
return demand/error timing, arithmetic locations, cancellation and budgets retain
their existing contracts. The `planReturn` guard remains in place.

The demo uses the portable array variant. The helper/consumer prototype is
retained as a compiler benchmark: although its allocation traffic is much lower,
it remains slower on Intel. This commit does not switch the demo to that path.

## Measurements

Node 24.15.0 on Apple M5 arm64 and Intel i7-10750H x64. Three fresh-process runs
per variant per host, alternating forward/reverse order; parsing and diagnostics
included, imports excluded. Peak RSS is for the whole process. Tests finished
before the measurement series; Mac load from other sessions still varies.

| Variant | Mac seconds / MiB | Intel seconds / MiB |
| --- | ---: | ---: |
| Original compiled | 4.535 / 392.8 | 10.943 / 344.3 |
| Final compiled | 3.186 / 262.7 | 7.853 / 259.4 |
| Original reference | 6.527 / 420.7 | 14.144 / 339.3 |
| Final reference | 5.818 / 330.4 | 14.663 / 320.8 |
| Same fused helper, old lowering | 2.737 / 263.0 | 10.262 / 249.2 |
| Same fused helper, shared inputs | 2.618 / 265.8 | 9.397 / 248.5 |

Compiled speedup: mac 1.42x, peak RSS down 33.1%, intel 1.39x, peak RSS down 24.6%.
Compiler-only speedup on the same helper: mac 1.046x, intel 1.092x.


The compiler-only comparison uses exactly the same helper/consumer source.
`euler401-no-shared-inputs.mjs` restores the old input-lowering branch in memory;
all other integrated compiler/runtime changes stay enabled. The shipping demo
does not use function-plan input sharing, so its improvement is attributed to
the formula and batch size. The separate compiler change benefits eligible
function-plan consumers generally.

Reference timing is reported independently: this is not an across-the-board
reference speedup. The Intel reference change is small and must not be described
as an improvement: 14.144 → 14.663 s (+3.7%), with peak RSS
339.3 → 320.8 MiB. Allocation traffic and peak memory are also different:
the demo's typed publications fall from 442,718,864 to 284,604,984 cells, while
its smaller blocks increase the number of publications from 448 to 4,347.
These totals are not simultaneous live memory. The compiler-only peak-RSS
variation is small; no memory saving is attributed to input sharing itself.

## Verification

- 582 distinct focused tests across 22 files passed on each host: the 581-test
  selected suite and a rerun of the final 14-test input-sharing file, which adds
  one matrix regression. Coverage includes integer/real values, values beyond
  safe Number, broadcasting, different outer addresses, matrix reductions,
  separate consumers, retained aliases, opaque read order, exact error locations,
  cancellation, budgets and existing tensor/function-plan/Euler 400 regressions.
- The full default Euler 401 answer `281632621` passed with compilation on and
  off on both hosts. New tests use an independent quotient-interval oracle at
  roots 65535, 65536 and 65537, and check the existing large checkpoint
  `679233331` at N=2,000,000,000,000.
- The investigation verifier passed another 230 cross-mode comparisons against
  independent divisor enumeration after integration.
- All 36 full-scale series runs returned the golden value.
- TypeScript build/test typecheck, semantic-boundary checks (65 owners),
  application-form checks, Rank source 40-column check and whitespace checks
  passed. Exhaustive audits and full `npm test` were not run.

## Reproduction

From the repository root:

    node node_modules/typescript/bin/tsc -b tsconfig.build.json
    python3 benchmarks/experiments/euler401-final-series.py /tmp/series.jsonl
    node benchmarks/experiments/euler401-verify.mjs

The source and compiler controls are under `benchmarks/experiments/`.
Final raw results, source hashes and methods are in
`baselines/2026-11-04-euler401-followup.json`. The initial investigation JSON
records earlier single probes and an earlier loaded-machine series separately.
