# Euler 260 investigation

Baseline: `228a0633`, macOS arm64, Node v24.15.0. The demo now uses bitsets,
and the exact loop compiler emits direct BigInt bit operations. Both former
execution-budget exclusions are removed. Historical investigation measurements
are retained below; production verification is recorded at the end.

## Where the work goes

The original program scans every `0 <= X <= Y <= Z <= Top`: **167,668,501** triples at
`Top=1000`. Each triple eagerly reads seven pair/difference flags, even after
one flag already proves the position winning. Three flat tables contain
`3 * 1001^2` integer cells. There are 121,060 losing positions.

The existing compiler already lowers the whole search to **one Number loop**,
with no overflow, interpreter index reads or copy-on-write copies recorded.
This is primarily an algorithm/workload problem, not failed compilation.
Reference execution still pays ordinary evaluation and array-access costs per
candidate. The fixture repeats the full input, then checks `Top=10` and `100`.
Auditing the main and fixture separately repeats the default search.

## Algorithm alternatives

A fixed pair `(Y,Z)` admits at most one losing `X`: finding it sets `Pr(Y,Z)`,
which makes all later X winning. Thus we can skip a pair already marked and
break after its first loss. Replacing the sum of seven flags with short-circuit
`and` avoids reads after the first blocking flag. These are source changes:
a compiler cannot generally omit reads and their observable errors merely
because their sum is later compared to zero.

Three early full-input samples per variant, fresh processes, seconds:

| Variant | Median | Range |
| --- | ---: | ---: |
| Original | 7.493 | 7.293–8.105 |
| Short-circuit condition | 5.067 | 4.994–5.073 |
| Break after loss | 6.031 | 5.773–6.919 |
| Pair skip + break | 5.858 | 5.830–5.966 |
| Short circuit + pair skip + break | 4.986 | 4.460–5.672 |

The combined variant still visits 139,105,298 X candidates. It leaves most of
the cubic work intact.

The bitset version, now in `../demos/euler/260_stonegame.ra`, removes the X loop.
Each table row becomes a BigInt bitset. For each `(Y,Z)`, shifts align the
forbidden X positions, bitwise OR unions them, and the least free bit identifies
the next loss. It retains two compact loops and four arrays of 1001 BigInts.
`Dr` and `Df` hold the same diagonal relation in opposite orientations.
The reversed rows avoid reversing bits at every query.

There are O(Top^2) pair iterations, each operating on up to Top+1 bits; this
is not a constant-time O(Top^2) algorithm when BigInt word work is counted.
Table payload is O(Top^2) bits rather than O(Top^2) integer cells. Process peak
RSS did not show a reliable reduction: interpreter/import overhead and GC
remain substantial at this scale.

## General compiler improvement

The previous exact loop backend called catalogue-native wrappers for `band`,
`bor`, `bxor`, `bnot`, `shl`, `shr` and `bit`. The compiler now emits direct BigInt
operators, retaining native binding checks. Invalid shift counts and invalid
bit-test operands delegate to the original call and its error validation.
This is reusable bit-operation lowering, not an Euler-specific optimization.

The Number backend already specializes several Int32 bit operations. Its
speculative attempt on this prototype overflows immediately on the wide
masks and correctly replays with exact arithmetic. Changing the Number
admission threshold is not needed to obtain the algorithmic improvement.

The source lowering has focused tests for wide signed integers, invalid shifts,
negative bit-test operands, replaced native bindings, lazy branches and partial
stores on errors. The original bound call remains the entry guard even when its
positive-domain implementation is inlined. No Number admission threshold changed.

## Investigation alternating comparison

Three fresh processes per variant, alternating order each round; seconds:

| Algorithm/runtime | Median | Range |
| --- | ---: | ---: |
| Original / shipping | 27.152 | 27.009–30.255 |
| Bitsets / shipping | 5.801 | 5.034–6.041 |
| Bitsets / inline BigInt prototype | 4.384 | 3.757–4.526 |

Every sample returned **167542057**. Within this series, the algorithm is
4.68x faster; direct bit lowering adds about 24% less elapsed time (1.32x).
Combined: 6.19x. Median peak RSS is approximately 184, 180 and 179 MiB;
these values do not establish a meaningful process-memory improvement.

**External load was not controlled.** Load averages reached
`54.48 41.57 25.68`. Earlier isolated runs gave 7.251 s for the original and
2.820 s for bitsets. Their ratio is not the final controlled comparison.
The alternating series supports the direction and substantial algorithmic
benefit; precise speedups should be remeasured on a quieter machine.

For uncompiled reference execution, single `Top=100` checks gave:
original 8.580 s, short circuit 3.971 s, combined skip 3.705 s, bitsets 2.677 s.
All returned **173895**. Subsequent production verification ran the full
reference input in 26.397 s, with **Answer=167542057** and peak RSS 200.375 MiB.
Both files are therefore restored to the ordinary audits with their existing
300-second budget; no timeout increase is added.

## Verification and reproduction

An independent oracle enumerates every legal subtraction from one of the
seven nonempty subsets of piles, sorts the successor piles and consults
already classified positions. It does not use the demo's pair/difference
flags. Answer sums matched for Top 0, 1, 2, 3, 5, 10 and 15, for the original,
combined skip and bitset variants in both engines: **42 checks**.
Full compiled answers were checked in every timing sample. The shipping fixture
keeps its default assertion and Top 10/100 checks, and adds Top 0/2/3/15. The
ordinary interpreter suite also has a full compiled Euler 260 golden assertion.

```sh
# From a built repository; RUNTIME can point to a separately built interpreter.
node benchmarks/euler260-stonegame.mjs 1000 original compiled
node benchmarks/euler260-stonegame.mjs 1000 bitset compiled
node benchmarks/euler260-stonegame.mjs 100 bitset reference
node benchmarks/euler260-oracle.mjs

# Compare bit lowering with a built baseline runtime from 228a0633.
RUNTIME=/path/to/baseline/packages/interpreter/out/index.js node benchmarks/euler260-stonegame.mjs 1000 bitset compiled
```

Raw samples: `baselines/2026-10-29-euler260-investigation.json`.
The historical original is preserved in `experiments/euler260-original.ra` for
repeatable source comparisons. Production timings and validation follow.


## Production result

Three new alternating, fresh-process samples per variant, before integrating
independent tensor commit `9dfe7784`; seconds:

| Source/runtime | Median | Range |
| --- | ---: | ---: |
| Original / baseline 228a0633 | 10.034 | 9.112–11.105 |
| Bitsets / baseline 228a0633 | 1.584 | 1.486–2.572 |
| Bitsets / production bit lowering | 1.267 | 1.222–2.120 |

Every answer is **167542057**. In this series, the combined improvement is
7.92x; the compiler change removes about 20% of elapsed time from the new
algorithm. External load remains uncontrolled, so this is not a universal
speedup claim. Median peak RSS was 193.0, 180.7 and 173.5 MiB respectively;
no general process-memory claim is made.

Production validation:

- TypeScript build and interpreter test typecheck pass.
- Five focused loop/bit suites: **518 tests pass**.
- Independent direct-move oracle: **42 checks pass** with the shipping source.
- Full reference input: **26.397 s**, answer **167542057**.
- Scoped type audit: **2 files pass**.
- Scoped differential audit: **2 files pass**, all **3 embedded test blocks**
  pass; main 41.459 s and fixture 48.629 s under concurrent host/test load.
- Semantic source/resource checks: **11 tests and 65 owners pass**.
- Application-form checks pass.

The initial ordinary suite passed 9349 tests and hit two existing 15-second
limits in `compiled-integer-collections.test.ts` (Euler 044/023). Both passed
on isolated retry (4.301 s / 4.015 s; all 17 tests in the file pass). These
were timeout-only failures under load, not an observed semantic regression.
A final ordinary run after integrating `9dfe7784` is recorded below.


Final ordinary rerun on `9dfe7784` plus this change: **415 files / 9361 tests
pass**, 241.37 s. The subsequently arrived independent `e5f8cfcf` tensor commit
was integrated without conflicts; its build/typecheck and targeted integration
checks are recorded separately below.


After integrating `e5f8cfcf`: build and test typecheck pass; five targeted
integration suites pass **62/62 tests**, including the tensor bounds/primitive/
real-proof suites, exact bit loops and all full-scale compiled demo assertions.
