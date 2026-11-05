# Euler 414 investigation

Historical research before delivery; see [delivered results](euler414-followup.md).

Research base: `067a6638d6c8dcd71b2caec144ad30e569f97a66`.
The current #447 table leaves Euler 414 unfinished, immediately after 413.
Production compiler, demo, audit exclusions and issue are unchanged. Compiler
and demo alternatives below are experimental, not a delivered fix.

## Current implementation

The problem asks for five-digit Kaprekar iteration totals in bases `6k+3`,
`2 <= k <= 300`, modulo `10^18`. The existing reduction is sound: a sorted
five-digit input is represented by the two outside differences `(u,v)`.
A multiplicity formula counts all strings in a state; a memoized functional
walk finds its distance to the constant. It does not enumerate `b^5` strings.

There are **163,760,506** `(u,v)` pairs across the requested bases. The direct
JS control traversed 163,760,207 previously unknown states and observed a
maximum walk depth of 613. The algorithm is quadratic per base and cubic in
the largest base across the requested range. This is substantial real work,
but the old approximately 1.9 minute issue timing is no longer current.

The unchanged full main initially took **22.789 s / 322.5 MiB** on the Mac,
answer **552506775824935461**. One mixed integer loop compiles the whole
search: indices and table cells use Number, exact scalar islands use BigInt.
No speculative arithmetic overflow occurred. Reference full main was not run;
it remains excluded from the exhaustive corpus executions.

At `First=Last=100`, single fresh-process observations were 2.484 s reference
and 0.194 s compiled with the compiler prototype; the original compiled
observation was 0.189 s. The combined demo prototype took 1.988 s reference.
These are bounded observations, not full reference timings or medians.

## General compiler opportunity

A required input `Mod=10^18` rejects the current output-only Number tier.
The broad mixed tier then widens independent intermediates `Mu`, `Dv`, and
`Wt`, even though checked Number arithmetic can calculate those values on
this input. Generated JS repeatedly converts indices to BigInt and evaluates
the multiplicity and weight arithmetic in BigInt on every state.

`experiments/euler414-boundary.patch` adds an intermediate mixed tier:

1. Seed exact scalars with exact outputs and eligible required inputs.
2. Propagate exactness forward through scalar assignment dependencies.
3. Keep independent calculations as checked Numbers.
4. Retain the existing broad mixed and exact fallbacks.

For this program the modulus and sums stay exact while independent weights
stay checked Numbers. This is a general dependency-based tier, not an Euler
special case. It does not change Number admission limits or language semantics.
The patch is deliberately still a prototype; focused new regression tests and
broader representative workload checks belong in the delivery change.

## Three paired compiler measurements

Three alternating fresh-process original/prototype pairs on each host,
unchanged original demo, all full answers identical:

| Host | Original median | Compiler prototype median | Original median peak RSS | Prototype median peak RSS |
| --- | ---: | ---: | ---: | ---: |
| Mac arm64 | 28.586 s | 21.582 s | 311.5 MiB | 329.4 MiB |
| Intel x86_64 | 59.813 s | 45.995 s | 263.5 MiB | 280.0 MiB |

The compiler prototype won every pair. This is about a 25%/23% time reduction
by medians, with an approximately 6% higher median process peak RSS. Mac
baseline times ranged 27.463-39.390 s, so load variation is material.

The combined source plus compiler single probe was 15.517 s / 286.4 MiB
on Mac and 44.613 s / 239.6 MiB on Intel. Its memory result is promising on
both architectures. It is not a three-pair measurement of the combined change;
particularly the extra Intel speed gain beyond the compiler is modest.

The reusable-buffer direct JS control took 22.093 s / 74.1 MiB on Intel,
versus 9.063 s / 68.3 MiB on Mac. Those are also single observations.

Raw observations, including diagnostics and unsuccessful alternatives, are in
`baselines/2026-11-05-euler414-investigation.json`.

## Demo alternatives

- `no-mod`: removing the inner modulus alone does not help. On the original
  compiler it took 23.079 s; with the compiler prototype it overflowed the
  checked accumulator and replayed through the broad tier, taking 24.319 s.
  Keep modular reduction unless sum representation is changed deliberately.
- `four`: `b-1` is already a greatest digit of every nonzero difference.
  Compute the minimum and second-smallest of the other four digits rather
  than sorting all five through nine compare-exchanges. The general case
  needs their maximum minus their second-smallest for the next inner gap.
  The `v=0` case has three equal greatest digits and is handled separately.
  Full single probe: 17.684 s / 331.8 MiB with the compiler prototype.
- `triangle`: only `0 <= v <= u` is used. Replace square addressing `u*b+v`
  by `u*(u+1)//2+v`. At base 1803 this uses 1,626,306 instead of 3,250,809
  cells. Full single probe with pooled vector construction: 15.607 s /
  294.4 MiB, correct full answer.
- `triangle-fresh`: the same smaller table constructed as
  `array shape Size fill 0` took 22.271 s / 580.8 MiB. This path uses
  `createArray` and allocates a new private buffer on each outer iteration;
  the existing vector construction uses the vector buffer pool. Fewer live
  cells do not guarantee a smaller process peak when buffers are repeatedly
  allocated. General private-array pool integration is a separate compiler
  opportunity; its alias and publication contracts must be preserved.
- `combined`: four-digit order statistics and pooled triangular storage.
  Mac full single probe: **15.517 s / 286.4 MiB**, correct answer. This is
  promising, but the individual timing contribution of the shorter transition
  is not established by these single probes under varying load.

All source alternatives are generated by `experiments/euler414-variants.mjs`
from an archived original. Production Rank source has not been rewritten.

## Verification and controls

- 283 existing focused tests passed: scalar-function-kernel (30), mixed
  predicates (25), Number outputs (12), exact consumers (16), output growth
  (9), and Number loops (191).
- Build and interpreter test TypeScript checks passed.
- 42 comparisons covered original and prototype sources in reference and
  compiled execution, statement and existing fixture values, small moduli,
  and empty outer ranges.
- An independent oracle enumerated sorted five-digit tuples, counted their
  permutations using factorials, performed base-b subtraction to obtain the
  next state, and followed distances to the fixed point. Bases 15,21,27
  returned 5274369,34289199,132630799. State multiplicities and shorter
  transition formulas matched the independent calculation.
- Full baseline, compiler, and source probes returned 552506775824935461.
- A direct JS control uses checked Number weights and exact BigInt totals.
  With a reusable Uint16 distance buffer, Mac single observation was
  **9.063 s / 68.3 MiB**. The non-reusing control took 8.602 s / 490.3 MiB.
  This is an opportunity bound, not a claimed equivalent compiler lowering:
  it uses a proved-small distance representation, fewer guards, and no Rank
  observable intermediate state. Its maximum observed distance is empirical;
  production integer storage must retain widening/fallback correctness.

No full suite or exhaustive audit was started. No commit, push, issue update,
new issue, or comment was made for Euler 414 during this investigation.

## Reproduction

Build the baseline, then run:

```
node benchmarks/experiments/euler414-run.mjs compiled 2 300 original
node benchmarks/experiments/euler414-run.mjs reference 100 100 original
node benchmarks/experiments/euler414-verify.mjs
```

Apply the prototype patch and rebuild to measure its compiler. `RANK414_RUNTIME`
can point to an archived interpreter `out/index.js` to alternate runtimes in
fresh processes. The `triangle`, `triangle-fresh`, `four`, `combined`, and
`no-mod` source variants are the last argument of the runner.

`euler414-pairs.mjs` runs three alternating baseline/prototype pairs; its
baseline runtime path is `/tmp/rank414-baseline/packages/interpreter/out/index.js`.
Parsing is included in Rank timings, module import is excluded. Diagnostics
are enabled. Hosts have other activity; do not treat these as idle-machine
latency guarantees. Process peak RSS is recorded, not live heap size.
