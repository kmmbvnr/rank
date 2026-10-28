# Euler 236: compact bounded sums and one compiled search

The full default input and both fixture assertions remain unchanged. The answer
is `123/59`; the search still counts all 35 admissible fractions. No answer table,
floating-point cutoff, runtime change or compiler-budget increase is used.

## Change and correctness

The existing reduction into three groups is retained. For each primitive first
product pair `(A, B)`, the candidate multiplier is `41 B / (5 A)`. The former
minimal-denominator test is exactly `gcd(A, B) = 1`: the reduced spoiled-count
ratio for that product is `B/A`.

Reject a candidate early when either necessary stock bound fails:

- cake denominator `5 A / gcd(59 B, 5 A) <= 1312`;
- port denominator `450 A / gcd(2419 B, 450 A) <= 5760`.

The remaining per-product numerator and denominator bounds are still checked.
Only 7040 candidates satisfy all of them. Every integer between a group's lower
and upper sum is achievable, since each constituent multiplier ranges over a
contiguous integer interval.

Instead of extended Euclid and an array-returning interval helper, enumerate the
bounded sums of groups 0 and 2 and solve group 1 by exact divisibility. Normalize
the three equation coefficients by their common gcd. Division by coefficient 1
is safe: it is strictly negative for `m > 1`, since `15744 * 41 < 18880 * 59`.
The independent oracle needs only 217265 pairs across all surviving candidates.

## Compiler findings

The original exceeds the 128-statement region budget and launches 3,738,100
separately compiled regions (3,731,060 Number regions). Replacing only the manual
gcd loops did not materially improve time. It exposed another conservative
barrier: `array-call-write-region`, guarding against an array-returning helper
sharing caller storage after entry copy-on-write. Raising the statement cap
alone would not remove that ownership barrier.

The shorter solver compiles the entire search into one Number region. An
exploratory version without early denominator bounds took 1.004 s, versus about
0.632 s with them in the research cohort. This separates the large benefit of
compiling the search together from the additional early-pruning benefit.

A future general compiler improvement could prove fresh/non-aliasing helper
return provenance or perform ownership preparation at individual stores. This
investigation does not establish a compiler correctness defect.

## Final comparison

Node 24.15.0, macOS arm64. Runtime rebuilt from parent `45743956`, including the
`arg` input migration. Each timing sample is a fresh sequential process, with
diagnostics enabled; import is excluded, parsing and preparation are included.

| Full input | Original | Shipping |
|---|---:|---:|
| Compiled, median of 3 | 16.560 s | 0.563 s |
| Compiled samples | 17.957 / 16.560 / 15.890 s | 0.659 / 0.559 / 0.563 s |
| Reference | 54.355 s, single sample | 5.604 s, median of 3 |
| Reference shipping samples | — | 6.264 / 5.604 / 5.459 s |
| Compiled peak RSS, median of 3 | 494.17 MiB | 202.14 MiB |

The compiled speedup is about 29x. Reference baseline is a single control run,
not a repeated median. Peak RSS is reported per sample in the raw JSON. Earlier
research used the previous runtime/input syntax; those measurements are kept in
a separate `research` field and are not pooled with this delivery cohort.

## Verification and reproduction

The independent JavaScript enumeration finds exactly 35 fractions. Traced
original compiled, shipping compiled and shipping reference runs must match its
entire fraction list, not merely its maximum. Both original fixture blocks run
in both modes. CLI checks and the existing filtered differential/type audits
cover both files. Both execution-budget exclusions are removed so ordinary
corpus checks cover the optimized solver.

```sh
npm run langium:generate
npx tsc -b tsconfig.build.json
node benchmarks/euler236-luxuryhampers.mjs --original
node benchmarks/euler236-luxuryhampers.mjs
node benchmarks/euler236-luxuryhampers.mjs --reference
node benchmarks/euler236-luxuryhampers.mjs --fixture
node benchmarks/euler236-luxuryhampers.mjs --fixture --reference
node benchmarks/euler236-luxuryhampers.mjs --solutions
node benchmarks/experiments/euler236-oracle.mjs
```

Use `--runtime=/absolute/path/to/interpreter/out/index.js` to select an isolated
build. Full interpreter suite and Intel measurements were not run for this
solver-only change. Raw sources, timing samples and verification logs are in
`benchmarks/baselines/2026-10-28-euler236-investigation.json`.
