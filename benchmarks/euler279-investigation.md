# Euler 279 investigation

Issue: https://github.com/kmmbvnr/rank/issues/447

Problem: https://projecteuler.net/problem=279

Initial research used main `8afadef6`, Node v24.15.0, macOS arm64. Full input:
Limit=100000000, Answer=416577688. The sections below retain the initial
experiments; the final implementation and checks are in Delivery.
Euler 279 was the next unfinished problem by number in the issue's slow-case
table; its historical 183.1/158.0 second measurements are no longer current.

## Measurements

Fresh serial processes, three rounds with rotating case order. Includes parse
and execution, excludes module import. All full samples assert the answer.
RSS is process high-water, including interpreter/parser, not retained array
storage. Other activity on this machine is uncontrolled; small differences
are not portable claims. Raw samples, source hashes and build fingerprint:
[baseline](baselines/2026-10-30-euler279-investigation.json).

| Variant | Compiled median, s | Reference median, s | Compiled RSS, MiB |
| --- | ---: | ---: | ---: |
| Original | 11.271 | 10.631 | 942 |
| Canonical array families | 2.610 | 2.612 | 595 |
| Canonical scalar inner loop | 0.744 | 16.756* | 160 |
| Canonical ranked scalar helper | 12.916 | not measured full | 462 |
| Canonical arrays with deferred arithmetic terms | 3.308 | 10.312 | 769 |

*Full scalar reference is one sample, not a median. It is a useful compiler
control, but loses to the array program without compilation.

## Algorithm

The original uses three parameter sweeps, division-by-three normalization,
duplicate 120-degree triangles, and a final division by two. A single
canonical Eisenstein family avoids that work and shares its coprimality test
with the right triangles.

For m>n>0, gcd(m,n)=1, and m-n not divisible by 3, put
x=m²-n², y=2mn+n², z=m²+mn+n². Then z²=x²+xy+y², so
(x,y,z) is a primitive 120-degree triangle. It also produces the two distinct
60-degree triangles (x,x+y,z) and (y,x+y,z). Their perimeters are:

- 120 degrees: (2m+n)(m+n).
- 60 degrees: 3m(m+n) and (2m+n)(m+2n).

The right-triangle family has perimeter 2m(m+n), requiring m-n odd instead.
The equilateral family contributes Limit//3 separately. Each primitive family
contributes Limit//perimeter, including all its multiples.

All three Eisenstein perimeters exceed the right-family perimeter at the same
m,n. Thus one common range suffices:
m <= isqrt(Limit//2), n <= min(m-1, Limit//(2m)-m).
Terms outside the perimeter limit contribute zero through integer division.
One materialized coprimality mask feeds both parity and modulo-three filters.
The prototype retains one outer loop and array operations inside it.

This remains O(Limit) parameter work; it is a reduction in repeated work,
not a new asymptotic complexity claim.

## Interpreter and compiler

On Limit=1000000, original diagnostics record zero compiled loops and 2444
tensor kernels. Rejections include `loop:deferred-binding:AssignmentStatement`,
`loop:unsupported-op:sum`, `tensor:binding:isqrt`, unsupported materialization
and filter syntax. These are separate compiler boundaries, not a single
deferred-binding check that can safely be removed.

The canonical scalar control compiles into one Number loop, with no arrays,
masks or computed array cells. In contrast, canonical arrays use native
compact kernels but do not compile the surrounding loop. `gcd` already has
safe-number native execution and works inside compiled scalar loops; adding
scalar gcd support again would not solve this case.

General compiler opportunities are linking reductions and local array
operations into surrounding loops and expanding checked plan lowering for
native dyadic calls and filters. Existing completed `=` boundaries must
remain observable. Deferred work must not be forced early. These extensions
were not implemented or benchmarked here.

Two simple rewrites do not solve it:

- Deferring all intermediates in the original took 1.667 s at Limit=1000000,
  versus an instrumented original 0.919 s. This is a preliminary control,
  not a repeated full-input comparison.
- Deferred arithmetic terms in the canonical array program activate Number
  tensors (2817 at Limit=1000000), yet make the full program slower. Number
  admission alone is not evidence of a speedup.

A separate full reference CPU profile of the canonical array program has
its largest self-time entries in `mapStoredInt32Binary` and `compactBinary`,
followed by GC and array readers/ownership. Individual arithmetic passes
and their storage still cost time even when scalar arithmetic is native.

## General runtime allocation control

Before delivery, `mapStoredInt32Binary` allocated a Float64 temporary before attempting the
Int32 fast path. On success that temporary is unused. A research-only loader
moves the allocation after the successful-fast-path return. It changes no
production source or compiled output.

Three alternating pairs on the full canonical array program:

- Shipping: median 2.634 s; RSS 583.7 MiB.
- Late temporary allocation: median 2.493 s; RSS 596.1 MiB.

That is about 5.3% less time in this control, with no measured peak-RSS
reduction. The improvement avoids unnecessary allocation; it changes no
arithmetic, thresholds, fallback rules or language evaluation boundaries.
Delivery below records the production change and focused validation.

## Correctness and reproduction

The independent oracle enumerates sorted integral sides up to perimeter 300
and checks the integer cosine-law identities for every angle. It compares
62 boundary/small limits with five source variants in both compilation
modes. It also checks Limit=5000 against the existing fixture golden 8891,
and Limit=1000000 against the original's 3055201: 640 comparisons per runtime.
Both shipping runtime and late-buffer loader pass. Full timed runs retain
the original answer 416577688. These initial research checks preceded the
implementation; delivery checks are recorded separately below.

```sh
./node_modules/.bin/tsc -b packages/language packages/interpreter
node benchmarks/euler279-investigation.mjs compiled original 100000000
node benchmarks/euler279-investigation.mjs compiled canonical 100000000
node benchmarks/euler279-investigation.mjs reference canonical 100000000
node benchmarks/euler279-investigation.mjs compiled scalar 100000000
node benchmarks/euler279-verify.mjs
node --no-warnings --loader ./benchmarks/experiments/euler279-late-buffer-loader.mjs benchmarks/euler279-investigation.mjs compiled canonical 100000000
node --no-warnings --loader ./benchmarks/experiments/euler279-late-buffer-loader.mjs benchmarks/euler279-verify.mjs
```

`STAGES=1`, `DIAGNOSTICS=1` and `DUMP_SOURCE=1` provide timing labels,
compiler counters or the exact source. Instrumented runs are separate from
the repeated timing series.


## Delivery

The demo now uses the canonical array algorithm. The runtime allocates wide
scratch only when the compact integer path declines. This preserves existing
arithmetic guards, error behavior and completion boundaries; no Number-mode
threshold changed. The research loader detects this implementation and becomes
a no-op. The interpreter allocation fix is general and has no Euler-specific
conditions.

Final measurements use the final runtime for both the frozen original source
and the shipping demo. Three rotating rounds, twelve fresh processes; no own
checks or profiles overlap these samples. Medians:

| Source | Compiled, s | Reference, s | Compiled RSS, MiB | Reference RSS, MiB |
| --- | ---: | ---: | ---: | ---: |
| Original | 10.964 | 10.287 | 959.7 | 1005.7 |
| Shipping | 2.499 | 2.505 | 610.2 | 605.4 |

All samples return 416577688. These are approximately 4.4x and 4.1x source
speedups on the same runtime. The separate historical allocation control
above isolates the small runtime improvement; do not attribute the whole
algorithmic speedup to it.

Validation:

- TypeScript interpreter/language build passes.
- 155 tests in eight focused suites pass: numeric and segmented integer
  kernels, primitive specialization, copy storage, numeric calls, interrupts,
  demand work budgets, and expressions.
- Scoped inferred-type and differential audits pass for the main demo and
  fixture: four audit cases, three fixture blocks. The full answer was added
  to the fixture, the three original assertions remain, and Limit=0..3 were
  added. The obsolete 900000 ms per-demo timeout was removed.
- The independent oracle now includes the production demo: 768 comparisons
  across six source variants and both compilation modes pass.
- Semantic-boundary checks pass (65 owners); syntax and whitespace checks pass.
- Full ordinary suites and exhaustive corpus audits were not run.

Reproduce the shipping run and targeted checks with:

```sh
node benchmarks/euler279-investigation.mjs compiled shipping 100000000
node benchmarks/euler279-investigation.mjs reference shipping 100000000
node benchmarks/euler279-verify.mjs
npm test --workspace @arrrank/interpreter -- test/numeric-kernels.test.ts test/segmented-integer-kernels.test.ts test/tensor-primitive-specialization.test.ts test/tensor-copy-storage.test.ts test/tensor-numeric-calls.test.ts test/interrupt.test.ts test/demand-work-budget.test.ts test/expressions.test.ts
npm test --workspace @arrrank/interpreter -- test/types.test.ts test/differential.test.ts -t euler/279_integralangle
npm run check:semantic-boundaries
```
