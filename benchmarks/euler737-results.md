# Euler 737: fuse real math, then reduce temporary storage

Issue: https://github.com/kmmbvnr/rank/issues/541

The default input remains Loops=2020 and the answer remains `757794899`.
The solution still visits approximately 7.6e8 coin angles. There is no
quadrature, root approximation, lookup table or hard-coded default answer in
the solution.

## Full-input measurements

Node v24.15.0, Apple M5 arm64 macOS and Intel i7-10750H x64 Linux. Both hosts
used normal CPU affinity. Each host has one baseline and three serial final
runs. Other host load was not controlled and baseline variance was not
measured. Mac timings vary substantially; all samples are reported below.

| Host | Baseline seconds | Final seconds, all runs | Median speedup | Baseline peak MiB | Final median peak MiB |
| --- | ---: | --- | ---: | ---: | ---: |
| Mac | 186.73 | 45.68 / 54.60 / 64.13 | 3.42x | 1147.48 | 430.48 |
| Intel | 319.41 | 86.84 / 89.09 / 89.86 | 3.59x | 1085.55 | 430.43 |

Median peak RSS fell by 62.5% on Mac and 60.3% on Intel. All default runs
returned the same answer. RSS includes process startup, parsing and the prefix
calculation. These are observed ratios, not architecture-independent speed
or memory guarantees. The issue's earlier 134-second timing is not the
baseline used here.

Raw data: `results/euler737/base-*-full.json`, `final-*-{1,2,3}.json` and
`summary.json`. The baseline source is frozen at c3dd25fb in
`fixtures/euler737-original.ra`. The runtime snapshot contains the compiler
change committed as 9946a559; a later allocation cleanup, 88dc0ed4, omits check
state for kernels that do not use it. The Rank change is cddd1dfc. Integration
against main c7bbb9b6 is recorded by merge a18d6079 and separate verification
logs; its full golden test passed in 39.96 seconds and is not pooled into the
primary timing series.

## Profile and interpreter/compiler changes

A reduced Loops=202 profile retained the original eight-million-cell blocks
and the complete original pipeline. Self samples included `storedScalarKinds`,
`mapStoredUnary`, real binary kernels, scans and comparisons. It inspected
101276736 physical cells for type evidence. Scalar math and separate passes
over intermediate arrays were substantial work. Profiles and their summaries
are diagnostic runs, excluded from the primary timing series.

Simply changing assignments to deferred `Name'` bindings was slower: 48.28
seconds versus 3.37 seconds on the reduced profiled case. The native deferred
recipe constructor only accepted integer and Boolean operands; the real
pipeline fell back to repeated interpreted cell reads.

The general runtime changes are:

- Construct deferred native recipes for real literals, captured real arrays,
  mixed numeric arithmetic and registered pure scalar builtins. Operator domains
  come from the existing compiler catalogue. Unsupported syntax, opaque values
  and functions without the internal builtin capability retain ordinary demand.
- Publish registered scalar builtin result-type evidence. `sqrt` now registers
  its real result, so a subsequent native consumer can compose it.
- Lower captured `log`, `sqrt` and `atan` builtins directly into generated Math
  calls. Builtin identity guards remain in place. Domain failures decline to
  ordinary evaluation, preserving located errors and partial demands. There is
  no approximation in these language operations.
- Reuse uniform scalar type checks within a private compiled pass. Real finite
  or NaN cells settle the ordinary real domain; infinities still undergo the
  check, including when they precede a finite cell. Opaque host polling keeps
  per-cell checks. Kernels without such checks allocate no check state.

The final Rank source builds deferred harmonic, ratio and angle recipes, then
uses `copy` to materialize one complete Turn array. This boundary also prevents
repeated recomputation when the last block needs a prefix scan. The final
harmonic array is materialized only for that last-block search.

## Isolating the compiler gain

`experiments/euler737-chain.mjs` executes the identical deferred formula over
1048576 stored real inputs on each runtime. Its timer includes source execution;
setup precedes timing and every resulting cell is independently checked against
JavaScript Math after timing. Each entry below is the median of three fresh
processes, paired baseline then final. No source algorithm differs between the
pair.

| Host | Baseline / final ms | Speedup | Baseline / final median peak MiB |
| --- | ---: | ---: | ---: |
| Mac | 1929.05 / 168.38 | 11.46x | 189.66 / 159.77 |
| Intel | 2638.74 / 294.42 | 8.96x | 175.14 / 142.19 |

This establishes a general compiler gain for this chain, not an equivalent
full-program speedup. With all original harmonic terms retained, a fused
full-input Mac experiment took 164.45 seconds, only 1.13x faster than the
baseline. It retained expensive powers and integer/real conversions. The
larger final gain includes the following Rank changes.

## Memory and numerical implementation

The existing block size is reduced from 8388608 to 1048576, with the row grid
changed from 2048x4096 to 256x4096. A Loops=500 sweep checked identical answers
with 1M, 2M and 8M blocks; the smaller block was selected for memory. Samples
in that sweep are exploratory, not a repeated timing comparison.

The original tail harmonic estimate used `log(n) + Euler + 1/(2n) - 1/(12n^2)`
followed by additions of `1/(120n^4)` and `-1/(252n^6)`. The tail starts after
n=1000000. At that boundary those last terms are at most 8.34e-27 and 3.97e-39,
while half an ulp of the rounded harmonic value is already about 8.88e-16.
Each of those additions rounds back to the preceding Float64 value. They are
removed. The retained quadratic denominator uses real multiplication,
`12.0 * Coins * Coins`, avoiding general powers and integer-to-real conversion
in the hot loop. This changes arithmetic association at floating precision;
small inputs are checked against a direct harmonic recurrence and the full
answer is checked against the frozen original implementation.

Finally, the last-block search uses Boolean `any` followed by `find true`.
The old code built an array of every matching coin index and read only its
first element. The search retains the original strict `Reach > Target`
condition and handles an upper bound crossing that contains no actual hit.

These are changes to the numerical implementation and array pipeline; the
coin-counting recurrence and complete search remain in place.

## Verification

- 312 focused Mac tests passed before and after integration with main, including
  existing tensor, binding-contract, numeric-call and domain-proof tests.
- 99 focused Intel tests passed, including the real recipe tests and both
  compilation modes of the Euler 737 tests.
- Sixteen problem tests compare against a direct harmonic recurrence for
  0, 1, 2, 3, 10, 11, 20 and 50 loops. A shortened exact prefix and small blocks
  exercise the tail and multiple block boundaries. The independent reference
  uses no Euler-Maclaurin estimate.
- The published 31, 154 and 6947 coin examples are checked. Source:
  https://projecteuler.net/problem=737.
- The full default compiled golden test asserts `757794899` and native tensor
  preparation. It passed both before and after integration with main.
- TypeScript build, semantic-boundary checks (65 owners) and application-form
  checks passed. No exhaustive audits or full workspace test suite were run.

Real-recipe tests cover per-cell parity, mixed numeric types, broadcasting,
signed zero, NaN, infinities, domain failures and their source locations,
unused invalid plans, partial indexed demand, shadowed functions, cancellation,
budgets and retry. The raw logs are beside the measurements.

## Reproduction

Build outputs before running a benchmark:

```sh
npm run langium:generate
node node_modules/typescript/bin/tsc -b tsconfig.build.json
node benchmarks/euler737.mjs
node benchmarks/euler737.mjs 202
node benchmarks/euler737.mjs 20 reference
RANK_SOURCE=benchmarks/fixtures/euler737-original.ra node benchmarks/euler737.mjs
PROFILE=/tmp/euler737.cpuprofile DIAGNOSTICS=1 node benchmarks/euler737.mjs 202
node benchmarks/experiments/euler737-chain.mjs
```

`RANK_ROOT` selects another built checkout. Use a frozen original source for
baseline full-program runs; do not combine profiling or diagnostics with the
primary timing series. Intermediate source experiments and their raw outputs
are retained under `experiments/euler737-*` and `results/euler737/`.
