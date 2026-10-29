# Euler 594 investigation

Investigated against `ea2e432db79de85531287f7f77549e3a180587d2`, macOS arm64,
Node v24.15.0. The admissible-word/valid-subset variant is now in the production demo.
The interpreter, fixture assertions and execution lanes are unchanged.
`experiments/euler594-original.ra` retains the original source for controls.

## Findings

The existing recurrence is exact inclusion-exclusion over non-overlapping
adjacent ascents of a multiset word. The expensive part is how states and
subsets are enumerated, especially under ordinary interpretation.

For A=4, B=2 the source scans 4^12 = 16,777,216 words and decodes all 12 digits
of each. Only 12!/(4! 2! 4! 2!) = 207,900 words have the required multiplicities.
It then calculates inversion counts, sorts those states, and scans all bit
masks of ascents, including overlapping subsets that it subsequently discards.
The inner scan repeatedly computes powers of 2 and 4.

The current compiler already handles the important loops: original full runs
record six compiled/Number loops, no Number overflow and no loop-compilation
rejections. The scalar-expression rejection for top-level `**` does not mean
the enclosing counted kernels are interpreted. This workload does not reveal
a missing compiled loop feature.

## Prototype

1. Generate multiset permutations in numeric-code order, visiting only valid words.
2. Remove inversion counting and sorting: swapping an ascent at low-digit
   position p reduces its code by 3*(right-left)*4^p, so every dependency has
   already been computed in increasing code order.
3. Precompute powers. Grow subsets by appending an ascent only if it does not
   overlap the previous selected ascent. Toggle its inclusion-exclusion sign
   and accumulate its table value immediately. Every nonempty valid subset
   is generated exactly once.

The recurrence and exact integer arithmetic are unchanged. The implementation
still uses the large dense table; memory compaction is a separate follow-up.
An index/map could save table space but its effects on Number compilation
and speed have not been measured. Do not call this a memory optimization.

## Measurements

Three fresh sequential processes per full compiled control and final reference
variant. No own tests/builds ran concurrently. Host load is uncontrolled;
earlier exploratory runs were substantially slower and are not pooled here.
Times include parse + execute and exclude importing the interpreter.

| Full A=4, B=2 | Median | Range |
| --- | ---: | ---: |
| Original, compiled | 2.234 s | 2.207–2.243 s |
| Valid words and no sort, compiled | 0.869 s | 0.859–0.869 s |
| Also precomputed powers, compiled | 0.488 s | 0.487–0.496 s |
| Also valid-subset generation, compiled | 0.264 s | 0.263–0.271 s |
| Optimized demo, reference | 19.061 s | 18.959–19.094 s |

Full compiled improvement is 8.46x. Original full reference was externally
stopped after 45 seconds while still scanning codes; it did not finish.
Consequently this investigation does not claim a completed full-reference
before/after speedup. The >1200-second stop in issue #447 is historical data,
not a current controlled baseline.

Completed A=3, B=2 reference comparison (one fresh process each):
original 15.780 s, optimized demo 2.075 s, 7.61x. The original spends about 12 s
before the sorting/DP stages. Both return 456572.

## Reference engine

A separate full reference CPU profile finishes in 18.814 s. Top self samples
are distributed across application classification (5.1%), prepared name reads
(4.7%), scalar array-assignment dispatch (4.2%), frame.get (4.2%), native-function
checks (3.7%), mutation guards (3.3%) and selection (3.0%). GC is about 1.9%.
These are self samples, not disjoint end-to-end opportunities to add together.

General interpreter candidates are cheaper guarded scalar array reads,
less repeated application-role classification, binding lookup, and scalar cell
writes. Some shortcuts already exist, including prepared direct arithmetic
and scalar vector writes: this is not evidence those features are missing.
Any further change should preserve live rebinding, lazy demand, error timing,
mutation protection and inspection. No interpreter implementation change or
speedup from such a change has been demonstrated in this investigation.

## Verification and reproduction

All repeated full runs return 47067598. The prototype passes the statement
values 8, 76 and 456572 in both engines; original compiled runs agree.
These are the independent golden examples from
[the problem statement](https://projecteuler.net/problem=594), plus the existing
full golden answer. The delivery checks below add per-state comparison to the original source.

After building the interpreter:

```sh
node benchmarks/euler594-investigation.mjs 4 2 compiled original
node benchmarks/euler594-investigation.mjs 4 2 compiled shipping
node benchmarks/euler594-investigation.mjs 4 2 reference shipping
node benchmarks/euler594-investigation.mjs 3 2 reference original
```

Use `RUNTIME=/absolute/path/to/packages/interpreter/out/index.js` to select an
isolated build. An external process watchdog is needed for long synchronous
reference runs. Raw samples, diagnostics and profile summaries are retained in
`baselines/2026-10-29-euler594-investigation.json`.

## Delivery verification

Final parent: `dcd0ca270d7040703cdfd87ec13e641e3d7c60f3`. Removed the
prototype's unused `Bt` table; the recurrence is unchanged. Fresh sequential
controls for the final source, three processes per case:

| Full A=4, B=2 | Median | Range |
| --- | ---: | ---: |
| Preserved original, compiled | 2.236 s | 2.222–2.277 s |
| Shipping demo, compiled | 0.273 s | 0.262–0.327 s |
| Shipping demo, reference | 19.368 s | 18.980–19.382 s |

Compiled speedup is 8.19x. All nine runs return 47067598. These final controls
are recorded separately from the earlier prototype investigation.

- Both package builds and interpreter test TypeScript checking pass.
- Scoped corpus type/differential audits: two files, four checks pass. This
  executes both the full main and all fixture assertions in both engines.
- `euler594-crosscheck.mjs` compares every admissible state's code and exact
  DP value to the preserved original on ten inputs, including the full input,
  A=B=0, and each single-zero case: 237,129 states agree.
- Semantic script tests: 11 pass; semantic boundaries: 65 owners pass.
- The fixture retains its full golden assertion and all three statement examples.
  No timeout or exclusion has been raised or added. The full package suite was
  not rerun for this demo-only algorithm change.

Reproduce the state check with:

```sh
node benchmarks/euler594-crosscheck.mjs
```
