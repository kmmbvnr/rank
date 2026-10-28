# Euler 196: compact integer comparison masks

The unchanged Euler 196 array program is **1.98x faster**, with **29.5% lower peak process RSS**. The segmented sieve, triplet enumeration, full defaults, golden answer and fixture assertions are unchanged. The experimental scalar accumulation loop was not adopted.

## Implementation

Stored Int32 arrays now use native `equal`, `not equal`, `less`, `greater`, `at most` and `at least` comparisons to construct a bitmap directly. This removes per-input BigInt boxing, scalar comparison dispatch and the intermediate ordinary boolean array. Existing packed `indices` consumers then scan the bitmap by words. No new `indices` syntax or special Euler recognition is needed.

Scalar Int32 operands, array broadcasting and regular linear stored views are supported. Both operands are proved before execution; only internal uniform element-contract checks may be hoisted. Work is private, polls every 4096 cells and publishes only on completion. Interrupted work is discarded. Ordinary `=` remains a completion boundary, and later source mutations do not alter completed masks.

Wide integers, mixed integer/real comparisons, missing cells, unread or replaced readers, unsupported views, nonuniform validation, inspection and arbitrary host polling retain existing execution. Comparisons below the existing dense-kernel threshold of 1024 cells retain their ordinary demand path. This threshold affects admission only, not array limits or exactness. Existing native implementation dispatch remains in charge of whether the builtin mapper is invoked.

## Controlled measurements

Apple M5, macOS arm64, Node v24.15.0. Baseline: `33d233742e2adabb27e801d082df94d127979751`. Three serial fresh processes per workload/version, alternating before/after order. The same unchanged demo sources run against baseline and modified runtimes.

| Workload | Before | After | Speedup | Peak RSS before / after |
| --- | ---: | ---: | ---: | ---: |
| Full main | 2.219 s | **1.122 s** | **1.98x** | 761.1 / **536.3 MiB** |
| Unchanged fixture | 2.244 s | **1.165 s** | **1.93x** | 755.0 / **538.2 MiB** |

All figures are medians. Main ranges: 2.209–2.232 s before and 1.113–1.132 s after. Fixture ranges: 2.243–2.272 s before and 1.162–1.170 s after. Fixture peak RSS falls 28.7%. RSS is whole-process peak, not retained heap or an allocation-volume measure.

Timing includes interpreter construction, parsing, compilation and complete execution. Imports and assertions are outside the timer. RSS is sampled before assertions. Builds, tests, diagnostics, profiles and oracle checks ran outside these performance samples. The isolated build avoids concurrent grammar/ML/mobile edits in the shared checkout; its two modified runtime files were byte-compared with the delivered sources.

Euler 195 is an unchanged-source control using the same before/after runtimes and three alternating fresh-process samples. Its medians are 789.6 / 788.3 ms, with overlapping ranges (782.8–792.7 / 786.6–793.8 ms); no control regression or further speedup is claimed.

## Why this was slow

The algorithm already uses a five-row segmented sieve rather than generating primes up to the roughly 10^13 triangle values. Sieve storage is O(N); the local-neighbour scan is O(N). The default strips contain 28,390,135 and 36,043,925 cells.

The nested scans already compile. Full before/after diagnostics show six compiled loops, four Number loops, no overflow restarts, no typed unpacks, zero ordinary computed cells, and no compiler rejections. The outer two-element iteration remains interpreted. Zero `cellsComputed` does not mean zero generic cell processing: eager array kernels have separate accounting.

A separate baseline CPU profile attributed about 0.803 s self time to `mapDenseArrays`, 0.380 s to bulk `writeIntegerSelection` and 0.305 s to generated functions. The expensive final `(Mk equal 1) indices` comparison was going through generic eager mapping. The final row's interval between the scan checkpoint and completion falls from about 0.641 s in the diagnostic baseline to 0.042 s in the final diagnostic. These are separate single observations, not benchmark medians.

The initial scalar-tail experiment reduced the full main to 1.088 s, but required replacing array expressions with another explicit loop. The shipped runtime improvement reaches 1.122 s while retaining the array source. These experiments belong to separate measurement cohorts; do not treat their small difference as a controlled comparison.

The initial full reference main returned the golden answer in 69.774 s, with 2918.1 MiB peak RSS. This was a single validation partly overlapping small oracle checks, not a controlled reference estimate. The final reference main and fixture also pass the forced differential audit; its instrumented times are not comparable with standalone benchmarks.

## Verification

- Parser/TypeScript build and interpreter test typecheck pass in the isolated baseline-plus-change checkout.
- Semantic checks pass (11 checks, 65 owners); application-form checks pass.
- Broad ordinary interpreter suite: **401 files, 9073/9073 tests pass**. Exhaustive type/differential corpora and Nurikabe remain separate lanes.
- Initial focused selection: 91 tests pass. Final strengthened comparison suite: 21 tests pass, including all predicates, broadcasting, word tails, Int32 extrema, wide/mixed exact fallback, strided selections, rank-two coordinates, ordinary completion, opaque/replaced readers, host polling and interruption after a completed private chunk.
- Four forced type/differential checks pass for the full main and fixture; both embedded fixture blocks pass. Euler 196 was removed from exclusions only inside the temporary validation checkout to force these checks. Repository exclusions, lanes and deadlines are unchanged.
- 36 independent checks: nine row pairs, both engines and both original/experimental source variants. The oracle trial-divides individual values and checks the prime-neighbour graph directly. Pairs (1024,1100) and (1500,2000) exercise sizes admitted by the new mask kernel.
- All full benchmark samples assert **322303240771079935**. The fixture preserves the statement values S(8)=60, S(9)=37 and S(10000)=950007619.

## Reproduction

After building, run each sample in a fresh process:

```sh
node benchmarks/euler196-prime-triplets.mjs
node benchmarks/euler196-prime-triplets.mjs --fixture
node benchmarks/euler196-prime-triplets.mjs --diag --phases
node benchmarks/euler196-prime-triplets.mjs --reference
node benchmarks/euler196-prime-triplets.mjs --n1=1500 --n2=2000 --oracle
```

Use `--runtime=/absolute/path/to/packages/interpreter/out/index.js` for isolated before/after builds. `--variant=tail` retains the rejected source experiment for comparison. Raw initial investigation: `baselines/2026-10-27-euler196-investigation.json`; final serial samples, controls, oracle results and verification logs: `baselines/2026-10-27-euler196-optimization.json`.

Odd-only sieve storage remains an unmeasured possible follow-up. General reference-engine overhead and the historical execution-budget exclusions remain open; this change completes the investigated array-mask bottleneck.
