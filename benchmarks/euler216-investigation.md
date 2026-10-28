# Euler 216: primality of 2n² − 1

Investigation and delivery based on main `6d5b4545c1a4f5bf5ea42c113a1ea8fa66448e6b`,
macOS arm64, Node v24.15.0. Timings used serial fresh processes, without
concurrent benchmark/test suites. Rank parsing is included; runtime imports
are outside the timer. RSS is process high water, not retained storage.
No Intel measurements. Raw observations are in the
[initial investigation](baselines/2026-10-27-euler216-investigation.json) and
[delivery comparisons](baselines/2026-10-28-euler216-delivery.json).

## Cause and selected implementation

The original independently tests `2*N*N-1 in primes` for every N from 2 to
50,000,000. Its loop already compiles once to exact BigInt code. Membership
screens small factors then uses deterministic Miller–Rabin for large values.
A bitmap extending to the largest polynomial value (about 5e15) is impractical.

At one million N, the original takes 1.765 s compiled in the initial cohort.
A direct JS BigInt loop calling the same `primePlan.contains` takes 1.667 s
(median of three), with the same answer 141444. The JS control excludes Rank
parsing/preparation; it establishes algorithm/native-membership cost, rather
than an exact interpreter-overhead percentage. Number lowering currently does
not accept sequence membership, but removing that restriction alone would
still leave the expensive primality algorithm.

The selected solver uses a residual-factor sieve in the prefix and integer
composite flags in the tail. Let `Root = isqrt(2*Limit²-1)` and
`Cut = floor((Root-1)/2)`. Only the first Cut polynomial values need residual
factors, about 70.7% of the full range. The rest need one 0/1 cell each.
The ordinary helper has three top-level loops and already qualifies as one
Number function prefix; no synthetic wrapper, new threshold, precision limit,
or deferred-binding change is needed. Empty and negative limits still return 0.

Correctness rests on two facts:

- Any composite value in the range has a prime factor p <= Root. Its two
  polynomial roots modulo p are r and p-r, so its smaller root is at most
  (p-1)/2 <= Cut. Thus every necessary divisor is discovered in the prefix.
- Processing prefix n in order removes every prime factor at most
  sqrt(2*n²-1), because its smaller root is earlier than n. A remaining
  residual P>1 must therefore be prime. The value itself is prime exactly
  when that residual still equals 2*n²-1. Strip all powers of P from later
  prefix roots, and mark both progressions in the tail. Do not mark the
  discovery cell itself when its polynomial value equals P.

Full input, answer **5437849** in every completed full run:

| Source / runtime | Time, s | Peak RSS, MiB | Samples |
| --- | ---: | ---: | ---: |
| Original independent primality | 98.989 | 172.0 | 1 |
| Full residual table, original publication | 17.559 | 3164.6 | 3, medians |
| Same full residual source, indexed publication | 14.292 | 1126.3 | 3, medians |
| Full residual table with empty-loop guards | 14.205 | 1126.3 | 3, medians |
| Selected prefix/tail sieve | **10.322** | **911.1** | 3, medians |
| Final shipping source confirmation | **10.623** | **911.1** | 1 |

The final confirmation is about 9.3x the single original observation; the
selected-prototype median is about 9.6x. These are separate cohorts, not a
three-sample full original baseline. The new O(Limit) storage is a material
increase over the original search, even after reducing the first prototype.
The final confirmation includes the shipping comments/source locations and
matches the selected algorithm; no timing regression is established from
that single confirmation.

## Alternatives compared

`experiments/euler216-residual.ra` retains a residual for every n. The guarded
variant avoids constructing empty progressions but has similar full compiled
cost. `euler216-split.ra` is the selected prefix/tail prototype.

`euler216-segmented.ra` pre-sieves blocks using roots discovered in a small
prefix, then invokes exact primality only for survivors. An exploratory
million-input compiled sample took 1.732 s / 200.7 MiB, close to the original,
versus about 0.308 s for the selected solver. It saves table memory but retains
Miller–Rabin for every prime survivor. It was not run on the full default.

`euler216-bulk.ra` attempts slice division and masks for repeated factors. At
100,000, one reference sample took 4.249 s / 618.1 MiB, with 154,500 mask
materializations and 336,548 computed cells. A million-input compiled run was
manually stopped without an answer; it overlapped focused tests and supplies
no valid comparative timing or controlled-deadline result. This version loses
the single Number region and is not selected.

## General runtime repair

Number regions previously published widened private arrays with
`BigInt64Array.from(cells, BigInt)`. TypedArray.from takes its iterable path
for typed-array input and collects a temporary list before constructing the
destination. Publication now allocates the exact destination once and fills
it by index. Int32 publication remains unchanged. Memoized results, ownership,
precision, overflow replay, and uninterrupted error/cancellation publication
are preserved. There is no new lazy array representation.

On the same full-residual source, this alone reduced median time from
17.559 to 14.292 s (18.6%) and RSS from 3164.6 to 1126.3 MiB (64.4%). It is a
general memory/allocation repair; the selected solver also changes the
algorithm and table layout, so its total speedup must not be attributed to
this runtime repair alone.

## Reference cost and verification

Final alternating three-sample controls at Limit=1,000,000:

| Source | Compiled, s | Reference, s | Compiled RSS, MiB | Reference RSS, MiB |
| --- | ---: | ---: | ---: | ---: |
| Original | 1.771 | 2.016 | 167.1 | 167.7 |
| Shipping | 0.308 | 4.353 | 196.7 | 343.2 |

The selected algorithm is **2.16x slower in reference** at this input because
its scalar array loops incur interpreter work. This is an explicit tradeoff,
not a reference optimization. No full reference run or full reference speedup
is claimed. The existing full-default execution exclusion and timeouts remain
unchanged; further reference scalar-loop improvements remain open.

An independent direct trial-division oracle checks 26 limits, including
negative/empty bounds, first primes, 7², and several larger boundaries, across
the original, shipping, full-residual, guarded, split, and segmented sources
in both engines (304 checks; negative limits only apply to original/shipping).
All pass. The two shipping fixture blocks pass in both engines, preserving
45 and 2202 and adding empty/initial-limit and repeated-factor coverage.

Build/test typecheck, 221 focused Number-loop/function-prefix/admission tests,
semantic-source/catalogue checks, 65 semantic-boundary owners, and application
forms pass. The ordinary interpreter suite passes **9,172 tests across 404 files** with
2 workers (162.64 s), excluding exhaustive type, differential and Nurikabe
suites. Scoped type audits pass for the full main and fixture; the fixture
differential audit passes. The full main exclusion was removed only in the
validation checkout for that scoped type audit; shipping catalogue unchanged.
The exhaustive differential and Nurikabe suites were not rerun.

## Reproduction

After building, use a fresh process per sample and an external deadline for
the full main, since synchronous execution blocks JavaScript timers:

```sh
node benchmarks/euler216-primality.mjs
node benchmarks/euler216-primality.mjs --variant=original
node benchmarks/euler216-primality.mjs --variant=residual
node benchmarks/euler216-primality.mjs --variant=segmented --Limit=1000000
node benchmarks/euler216-primality.mjs --Limit=1000000 --reference
node benchmarks/euler216-primality.mjs --fixture --reference
node benchmarks/experiments/euler216-oracle.mjs
```

`--runtime=/absolute/path/to/out/index.js` selects a built runtime. The original
main source is captured in the initial baseline; it does not read the shipping
main for `--variant=original`.
