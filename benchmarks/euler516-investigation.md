# Euler 516: current runtime and arithmetic simplification

Investigated in `/tmp/rank516-investigation`, based on `da9619ab`.
Delivery includes intervening main changes through `bb0caf05`.
The next unfinished numerical row after Euler 514 in issue #447 is
`euler/516_5smoothtotients.ra`. Its recorded 18.9 s reference / 18.6 s compiled
observations came from concurrent corpus shards, not isolated benchmarks.

## Finding

The historical 19-second slowdown does not reproduce on current main.
The unchanged full `L=1000000000000` program returns **939087315** in under
one second on Apple M5 and under two seconds on Intel i7-10750H. Both use
Node v24.15.0. Reference and compiled performance are close because large
array operations run through native storage/search/arithmetic paths in both
modes. There is no evidence that admitting another scalar loop to the JIT
is the next useful change for this program.

The algorithm is already suitable: generate the 3429 5-smooth integers H,
find the 543 primes p>5 with p-1 in H, enumerate their 2609415 squarefree
products q<=L, and sum q times the smooth-number prefix sum at floor(L/q).
Primality and the small H sort are not the main cost.

The remaining work includes materializing large arrays for X, A, Q1, Q2
and T. A reference CPU profile attributes approximately 31.2% self samples
to `mapStoredInt32Binary`, 10.3% to `mapDenseArrays`, 8.4% to
`evaluateBinaryValue`, and 3.7% to sorted search. These are sampled self
times, not exclusive mathematical phases or benchmark samples.

## Existing shared improvements

A separate worktree at the original inventory base `761a3599` was built
with its own generated parser and workspace links. Its unchanged original
program returns the same answer in a single unprofiled **3.490 s compiled**
control (679.4 MiB RSS), and **3.393 s reference** (712.8 MiB). The source
has the older `option` syntax and extra parentheses; the calculation is
unchanged. A separate profiled compiled run takes 3.446 s. No historical
19-second speedup factor is claimed: original observations had concurrent
shards and potentially other activity, and these old-runtime controls are
single samples.

The historical profile spends 23.4% self time in individual `sortedIndex`
searches, 13.6% in integer-cell writes, 12.8% in GC and 7.2% in generic
array reads. Subsequent shared changes include `89931868` (batched sorted
queries and packed selectors), `4a7cb2ae` (word-based integer arithmetic
and direct Int64 searches), and `28366c99` (cheaper wide cells).

Same-current-runtime Mac controls, single fresh processes, compiled:

| Enabled native paths | Seconds | Peak RSS MiB |
| --- | ---: | ---: |
| Normal program, three-sample median | 0.759 | 519.5 |
| Disable only sorted-query batching | 2.179 | 652.1 |
| Disable only stored-integer arithmetic kernel | 1.058 | 603.4 |
| Disable both | 2.535 | 638.2 |

Controls use Node module load hooks, leaving production files untouched.
They disable specific current paths, rather than reconstructing the entire
historical runtime. Effects are not additive and RSS includes GC behavior.
This is the same general pattern as other array-heavy cases: generic
per-element dispatch, boxing, selectors and intermediate arrays can cost
more than the mathematical operation. A compiled/reference gap alone does
not identify this pattern, since both modes share native array operations.

## Rank prototypes

All variants retain the full default input and answer:

- `original`: unchanged production demo.
- `blocked`: evaluate final products in blocks of 65536 q values. Keep
  the original 16-bit multiplication decomposition.
- `direct`: replace the decomposition with `T = Q * A`.
- `blocked-direct`: combine block processing with direct multiplication.

The direct product is safe for the default even as an exact Number:
A(x) is the sum of at most |H| numbers at most x. Thus
q*A(floor(L/q)) <= L*|H| = 3429000000000000 < 2^53.
Reducing A modulo 2^32 only makes this bound smaller. The language's
checked exact integer operations remain responsible for other inputs;
this observation does not introduce unchecked floating arithmetic.
The final reduction remains an integer sum: the total of millions of
modular terms must not be accumulated in an unchecked Number.

Medians of three serial fresh-process samples per host/mode/variant:

| Host / mode | Variant | Seconds | Peak RSS MiB |
| --- | --- | ---: | ---: |
| mac / compiled | original | 0.759 | 519.5 |
| mac / compiled | blocked | 0.819 | 438.5 |
| mac / compiled | direct | 0.609 | 538.6 |
| mac / compiled | blocked-direct | 0.645 | 438.2 |
| mac / reference | original | 0.736 | 576.7 |
| mac / reference | blocked | 0.735 | 435.8 |
| mac / reference | direct | 0.591 | 538.3 |
| mac / reference | blocked-direct | 0.596 | 434.9 |
| intel / compiled | original | 1.822 | 418.7 |
| intel / compiled | blocked | 2.000 | 385.7 |
| intel / compiled | direct | 1.480 | 406.0 |
| intel / compiled | blocked-direct | 1.524 | 384.2 |
| intel / reference | original | 1.705 | 499.7 |
| intel / reference | blocked | 1.782 | 387.5 |
| intel / reference | direct | 1.397 | 404.8 |
| intel / reference | blocked-direct | 1.424 | 388.3 |

Samples alternate variant order. The original/blocked and direct/combined
pairs were measured in separate series. Parsing and compilation are
included; external host activity is possible. Peak RSS is whole-process
memory, not retained table storage. This is a modest further improvement,
not a fix for a currently reproducible 19-second run.

Delivery uses the combined variant: it removes unnecessary arithmetic
passes and reduces peak memory while preserving array operations. No new interpreter or compiler
feature is needed for it. A broader fused map/reduce kernel might avoid further
intermediates, but this case alone does not justify that additional work.

## Validation and scope

`euler516-verify.mjs` passes 88 Rank executions: all four variants in both
engines at L=0,1,2,5,6,7,10,100,1000,10000,100000. Their answers agree with
an independent ordinary totient sieve that strips 2/3/5 factors of phi(n).
A second native oracle uses independent smooth-number generation,
trial-division primality, and recursive subset enumeration with exact
BigInt prefix/weighted sums. It agrees with the sieve and independently
returns the full answer and all three enumeration counts. Every full
benchmark sample asserts 939087315 before publishing its timing.

All 13 focused `sorted-search.test.ts` tests pass. TypeScript builds pass
for both runtime revisions. No exhaustive audit or full suite was run.
Delivery applies the combined variant to the production demo, retaining
L=10^12, the original fixture and the full golden answer. The old production
source is saved as `experiments/euler516-original.ra`; the benchmark's
`original` variant uses that snapshot and `final` uses the production file.
An additional delivery verifier passes all five variants, 110 executions.
Twenty focused tests pass across the new Euler 516 regression, Euler 514
and sorted search. The new test includes independent sieve checks in both
engines and full compiled/reference golden assertions with process deadlines.
Four scoped type/differential audit cases pass for the main and fixture.
Runtime and execution lanes are unchanged. Full suites and exhaustive
audits were not run.

Final production verification, three fresh processes per mode and host:

| Host / mode | Seconds | Peak RSS MiB |
| --- | ---: | ---: |
| mac / compiled | 0.608 | 437.6 |
| mac / reference | 0.586 | 435.9 |
| intel / compiled | 1.487 | 383.3 |
| intel / reference | 1.436 | 387.5 |

## Reproduce

From a built worktree at `da9619ab` with these benchmark files:

```sh
node benchmarks/euler516-investigation.mjs 1000000000000 compiled
node benchmarks/euler516-investigation.mjs 1000000000000 reference blocked-direct
node benchmarks/euler516-series.mjs
node benchmarks/euler516-verify.mjs
CONTROL=no-batch node benchmarks/euler516-investigation.mjs 1000000000000 compiled original
CONTROL=no-integer-kernel node benchmarks/euler516-investigation.mjs 1000000000000 compiled original
CONTROL=no-both node benchmarks/euler516-investigation.mjs 1000000000000 compiled original
PROFILE=/tmp/euler516.cpuprofile node benchmarks/euler516-investigation.mjs
```

The series gives each child a 30-second process deadline. Raw JSON samples,
source hashes, historical controls, diagnostic records and compressed
profiles are in `baselines/2026-11-02-euler516/`.
