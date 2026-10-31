# Euler 300 — protein folding investigation

Selected as the next unfinished problem in issue #447 after 299. Baseline:
`5411f07032e2dbade2e779d96cd8b29d305f71a7`, Node v24.15.0, macOS arm64.
The sections below record the initial investigation. The delivered implementation
and its verification are recorded in the final section.

## Where time goes

The program enumerates self-avoiding lattice walks, canonicalizing rotations
and reflections and deduplicating their contact graphs. It then computes each
contact graph's score for every one of the 32768 H/P assignments at N=15,
retaining the maximum score per protein. Chain-neighbor contacts are invariant
across folds and added separately. The full result is 8.0540771484375.

The existing algorithm is exponential in both walk enumeration and protein
assignments. Deduplication is useful, but all 12495 contact graphs are scored,
including graphs contained in other graphs. Even one full-array pass per graph
visits 409436160 cells; the source makes several passes per graph, one per
non-chain contact, plus initialization and pointwise maximum.

An exploratory diagnostic run at N=15 split the work as follows:

| Stage | Compiled | Reference |
| --- | ---: | ---: |
| Enumerate and deduplicate walks | 1.272 s | 15.543 s |
| Prepare protein bit rows | 0.024 s | 0.060 s |
| Score all contact maps | 11.799 s | 12.469 s |
| Add chain contacts and reduce | 0.022 s | 0.018 s |

These are single diagnostic samples, not the repeated timing table below.
The slow historical exclusion is not a current multi-minute result on this
machine: both full modes finish. Host load is uncontrolled and timings vary.

## Compiler findings

Enumeration already uses one compiled exact-integer loop, with 296806 compiled
set-add effect calls in the full diagnostic run. This region uses mutable
containers and arbitrary-width bit keys, so it cannot simply be forced into
Number mode. The key encoding includes bit positions above 200 at N=15.

Scoring compiles the inner I/J loop once per graph (12495 executed loops), but
not the enclosing `for Ky in Keys array`. Diagnostics report a loop-header
rejection for that materialization expression and `tensor:binding:max` for
the completed `Best max Cn copy` expressions. No Number loops execute. Merely
naming `Keys array` would address only the header syntax, not the remaining
body/backend restrictions. The newly introduced private numeric vector stages
recognize arithmetic/comparisons/gcd, but do not yet recognize array `min/max`
or native bitwise array operations. Existing tensor machinery does support
some of these operations, so this is an integration/generalization opportunity,
not a claim that the language lacks those builtins.

The small Bm preparation loop also rejects the deferred Ai' binding. Its
~24 ms compiled cost is negligible compared with scoring; removing deferred
admission checks would be semantically wrong and is not recommended.

Useful compiler follow-up: support pointwise min/max and suitable native bit
operations in private array stages, then separate exact wide-key decoding from
the narrow score-array region. Preserve arbitrary-width key semantics rather
than coercing keys to Number. Any speedup remains to be measured; no compiler
prototype was installed during this investigation.

## Algorithm experiment: maximal contact maps

If contact graph A is a subset of B, then score(A, protein) <= score(B, protein)
for every protein: every scored H-H contact has weight 0 or 1. Thus A can be
discarded without changing any maximum, independent of the protein sequence.
The same chain contacts appear in every original key and do not affect subset
comparisons or popcount ordering.

Sort keys by decreasing popcount. Retain a key only if no previously retained
key contains it. This leaves **3409 of 12495** contact graphs at N=15, a **72.7%**
reduction. It preserves the existing array formulation for protein scoring.

Two reproducible Rank prototypes:

- `experiments/euler300-maximal.ra`: array bitwise/comparison/any over retained
  keys. Compact, but constructs intermediate array expressions before its reduction.
- `experiments/euler300-maximal-scalar.ra`: short scalar subset loop with early
  exit. Exact loop compilation handles the wide bit keys. Faster compiled
  pruning in exploratory runs; reference execution needs separate measurement
  because interpreted nested subset loops can be costly.

Removing the final `copy` alone is also measured as a control; it does not
reduce the dominant number of score-array passes.

## Repeated serial measurements

Three fresh processes per case, rotating order across rounds. Parsing and
execution included, import/startup excluded. Stages execute as consecutive
source fragments in one interpreter, with identical boundaries for matching
variants; maximal variants additionally separate pruning. This is not a
monolithic CLI benchmark. No own verification/build/profile jobs overlap the
samples. RSS is process peak and includes runtime overhead. Other machine load
is uncontrolled; the broad ranges prohibit small performance claims.

| Mode / variant | Median | Range | Median peak RSS |
| --- | ---: | ---: | ---: |
| compiled / original | 15.449 s | 15.370–18.593 s | 349.8 MiB |
| compiled / nocopy | 17.817 s | 17.153–19.124 s | 488.7 MiB |
| compiled / maximal-scalar | 7.642 s | 5.440–9.975 s | 378.6 MiB |
| reference / original | 38.599 s | 35.072–39.395 s | 561.5 MiB |
| reference / maximal | 32.328 s | 29.646–33.793 s | 577.5 MiB |

The scalar-pruning compiled prototype improves the median about **2.02x**,
with a slightly higher median process peak RSS. Reference array pruning improves
about **1.19x**, without an established memory reduction. The nocopy control is
slower in all three compiled samples; deleting that copy is not a demonstrated
optimization. The faster strategy differs by execution mode, so production
selection and further optimization should preserve both-engine checks.

## Verification and scope

The JS oracle uses recursive coordinate-walk enumeration and independently
scores each H/P assignment. It excludes chain edges from its contact keys,
unlike the Rank implementation. Unrestricted four-direction enumeration at
N=2..10 verifies the symmetry-restricted graph collection. At N=2..12 the
original and maximal JS graphs must give the same best score for every protein;
the original and both Rank prototypes are compared with those per-protein
vectors and exact averages in both execution modes. Existing fixture assertions
are also run against all three programs in both modes. Verification passed:
**66 exact averages**, **49128 individual Rank best-score cells**,
and **12 fixture tests**. No full suites or exhaustive corpus audits were run.

The full answer check in every timed sample is regression agreement, not an
independent full-N exhaustive optimal-score oracle. These initial measurements precede the implementation described below.

Reproduce after building:

```
node benchmarks/experiments/euler300-contacts.mjs 15
node benchmarks/experiments/euler300-verify.mjs
node benchmarks/experiments/euler300-samples.mjs
DIAGNOSTICS=1 node benchmarks/euler300-investigation.mjs compiled original 15
```

Raw results: `baselines/2026-10-31-euler300-{diagnostics,samples,verification}.json`.


## Delivered implementation

The production program retains array score computation and adds maximal-map
pruning. Popcounts order keys by decreasing contact count. Keys are tested only
against retained keys from strictly larger popcount groups: different sets of
equal cardinality cannot contain each other. The production predicate remains
a compact array bitwise/equality/any expression. Both scoring and the arbitrary
width of contact keys retain their original semantics. At N=15, 3409 maps are
retained out of 12495. The existing copy at the score maximum is retained;
deleting it alone was not a measured improvement.

A separate reusable compiler extension admits native pointwise min/max and
band/bor/bxor/bit/shl/shr in private numeric array stages. These reuse scalar
builtin identity guards and existing safe-integer/Int32/replay rules. Wider
keys are never truncated. Real extrema retain native tie, NaN and signed-zero
behavior; mixed unsupported domains use the existing fallback. No admission
constant or copy threshold was changed.

Composing a lowered vector extremum inside arithmetic exposed a frontend
ordering problem: syntax recognition expanded the substituted extrema again
before consulting the provided scalar cell. The optional `substitute` hook now
lets a backend-proved cell take precedence over syntax recognition. Other
frontend clients retain their existing ordering. Regression tests exercise
composed native stages, exact wide/negative bits, invalid shifts, shadowed
functions, real extrema/broadcasting, NaN operand order, and bit mask filters.

Both Euler 300 source and fixture are restored to ordinary corpus audits.
Fixtures add N=2 and N=4 boundaries without reducing the existing N=5,8,10,12
checks. A full compiled N=15 regression asserts the exact average and 3409
retained contact maps.

### Delivery measurements

| Version / mode / source | Median | Range | Median peak RSS |
| --- | ---: | ---: | ---: |
| before / compiled / original | 15.108 s | 13.257–15.929 s | 423.1 MiB |
| after / compiled / original | 13.274 s | 10.083–15.154 s | 379.6 MiB |
| after / compiled / production | 7.106 s | 7.029–9.799 s | 561.9 MiB |
| before / reference / original | 30.558 s | 24.198–32.333 s | 634.0 MiB |
| after / reference / production | 22.914 s | 20.560–23.059 s | 531.2 MiB |

| Fused native stage | Before median | After median | Peak RSS before / after |
| --- | ---: | ---: | ---: |
| band + arithmetic + sum | 801.8 ms | 270.7 ms | 252.9 / 154.0 MiB |
| max + arithmetic + sum | 342.9 ms | 229.1 ms | 247.9 / 156.0 MiB |

The rewritten full program improves compiled median **2.13x** and reference
median **1.33x** versus the baseline original. The unchanged-source compiled
ranges overlap; no separate Euler compiler speedup is established. The full
differential audit reports zero Number-loop entries for Euler 300: its wide-key
work remains exact. Native-stage controls independently confirm the new Number
path and improve fused band/max expressions by their measured medians.

Euler 300 compiled peak RSS **increases from 423.1 to 561.9 MiB** in this series;
reference peak decreases from 634.0 to 531.2 MiB. Pruning array temporaries and
GC behavior affect the process peak. This implementation prioritizes elapsed
time while retaining array scoring; it does not establish an Euler compiled
memory improvement. Native-stage controls have lower process peaks separately.


The archived original source is kept in `experiments/euler300-original.ra`.
The timing harness can use `RANK_BENCH_RUNTIME` to load only one runtime per
process. Recreate the baseline runtime by copying the built interpreter into
/tmp and restoring/transpiling its loop-expression backend from 89931868:

```
node benchmarks/experiments/euler300-build-baseline.mjs /tmp/rank300-before
node benchmarks/experiments/euler300-delivery-samples.mjs /tmp/rank300-before/out/index.js
```

This restoration isolates the changed compiler backend; the current shared
frontend's optional hook is not used by the restored backend. The matched delivery baseline is 89931868, which also contains independent
sorted-index improvements. Both sides of the delivery comparison include
those improvements. Initial research samples above predate this controlled
delivery comparison and are not used to attribute its compiler effect. Do not attribute algorithm speedups to the
compiler: full-program rows separate unchanged original and rewritten source.
Native-stage controls separately exercise compositional compiler support on
262144 cells for 120 iterations; they check closed-form totals. Their process
RSS includes startup overhead. These are host-specific observations with
uncontrolled machine load, not Intel results or universal speedup guarantees.

### Delivery verification

- TypeScript project build passed.
- Language package: 65 files / 1492 tests passed.
- Ordinary interpreter suite, excluding exhaustive types/differential/Nurikabe
  audits: 448 files / 10299 tests passed.
- Scoped type, differential and name-facts audits: both source and fixture
  passed in each audit (six checks). Full differential source/fixture includes
  runtime telemetry and takes longer than the raw timing harness.
- Independent N=2..12 verification: 88 exact average comparisons, 65504 Rank
  per-protein best-score cells, and 16 fixture tests passed across original,
  two research variants and production, in both engines. Symmetry restrictions
  are independently checked against unrestricted walks through N=10.
- All 15 full-input samples preserve 8.0540771484375. All 12 native-stage
  controls preserve closed-form expected totals.

Raw matched delivery data: `baselines/2026-10-31-euler300-delivery.json`.
