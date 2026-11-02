# Euler 336: exact order selection and compiled text slicing

2026-11-02, issue #447. The demo now builds only the needed first-character
bucket and allocates each stage directly as a text array. The compiler admits
text `take`/`drop` through its existing shared slicing implementation.

## What changed

The old demo builds and sorts all 362,880 eleven-carriage maximix arrangements.
The penultimate stage has 40,320 strings. At the final stage, the first reversal
starts at zero; each following reversal starts after zero. Every parent's N-2
children therefore retain the parent's last character as their first character.
Count these groups, adjust the requested rank, and expand only the selected
group. The default selects C, with 45,360 children. No counts are estimated and
no packed numeric representation replaces the strings. Worst-case complexity
remains factorial; this is exact pruning of the requested order statistic.

Each stage's output size is known: parent count times branching factor, or the
chosen group's exact count at the final stage. A directly allocated text array
replaces the queue and its materialization. This also makes the existing text
array loop compiler applicable: the default executes ten compiled loops,
102,548 compiled scalar helper calls, and zero CoW copies. The original executes
455,348 helper calls, none compiled. Text queues would require a broader compiler
extension; they are unnecessary here.

The original `revsuffix` helper fails compilation on `Text (0 till I)`.
The compact replacement keeps array-style operations:

```rank
fun Text revsuffix I
  Front = Text take I
  Back = (Text drop I) reverse
  return Front + Back
end
```

`jit/scalar-function-proof.ts` previously rejected every scalar domain in its
count-clause branch. It now admits text as well as the existing arrays. Kernel
lowering already invokes `takeDropValue`, so this general compiler fix needs no
new runtime operation. It preserves Unicode code-point slicing, clipping and
ordinary errors, native identity guards and CSP fallback. It does not fuse all
text copies. The demo's internal suffix indices are in bounds; take/drop is not
a universal replacement for out-of-bounds range selection.

Out-of-range ranks still fail instead of producing unfilled strings. N=2 and
all valid small ranks remain supported. The unused `algo` import is removed.

## Final measurements

Node v24.15.0 on Mac arm64 and Intel x86_64. Three serial fresh processes per
compiled case/host; helpers are defined outside the timed call. Every sample
checks the full answer `CAGBIHEFJDK`. Diagnostics are collected separately.
Other machine activity is not controlled. RSS is the whole-process high-water
mark, including startup and temporary allocation, rather than retained strings.
No loader is used in the headline samples.

| Full default | Mac time | Mac RSS | Intel time | Intel RSS |
| --- | ---: | ---: | ---: | ---: |
| Original | 4764.26 ms | 569.08 MiB | 20126.99 ms | 542.77 MiB |
| Delivered | 183.19 ms | 189.20 MiB | 369.51 ms | 176.73 MiB |

About 26x / 54x faster and 67% lower peak RSS on these samples. Early Mac
production controls were about 130 ms; the final repeated series was 181-185 ms.
Use the final figures, with normal short-run/environment uncertainty.

Single Mac reference controls, not medians: 5303.30 -> 1979.70 ms,
568.08 -> 482.39 MiB. The reference benefits from pruning, but it does not get
compiled text-array generation's speed and allocation reduction.

Compiler-only control on the delivered source, disabling only the new admission
through an exact-matching Node loader: Mac 1954.39 -> 183.19 ms;
Intel 5956.84 -> 369.51 ms. These disabled-proof controls are single samples,
include loader overhead, and do not isolate retained memory. They confirm
that changing only the demo syntax is insufficient.

Intel used `/opt/rank-bench-node/bin/node` in `/tmp/rank336-delivery`, with fresh
built interpreter/language outputs and both package links verified to resolve
inside that snapshot. No shared runtime was edited.

## Verification

- 352 focused tests pass: Euler 336, scalar-function kernels/proof/captures,
  loop control and Number loops. No full suites or exhaustive audits were run.
- The independent oracle enumerates every permutation for N=2..8, then simulates
  forward train sorting. It retains exactly the orders requiring 2N-3 reversals.
  Tests compare every maximix rank through N=7 and first/second/middle/last ranks
  at N=8 in both engines, plus invalid ranks and repeated calls.
- Full golden assertion uses the actual production helpers and requires compiled
  loops and zero CoW copies. Both existing CLI fixtures pass.
- Text take/drop compiler tests compare 56 cases against both the reference and
  a native code-point oracle: empty/BMP/supplementary/combining/lone-surrogate
  text and negative, zero, ordinary and huge counts. Source strings contain
  literal surrogate code units, not unsupported JSON Unicode escape spellings.
- A linked Unicode reversal/loop case checks values and compiled invocation.
- Standalone benchmark oracle passes 43 checks in each engine; the full reference
  oracle also passes on Intel.
- TypeScript build, three execution-exclusion metadata checks and whitespace
  checks pass.

The full default retains its resource-audit exclusion: uncompiled execution
still produces tens of thousands of strings and approaches 482 MiB in a single
process. The exclusion reason is refreshed; small tests stay in both audit modes,
with a dedicated full compiled regression test.

## Reproduction

```sh
node node_modules/typescript/bin/tsc -b tsconfig.build.json
node benchmarks/euler336-investigation.mjs original
node benchmarks/euler336-investigation.mjs production
node benchmarks/euler336-investigation.mjs production reference
node benchmarks/euler336-investigation.mjs production verify
node benchmarks/euler336-investigation.mjs production verify-reference
TEXT_SLICING=0 node benchmarks/euler336-investigation.mjs production
node benchmarks/euler336-investigation.mjs production compiled 11 2011 diag
```

Focused tests, from `packages/interpreter`:

```sh
node ../../node_modules/vitest/vitest.mjs run \
  --config ./scripts/type-audit.config.mjs --maxWorkers 4 \
  test/euler336.test.ts test/scalar-function-kernel.test.ts \
  test/scalar-function-proof.test.ts test/compiled-scalar-captures.test.ts \
  test/loop-control.test.ts test/number-loop.test.ts
```

Final raw samples and diagnostics are in
`baselines/2026-11-02-euler336-delivery.json`. Earlier exploratory samples are
kept in `baselines/2026-11-02-euler336-investigation.json`. Historical Rank
variants in `experiments/euler336-*.ra` show pruning, explicit character loops,
and queue/preallocated-array alternatives; only `production` loads the delivered
source. The earlier loader-based proof prototype is superseded by the real fix
and the harness's `TEXT_SLICING=0` control.
