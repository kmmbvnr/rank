# Euler 305: Reflexive Position

## Delivered implementation

The array transformation algorithm is retained. Numeric transformation IDs,
composition memoization and memoization of complete decimal-width prefixes avoid
repeating work during binary search. Defaults and exact answer
**18174995535140** are unchanged. Composition still uses `E = EY EX` and
`A = AX + AY EX`, with exact Rank integers; there is no table of known answers.

The generic runtime improvement is prepared record signatures and contracts:

- Runtime-owned `FieldContracts` maps carry an opaque version token, not a
  bounded numeric counter. Immutable equivalent copies of array/tuple metadata
  keep the canonical existing type node; only a structural change invalidates
  the token.
- Flat metadata with no live record descendants can reuse its exact existing
  JSON type encoding. Mutable nested maps and external maps keep recursive
  guards, so nested alias writes and empty-array refinement remain visible.
- Record contract wrappers are weakly cached by their live field map. Reapplying
  an owned record's own flat contracts is a no-op and is skipped only when no
  tuple demand or custom/accessor-backed entry-map reads can be observed.
- The last-call signature guard checks cheap scalar/array changes before walking
  record metadata. A miss must not encode the same record twice.
- Metadata caches contain strings/type nodes and weak keys, not record values,
  array data or computed plan results. Non-record arguments keep their previous
  signature encoding path. Field writes, return checks and error semantics are
  retained.

This improves shared compiler/interpreter call preparation. It does **not** add
whole-helper JIT support for this record/index graph; scalar-function kernel
entries remain zero. Broader guarded record lowering, array-valued index reads
and text interning remain further general compiler work.

### Final matched delivery measurements

Apple M5, Node v24.15.0, 2026-11-01. Three fresh serial processes per case,
rotating six cases. Snapshots include the same concurrent window work based on
`2a43b3bd` and the shared ordinary encoder; only record-contract/return-contract
preparation and their helper modules differ. Other generated JS files match.
Imports/startup are excluded; parsing/execution are timed. Peak RSS includes the
whole process. Every full input asserts the golden answer.

| Full source / runtime | Compiled wall median, s | CPU median, s | Peak RSS median, MiB |
| --- | ---: | ---: | ---: |
| Original / before | 14.552 | 17.127 | 623.7 |
| New array program / before | 5.913 | 7.723 | 523.6 |
| Original / new preparation | 15.677 | 18.679 | 572.9 |
| New array program / new preparation | **7.082** | **9.031** | **519.7** |

Reference medians: **14.326 -> 7.047 s**, CPU **17.181 -> 8.934 s**, peak RSS
**1008.6 -> 498.7 MiB**. The combined local wall ratio is about 2.1x compiled /
2.0x reference, and compiled peak RSS falls about 17%. Reference RSS is highly
variable; do not promise deterministic memory savings.

The latest whole-program runtime-only effect is **inconclusive**: its medians
are worse in this series, whereas earlier controls improved. Original compiled
ranges 11.904–18.503 s; runtime-only 9.826–15.692 s. Source-only ranges
5.308–7.881 s; combined 3.075–8.061 s. Do not attribute all end-to-end savings to
the generic preparation or claim that it accelerates every record workload.

A direct general preparation control uses separate old/new runtime-owned
records with 16 integer-array fields, identical keys, 1000 warmups, and five
alternating blocks of 10000 signatures in one process. Median signature time
is **36.670 -> 0.801 ms**, CPU **37.541 -> 0.798 ms**. This measures prepared
signature reuse itself, not full function execution. The record-lookup control
below includes function bodies and shows a much smaller gain.

Host activity is uncontrolled. An earlier matched series before the final
encoder-sharing cleanup measured 12.058 -> 2.937 s compiled and 9.339 -> 3.662 s
reference; that is retained as `delivery-pre-encoder-cleanup.json`, not selected
as the final headline. Later single controls were substantially slower in both
versions. Three additional fresh late pairs comparing that frozen runtime to the
final ordinary-encoder implementation measured 7.946 -> 4.143 s compiled and
9.939 -> 6.065 s CPU. These separate epochs must not be combined into an invented
speedup ratio. Raw final data: `baselines/2026-11-01-euler305-delivery.json`;
encoder/control and all superseded series remain under descriptive filenames.

The final implementation reuses the ordinary record encoder. This preserves
current Unicode collation/insertion order exactly, while version stamps avoid
re-encoding unchanged runtime-owned flat metadata. Intermediate record-first
memo guards duplicated metadata walks on misses; encoding-only prototypes also
invalidated on equivalent contract copies. Both issues were addressed before
release. The source-only control remains an important independent result.

### Validation and regression controls

- TypeScript build passes.
- 111 focused tests cover record/return/binding contracts and signature encoding,
  including metadata versions, refinement, nested aliases, host tuple readers,
  overridden `get`, accessor-backed record entries, Unicode collation ties,
  and two same-job GC checks. The final encoder-sharing and conservative host-reader cleanup was followed
  by the 111 focused checks; the ordinary run below preceded that narrow
  adjustment.
- 154 independent research checks pass for five Rank variants in both engines
  plus two native variants, including the production source. The oracle directly searches the decimal
  string for twelve small targets, including overlapping patterns; the original
  published checkpoint for 7780 is retained.
- The fixture keeps its original two blocks and adds overlaps/width boundaries.
  An ordinary full-scale test asserts the complete Power=13 answer. The main's
  historical execution exclusion is removed for both engines.
- 10532 ordinary interpreter tests pass across 460 files (exhaustive audits excluded).
- Four scoped type/differential checks and two scoped name-facts checks pass for main and fixture; semantic-boundary and application-form checks pass.
- General record-lookup control (10000 calls), three serial samples: 317.1 ->
  291.6 ms wall / 648.5 -> 598.7 ms CPU. Euler 303: 550.7 -> 540.6 ms wall,
  with overlapping ranges. The first three-sample Euler 304 control was noisy:
  952.5 -> 1685.7 ms wall / 1238.6 -> 1472.5 ms CPU, including an after outlier
  of 2309.7 ms wall / 2890.3 ms CPU. A justified repeat of five fresh serial
  before/after pairs gave 2749.9 -> 2303.2 ms wall / 2944.9 -> 2849.5 ms CPU;
  CPU ranges overlap (2802–3137 vs 2778–3056 ms). A stable 304 regression was
  not reproduced; neither series is dropped, and no non-record speedup is claimed.

Release reproduction, after building the interpreter:

```
node benchmarks/experiments/euler305-build-versions.mjs
node benchmarks/experiments/euler305-delivery-samples.mjs
node benchmarks/experiments/euler305-controls.mjs
node benchmarks/experiments/euler305-verify.mjs
```

## Historical research

The following investigation started from `80861730`. Production code and lanes
were unchanged during that initial research; the delivered section above
supersedes those statements and measurement controls.

## Finding

The dominant opportunity is runtime/compiler work, with useful algorithmic
memoization as well. This is not a character-by-character search through a
10^13-digit string. The existing program builds a KMP automaton, composes finite
state/count transformations for decimal blocks, counts occurrences up to an
integer, and binary searches the integer containing the requested occurrence.

The unchanged full input returns **18174995535140**. Main and fixture are
`demos/euler/305_reflexive.ra` and `_test.ra`. The fixture contains Power=1 plus
published checkpoints for 5, 12 and 7780. The default main remains excluded
from the execution audit; this research does not change that classification.

## Matched measurements

Three fresh, serial processes per case, rotating case order. No own tests or
other measurements overlap. Host load is uncontrolled. Imports/startup are
excluded, parsing and execution included. Diagnostics are enabled in all Rank
cases. Each full sample asserts the same answer. Raw results:
`baselines/2026-11-01-euler305-samples.json`.

| Rank program | Compiled median, s | Reference median, s | Compiled peak RSS, MiB | Reference peak RSS, MiB |
| --- | ---: | ---: | ---: | ---: |
| Original | **11.455** | **9.725** | **576.2** | **1009.6** |
| Numeric state IDs + cached compositions + cached complete prefixes | **4.956** | **3.343** | **516.9** | **500.8** |

CPU medians, original -> prototype: compiled **13.849 -> 6.155 s**;
reference **12.470 -> 4.653 s**. The local wall ratios are about 2.3x and 2.9x.

Wall ranges are 9.484–11.883 s / 9.238–10.885 s for original compiled/reference,
and 3.615–5.529 s / 3.313–4.187 s for the prototype. Original reference RSS varies
especially widely, 625–1380 MiB; do not promise a deterministic 50% memory saving
from these three samples. Compiled RSS changes from 575–648 to 475–517 MiB.
These are process high-water marks, not retained heap or logical cache size.

Initial separate observations were 14.163 s compiled / 14.684 s reference. The
first compiled control used a 1536 MiB old-space cap and a 60-second process
budget. It is historical evidence, not included in the matched default-Node
medians. The full sample completed normally, not at a timeout.

## Why compilation helps little here

There are **zero executed scalar-function kernel entries** in the full original
and prototype. Existing numeric loops inside automaton setup do compile (169
compiled loops in the original full run), but the hot helper graph remains
ordinary execution.

Bounded diagnostic rejections include:

- `id`: `E join ","` is not admitted by scalar-function proof.
- `merge`, `adddig`, `block`, `ranged`: accesses such as `State .ends`, `.dig`,
  `.full`, `.unit` decline preparation for these record-bearing helpers.
- `count`, `nth`: their helper dependencies are consequently not linked.
- Dynamic gathers `EY EX`, `AY EX` and array-valued index entries do not become
  a single linked helper region.

The existing linked container domain admits integer-valued indexes; it is not
an implementation of this record containing indexes of small arrays. Support
for other record/flat-record paths should not be confused with support for this
particular helper graph. Removing a rejection without adding the relevant type,
mutation, alias and native-identity guards would not be a correct fix.

The default original records **566516 index reads**, **16244 writes** and
**732478 ordinary computed cells**. Only **13 CoW copies / 130 copied cells** are
reported. CoW copying is not the observed dominant source of work here.

Compiled being slower than reference is repeatable in this series. It incurs
preparation/guard work while the important helpers still run in the interpreter;
this is not evidence that exact arithmetic itself is inherently slower when
compiled. Changing the algorithm reduces execution in both modes, but does not
make those helpers compile.

## Native algorithm control

`experiments/euler305-native.mjs` implements the same automaton, transformation
composition, interning, block cache and binary search with ordinary JavaScript
arrays/Map and exact BigInt occurrence counts/positions. It does not include
Rank contracts, ownership or parsing, and is **not** a prototype Rank compiler
or a prediction of its eventual speed.

Three fresh process medians, algorithm timer only:

| Native model | Wall median, ms | CPU median, ms | RSS median, MiB |
| --- | ---: | ---: | ---: |
| Original algorithm | 63.4 | 82.6 | 61.8 |
| Cache complete decimal prefixes | 46.1 | 68.6 | 62.8 |

Both return the full answer. The original performs **101894 compositions** and
interns **4730 distinct transformations** across all thirteen targets. Prefix
caching reduces compositions to **72320**, retaining the same 4730 states.
The algorithm is small enough to run quickly; the large Rank/native gap points
to dispatch, frame/type preparation and array plumbing, rather than an
intractable number of mathematical states. Treat the native comparison as
causal evidence, not a measured speedup of a production change.

## Algorithm prototypes

All Rank prototype files retain the existing array transformation:

```
E = EY EX
A = AX + AY EX
```

1. **Numeric IDs only:** intern the same E/A signature but use a small integer
   to address `.ends` and `.adds` and to construct `.full` keys. One exploratory
   full compiled run took 11.723 s / 583 MiB. It leaves the exact same read/write
   and computed-cell counts. This alone is not a convincing improvement.
2. **Composition cache:** transformations stored under an ID never change, so
   the pair (X,Y) always has the same composition. Cache that result. With numeric
   IDs, one exploratory run took 8.600 s / 510 MiB. Computed cells drop to 54080.
3. **Complete-prefix cache:** each call of `ranged` previously rebuilt the
   concatenation of all positive integers with fewer than D digits, including
   the same nine block merges per width. Cache that transformation by width,
   separately for each pattern. One exploratory run took 8.836 s / 558 MiB.
4. **Combined:** both caches with numeric IDs give the matched table above.
   Index reads fall to **139078** and ordinary computed cells to **54080**,
   while writes rise to **24073** due to the added caches. These are deliberate
   time/space tradeoffs, not removal of all materialization.
5. **Compact key experiment:** use the existing multi-scalar index-key operation
   for composition pairs instead of explicit text concatenation. It passes the
   small/published checks, but has not received a matched full timing series.

Caches belong to one `solve`/pattern. No table of known Euler answers, hardcoded
state bound or numeric precision shortcut is introduced.

## Runtime profile and next implementation work

A separate V8 CPU profile of the original includes parser/import activity, so
it is diagnostic rather than a timed sample. Aggregated leaf samples are in
`baselines/2026-11-01-euler305-profile.json`. Hot entries include GC,
`argumentSignature`, `CallSpecializations.get`, expression/application dispatch,
semantic-array/record type construction, and `retainRecordContract`.

Current argument-signature reuse is intentionally limited to primitives and
revision-tracked arrays with known scalar cells; a record argument recomputes
its semantic signature. `State` is passed through nearly every helper call.
A useful general runtime target is a safe prepared structural signature for
validated records, with invalidation for field-contract refinement, nested
mutation/aliases and host values. Measure it independently before promising a
speedup. Blind identity caching would lose correctness.

A small isolated runtime experiment skips reapplying a record's exact same
field-contract map. Its single full control returned the answer in 12.035 s,
with peak RSS 774 MiB. It has no matched before/after series or semantic
regression coverage and is **not selected or implemented in production**.
The reproduction script builds an isolated `/tmp` runtime; source/out in the
workspace are not patched by it. This shortcut alone is not the desired broad
record-signature preparation.

Compiler work should then cover guarded field access for these typed record
arguments and their array-valued index reads, so small gather/add compositions
and the surrounding helper graph can run together. That is reusable support
for automata and dynamic programming, not an Euler-specific special case.
Interning text and mutable cache effects also need proper lowering/admission;
just treating the record as a scalar is insufficient.

Recommended priority: profile and improve record/helper preparation first;
retain the validated composition/prefix caches as the measured program change.
A wholesale replacement of the counting algorithm is not needed to establish
a useful speed improvement.

## Verification and reproduction

**128 checks pass:** brute-force substring searches in `123456789101112...`
for twelve small targets (including overlaps), native model with/without prefix
cache, four Rank variants in both engines, plus the fixture's published
7780 -> 111111365 checkpoint for each Rank variant/engine. Every timed full
Rank/native input asserts 18174995535140. Expected 5 -> 81 and 12 -> 271 are
included in the small oracle set.

```
node benchmarks/euler305-investigation.mjs compiled 13 original
node benchmarks/euler305-investigation.mjs reference 13 combined
node benchmarks/experiments/euler305-samples.mjs
node benchmarks/experiments/euler305-native.mjs 13
node benchmarks/experiments/euler305-verify.mjs
node --cpu-prof --cpu-prof-dir=/tmp --cpu-prof-name=euler305.cpuprofile benchmarks/euler305-investigation.mjs compiled 13 original
```

During initial research no ordinary/full/exhaustive suites were run: production
implementation was unchanged at that stage. The scripts/prototypes and raw results below were retained for implementation review.
