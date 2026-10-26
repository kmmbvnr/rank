# Euler 118: direct integer permutation completion

The original main builds 414,237 permutation rows, converts them to decimal
integers, counts primes per digit mask and combines the counts with a subset DP.
The search and main Rank source remain unchanged; the answer is **44680**.
The original fixture repeated the entire search three times for nine assertions.

## Implementation

Runtime-owned integer permutation sources now fill one final `IntegerCells`
tensor at completion, retaining iterator order and distinct-permutation rules.
They do not allocate an owned array for each intermediate row. Duplicate digits,
negative and arbitrary-precision integers, and the empty `[1, 0]` result are
supported. The native sequence's ordinary iterator still yields independent rows;
partial traversal and filtered/transformed sources retain that path.

A private sequence-completion registry certifies constructor-owned sources.
Admission checks the original iterator and exact size metadata using own data
property descriptors, without probing a host iterator getter. Replaced iterators
or changed size evidence fall back to ordinary traversal. Completion occurs at
the existing consumer/binding boundary, never while preparing an unused plan.
Each completion allocates fresh output, including after demand-budget failure.
Noninteger, text and resource-bearing permutation inputs keep ordinary completion.
The diagnostic `nativeSequenceCopies` counts successful native completions.

Prime membership retains adaptive history per observer, extending its warmup
range from 2–32 to 2–64 queries. Short runs raise the next segment's warmup;
dense runs pay the penalty back toward two. Prepared prime and composite cells
are reused immediately; bounded membership still uses the sieve directly.
Iteration, exact integer handling and workspace limits are unchanged. This is
a measured heuristic, not a universal optimal threshold.

There is a tradeoff: a five-pair repeat slows Euler 058 from 242 to 251 ms
(+3.7%), with nonoverlapping ranges. It is retained explicitly rather than
reported as noise. Range-dependent and 128-query prototypes were considered;
the added range-dependent branch did not reliably recover the 058 difference
in the final build, and gave less benefit on 118. The simpler 2–64 policy is
selected for the measured 118 gain, with the 058 cost recorded below.

The fixture now runs the default once and retains all nine original assertions:
the complete answer, four prime-count checks and four statement-set checks.
Execution lanes, timeouts and full default coverage are unchanged. The historical
three-run fixture is archived for controlled comparison.

## Measurements

Baseline `2bd5b157`, Apple M5 / Node v24.15.0. Three serial fresh processes per
version/workload/engine, reversing job order on alternating samples, with no
concurrent tests or profiling. Time includes parsing and complete execution,
excluding interpreter construction and module imports. Peak RSS is sampled
before independent oracle validation; it is process high-water memory, not
retained tensor storage.

`bulk` isolates direct permutation completion with the old prime policy and
original three-run fixture. `after` includes the selected prime
policy and consolidated fixture. Main source hashes match across every version.

| Engine | Version | Workload | Median, s | Peak RSS, MiB |
| --- | --- | --- | ---: | ---: |
| Compiled | before | main | 1.829 | 581.5 |
| Compiled | before | fixture | 5.039 | 583.4 |
| Compiled | bulk | main | 0.955 | 293.9 |
| Compiled | bulk | fixture | 2.475 | 440.4 |
| Compiled | after | main | 0.685 | 299.4 |
| Compiled | after | fixture | 0.686 | 302.2 |
| Reference | before | main | 1.836 | 581.4 |
| Reference | before | fixture | 5.019 | 597.0 |
| Reference | after | main | 0.688 | 298.8 |
| Reference | after | fixture | 0.693 | 300.8 |

Direct permutation completion alone improves the main by 1.9x and the original
three-run fixture by 2.0x. The selected prime policy reduces the main further
from 0.955 to 0.685 s. Final main speedup is 2.7x; final fixture speedup is 7.3x,
including the reduction from three complete searches to one. Final peak RSS is
about 48% lower than baseline for both workloads.

Every timed main validates all 512 `Cnt` and all 512 `Ways` entries, plus the
answer and output, against an independent scalar digit DFS with trial division
and direct submask DP. Every fixture validates the original assertions and
expected output for all its test blocks. Validation occurs after timing and RSS.

Separate diagnostic samples count 339 native sequence completions. Generic
derived-cell computations remain 1,605,114; compiled loop and tensor counts
remain zero, and typed buffer unpacking remains zero. The gain removes
intermediate row allocations, which that generic cell counter does not count.

## Prime membership controls

The same three-process method uses unchanged full demos and exact golden answers.

| Workload | Before, s | After, s | Change |
| --- | ---: | ---: | ---: |
| euler058 | 0.238 | 0.251 | +5.6% |
| euler060 | 2.565 | 2.542 | -0.9% |
| euler263 | 5.424 | 5.451 | +0.5% |
| euler293 | 0.176 | 0.165 | -6.1% |
| direct-membership | 0.126 | 0.125 | -0.5% |
| bounded-membership | 0.153 | 0.156 | +2.4% |

058 is slower in all three pairs; the independent five-pair repeat confirms a
smaller 3.7% median cost. 263 and direct-membership ranges overlap. 060 is about
1% faster with nonoverlapping ranges in this run. Bounded membership is 2.4%
slower in the three-sample run despite retaining identical sieve behavior;
its five-pair repeat has overlapping ranges (151 → 155 ms). These local numbers
are not portable budgets, and no exact zero overhead is claimed.

## Reproduction and verification

After building, run without concurrent tests or profiling:

```sh
node benchmarks/euler-pandigital-prime-sets.mjs --baseline-runtime=/path/to/before/index.js --intermediate-runtime=/path/to/bulk/index.js --samples=3
node benchmarks/euler-pandigital-prime-sets.mjs --baseline-runtime=/path/to/before/index.js --samples=3 --engine=reference
node benchmarks/prime-sequences.mjs --cases=euler058,euler060,euler263,euler293,direct-membership,bounded-membership --trials=3 --baseline=/path/to/before/index.js
```

The intermediate runtime includes direct permutation completion and retains the
old 32-query policy. The harness uses the archived three-run fixture for before
and bulk, and the consolidated fixture for after. Source and runtime hashes are
recorded. `--cases=main --diagnostics=true --samples=1` produces separate counters.

- Build/test typecheck and semantic/application-form checks pass (65 owners).
- 371 ordinary interpreter files / 8,432 tests pass; exhaustive types/differential corpora and Nurikabe are excluded from this broad selection.
- Final permutation/prime checks pass 47 tests, including 15 new permutation tests.
- Scoped Euler 118 type/differential audits pass four selected tests, covering both files and engines.
- Added tests cover iterator order, duplicate/negative/large integers, empty results, fresh copies, failure/retry under a demand budget, host iterator overrides, changed size evidence, unused oversized plans and independent partial/completed observations.

The main algorithm and lazy bindings remain unchanged. Neither surrounding loop
is newly compiled. Earlier digit-ending pruning and direct submask enumeration
remain possible algorithmic follow-up work.

Raw data: [compiled, intermediate and diagnostics](baselines/2026-10-26-euler118-native-permutations.json),
[reference](baselines/2026-10-26-euler118-native-permutations-reference.json),
[prime controls and five-pair repeats](baselines/2026-10-26-euler118-prime-controls.json).
