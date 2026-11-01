# Euler 320 investigation

Investigated at `94776aeb`, Node v24.15.0, on Apple M5 and the Intel host.
The next unfinished item in #447 was `euler/320_factorials.ra`. The production algorithm change is described below. Compiler prototypes
remain research-only, and the reference manual lane is retained.

## Delivered implementation

The production demo now checks whether Best already covers each updated prime
before computing a new inverse valuation. The redundant Need table is removed.
The minimum helper uses the greedy valuation weights while retaining Prev as
a lower bound. The original valuation helper and the broad sieve input range
are retained. Two short intent comments explain pruning and the weights.
No interpreter/compiler source changes or new large arrays were introduced.
The Number min/max and bounded native-sieve research prototypes were not applied.

Final production measurements at the full default Upper=1000000, three fresh
processes per version in rotating sequential order on each host:

| Compiled version | Mac ms | Intel ms | Mac peak MiB | Intel peak MiB |
| --- | ---: | ---: | ---: | ---: |
| Original | 8064.9 | 15956.9 | 235.3 | 215.1 |
| Production | **675.2** | **1648.5** | **212.2** | **189.4** |

This is about 11.9x / 9.7x faster with peak RSS reduced by about 23 / 26 MiB.
All full compiled runs returned 278157919195482643. These final medians are
from a separate series, so they differ from the earlier research observations;
all samples, including wall-time/RSS variation, are retained in the raw records.
Other machine work was not stopped. Imports/interpreter construction are
excluded; parsing, analysis, compilation and execution are included. RSS is
peak total process memory.

Reference controls at Upper=10000, also medians of three fresh processes:

| Reference version | Mac ms | Intel ms | Mac peak MiB | Intel peak MiB |
| --- | ---: | ---: | ---: | ---: |
| Original | 2820.8 | 8110.5 | 449.5 | 428.4 |
| Production | 561.6 | 1741.7 | 339.2 | 326.4 |

The existing full reference exclusion remains. The earlier improved full
reference control exceeded 45 seconds; no completed full-reference speedup is
claimed. A full compiled golden assertion was added to the ordinary focused
suite instead of weakening a timeout or dropping coverage.

Validation:

- 28 focused tests passed on each host, including independent factorial
  constraints, inverse carry boundaries, Prev preservation, targets above
  Number's safe range, the statement checkpoint, and the full compiled answer.
- The updated Rank fixture adds two small test cases for inverse boundaries
  and lower bounds. It passed scoped type and differential audits (two audit
  tests). No exhaustive audits were run.
- The actual production source passed 25788 independent inverse checks and
  27 whole-program checks on each host across the three engine configurations.
- The independent full oracle reconfirmed answer 278157919195482643 and final
  Best 1234559248024796.
- Build, semantic-boundary checks and application-form checks passed.

Production source is read directly by the delivery runner:

```sh
node benchmarks/experiments/euler320-delivery-series.mjs
node benchmarks/experiments/euler320-verify.mjs production
node benchmarks/euler320-investigation.mjs compiled 1000000 production
```

Final raw records: `baselines/2026-11-02-euler320-delivery-{mac,intel,verification}.json`.

## Finding

The [problem](https://projecteuler.net/problem=320) asks for the sum, from
10 through one million, of the least n for which n! is divisible by
(i!)^1234567890, modulo 10^18. The existing demo already maintains prime
exponents incrementally and compiles its sieve and main loop. The main loop
uses mixed arithmetic for the large answer accumulator, so this is not an
uncompiled-program problem.

The dominant algorithmic waste is recomputing a minimum for every updated
prime, even when the current global Best already satisfies that prime's
requirement. A full diagnostic run executed 34190985 Number scalar functions,
primarily valuation calls inside minimum's search. Removing only a duplicate
valuation in the upper-bound loop did not show a useful compiled improvement
in its exploratory control (7.17 s versus an initial original control 6.84 s).

## Candidate algorithm

After increasing Want P, check whether `Best valuation P` is sufficient.
Only if it is insufficient does the global minimum need to increase:

```rank
Want P += K * E
if (Best valuation P) less (Want P)
  Best = P (Want P) Best minimum
end
```

All other prime constraints are unchanged, so the previous Best still covers
them. The per-prime Need array is unnecessary. An independent full oracle
counted 2853708 updated-prime checks but only 293510 inverse searches: about
90% of the searches can be skipped.

The strongest tested candidate also replaces the inverse valuation search.
For base p >= 2, let w_k = (p^k - 1)/(p - 1), the valuation at p^k. Greedily
subtracting multiples of descending w_k gives the least factorial argument
whose valuation reaches the target. Each quotient is at most p; a digit p
can occur only as the final digit, carrying into the next power. The loop
grows weights using `Weight <= (Target - 1) // P`, avoiding an unnecessary
oversized multiplication before its condition can fail. All arithmetic
remains exact Rank integer arithmetic. `return Result max Prev` preserves
the existing helper's behavior when its supplied lower bound is already
above the unconstrained minimum.

The helper has two short loops instead of repeated valuation plus bisection.
The intended domain is prime P >= 2 and nonnegative Target/Prev, including
wide integers. [The complete proposed demo](experiments/euler320-prune-greedy.ra)
is a generated, reviewable experiment, not the production demo.

## Repeated timings and memory

Three fresh processes per case, rotating order, sequential on each host.
Imports and interpreter construction are excluded; parse, analysis, compilation
and execution are included. RSS is peak total process RSS. Other machine work
was not stopped. Profiling/diagnostics ran separately. Every full compiled
sample returned `278157919195482643`.

| Full compiled variant | Mac ms | Intel ms | Mac peak MiB | Intel peak MiB |
| --- | ---: | ---: | ---: | ---: |
| Original | 7140.5 | 15777.4 | 234.6 | 214.2 |
| Cached bound + manually inlined valuation | 2561.1 | 9485.7 | 233.2 | 215.0 |
| Skip covered primes, original minimum | 1294.3 | 3009.9 | 211.1 | 191.8 |
| Skip covered primes, inlined minimum | 775.0 | 2150.3 | 211.2 | 193.9 |
| Skip covered primes, greedy minimum | **654.0** | **1638.4** | **208.7** | **190.6** |

The final candidate is about 10.9x faster on Mac and 9.6x on Intel, with
peak RSS reduced by about 26 / 24 MiB. No extra full-sized table is introduced;
Need is removed. Replacing minimum alone with the greedy version, without
pruning, took 3.95 s in an initial exploratory Mac control: the skipped searches
are the larger win.

The existing native `factorsieve` also covers the default Upper=1000000.
A local exploratory combined variant took 607 ms / 209 MiB (one run) and
passed the oracle for bounded inputs. However, its public bound is 1048575,
whereas the original demo accepts larger Upper values. This is a bounded
experiment, not a general replacement; production use would require retaining
the original sieve as a fallback. No Intel speedup is claimed for this option.

## Reference execution

Three-process medians at Upper=10000:

| Reference variant | Mac ms | Intel ms | Mac peak MiB | Intel peak MiB |
| --- | ---: | ---: | ---: | ---: |
| Original | 3234.6 | 8190.3 | 448.3 | 428.9 |
| Skip covered primes | 907.3 | 2730.7 | 437.7 | 416.7 |
| Skip covered primes + greedy | **576.0** | **1732.3** | **339.5** | **326.5** |

Reference speed improves about 5.6x / 4.7x on this reduced input, with lower
peak memory. A full Mac reference candidate was stopped after 45 seconds;
no full original reference timing or full Intel reference timing was taken.
Do not extrapolate the reduced-input ratio to a completed full run. The
existing manual execution exclusion should remain until a separate budget
change is justified.

## General compiler findings

`compileScalarNumberKernel` in `jit/scalar-function-kernel.ts` rejects proofs
with dependencies/calls, so a loop helper that calls another helper cannot
become one Number scalar region. The exact scalar kernel can still call a
leaf's Number specialization. `FunctionInvocation.prepareScalarCall` then
converts bigint arguments to Number and boxes integer results back to bigint.
The original minimum/valuation pair pays those boundaries repeatedly.
A separate 100000-input CPU profile recorded approximately 313 ms in generated
functions, 132 ms in directFn, plus call-specialization/return-contract frames.

Manual inlining of valuation into the same cached-bound binary search
improves execution materially, demonstrating a generic opportunity to remove
pure scalar call boundaries. It is not the proposed demo rewrite: preserving
small ordinary helpers is preferable to duplicating their loops at call sites.
An implementation must retain binding identity guards, call-depth accounting,
return contracts, error locations, wide-integer fallback and observation rules.

There is also an admission mismatch: scalar extreme lowering exists, but the
Number scalar whitelist admits only len/floor/ceil among native reads. Adding
min/max in an isolated built-JS prototype allows the candidate's leaf minimum
to use Number as well as valuation. That raises Number function entries from
2853708 to 3147218, exactly the 293510 inverse searches, without overflow.
It is not a reliable unconditional speed optimization:

| Same candidate, three alternating trials | Mac ms | Intel ms | Mac peak MiB | Intel peak MiB |
| --- | ---: | ---: | ---: | ---: |
| Current runtime | 616.3 | 1617.5 | 208.3 | 190.3 |
| Allow min/max in Number scalar guard | 870.0 | 1402.5 | 212.3 | 195.4 |

The prototype regresses Mac by about 41%, while improving Intel by about 13%.
It was not applied to production and was not subjected to a full semantic
regression audit. These results argue for measuring scalar call fusion and
its arithmetic cost, rather than assuming more Number coverage always wins.

## Correctness

- The full answer matches the independent JS oracle, which uses its own SPF
  sieve, Legendre valuations, ordinary bisection and exact bigint summation.
  It explicitly checks the safe-number bounds used in its division arithmetic.
  It returned `278157919195482643`, final Best `1234559248024796`, and 293510
  inverse searches. It shares neither the Rank implementation nor the greedy
  inverse formula.
- On each host, seven variants passed 180516 helper comparisons against an
  arbitrary-precision binary-search oracle and 189 complete small programs
  across reference, compiled and exact-loop modes. Mac totals combine the
  four base variants and three pruned variants; Intel ran all seven together.
- Prime bases include 2 through 31, 97, 997 and 999983. Targets include 0..149,
  1000, 1234567890, 1234567890000000 and 9007199254740993. Lower bounds include
  zero, half the true minimum, the true minimum, and one above it. This checks
  wide fallback and preservation of Prev, not only the monotone production path.
- Whole-program bounds include 0, 1, 2, 9, 10, 11, 20, 100 and 1000. Small
  expected sums factor integers independently and use ordinary inverse search.
  The statement's Upper=1000 checkpoint is `614538266565663`.
- The bounded native-sieve option passed an additional 25788 helper checks
  and 27 programs on Mac. No exhaustive repository audits were run.

## Research recommendation before delivery

Adopt the covered-prime check and greedy inverse after focused regression
coverage, retaining the ordinary valuation helper and the current broad sieve
input range. This is compact and improves both speed and memory on both CPUs.
The generic compiler follow-up is reducing pure scalar helper-call overhead;
manual inlining demonstrates its potential. The min/max whitelist-only prototype
should not be shipped as a blanket performance change based on this workload.

## Reproduce

After building the runtime:

```sh
node benchmarks/experiments/euler320-series.mjs
node benchmarks/experiments/euler320-verify.mjs original cached greedy inline prune prune-inline prune-greedy
node benchmarks/experiments/euler320-oracle.mjs
node benchmarks/euler320-investigation.mjs compiled 1000000 prune-greedy
DIAGNOSTICS=1 node benchmarks/euler320-investigation.mjs compiled 1000000 prune-greedy
node benchmarks/experiments/euler320-extrema-prototype.mjs "$PWD" /tmp/rank320-fresh-prototype
PROTO_ROOT=/tmp/rank320-fresh-prototype node benchmarks/experiments/euler320-extrema-series.mjs
```

RANK_ROOT selects a built runtime in another directory. Source variants remain
relative to the benchmark scripts. Raw records and verification are under
`baselines/2026-11-02-euler320-*.json`. The source is frozen at the revision
above; the final production change is covered by the delivery section.
