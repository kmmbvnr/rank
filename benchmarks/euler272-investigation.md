# Euler 272 investigation

2026-10-30, Node v24.15.0, darwin arm64. The issue #447 table still lists
272 as unfinished. The official task is <https://projecteuler.net/problem=272>:
sum n <= 10^11 with 242 nontrivial cube roots of unity modulo n.

The initial investigation preserved the production program. The delivery section
below records the implemented demo and general compiler changes. Audit budgets
remain unchanged. The original program is frozen in `experiments/euler272-original.ra`.
`euler272-investigation.mjs` builds experimental variants from that snapshot.

## Why it is slow

The mathematical reduction is already good. By the Chinese remainder theorem,
the number of all roots is 3^t, where t counts distinct primes congruent to 1
modulo 3 and the contribution from 9 dividing n. Thus t=5. The program
enumerates four or five contributing primes and their extra powers; tables
sum the remaining cofactors. It does not test every integer through 10^11.

The implementation nevertheless traverses many impossible prime prefixes.
Its existing powers of the current prime give weak lower bounds for the
remaining distinct primes. The final prime is enumerated individually even
when the remaining cofactor is less than 7 and no contributing prime can recur.

One instrumented full original compiled run took 34.820 s: 0.375 s through the
sieve, 0.153 s prefix sums, 0.334 s cofactor tables, 33.958 s search. The search
already compiles as an exact integer region. This is not an absent-compiler case.
Historical issue timings are not directly comparable to this current build.

## Experiments

- `scaled`: factor the mandatory 9 out of mode 1. Its cofactor argument becomes
  floor(Limit / (9*A)); multiply its contribution by 9 outside the table.
  The largest table argument is now floor(Limit / 482391), rather than
  floor(Limit / 53599): nine times fewer cells. Here 482391=9*7*13*19*31.
  Mode 0 needs at most floor(Limit / 1983163), which is smaller still.
- `tight`: additionally bound every prime prefix using the product of the
  actual smallest remaining distinct primes. Break as soon as this product
  exceeds the mode's limit. Keep the old bounds as redundant checks in this
  experimental form; a final implementation should remove redundant code.
- `batched-tight`: additionally aggregate the final-prime tail for cofactor
  q=1..6 using a prime prefix-sum table and binary searches. Primes in
  (floor(L/(A*(q+1))), floor(L/(A*q))] share a table weight. Clamp the lower
  endpoint above the preceding prime. Restrict the ordinary final-prime loop
  to floor(L/(A*p)) >= 7, so the two parts are disjoint. Every selected prime
  is >=7; the tail cannot contain an extra power of one of these primes.
- `batched` without tight bounds is rejected: it performs binary searches for
  many impossible prefixes (4.092 s at 10^9 versus original 0.489 s).
  Its full compiled run was stopped; it has no completed full timing.
- `helper-tight` shares the binary-search helper instead of duplicating its
  body. One full compiled run: 4.887 s. More compact, but slower than the
  inline prototype on this runtime.
- `flat-tight` uses a single flat cofactor table instead of a local table alias.
  One full compiled run: 4.990 s, versus tight 11.052 s. It enters the existing
  mixed Number/BigInt backend. This is evidence of a generic compiler opportunity,
  not a proposed requirement to flatten Rank matrices in user programs.
- `flat-batched-tight` combines that layout with the shared helper: 5.009 s.
- `vector-tight` expresses the six tail queries using array `upperindex`.
  One full compiled run: 47.283 s, peak RSS 1001 MiB. Diagnostics report about
  4.7 million compiled loop executions as the surrounding region fragments.
  This compact form is rejected on current performance evidence.

Single-run instrumented full compiled results (not repeated medians):

| Variant | Seconds | Peak RSS MiB |
| --- | ---: | ---: |
| original | 34.820 | 522 |
| scaled | 24.263 | 383 |
| tight | 11.052 | 420 |
| batched-tight | 2.317 | 438 |

Peak RSS includes Node/import/parsing and is not retained array size. Table
cell counts fall ninefold; total process RSS does not fall by that factor.

## Generic compiler findings on the initial runtime

1. In `jit/integer-loop-statements.ts`, local array aliases explicitly reject
   Number lowering because the backend does not implement per-store COW for
   them. The alias `Vt` and its sources are only read in this search. A general
   proof of read-only aliases could safely retain numeric lowering for such
   regions; simply removing the guard would be incorrect for mutable aliases.
2. A real correctness defect exists in mixed integer lowering of array reads.
   `experiments/euler272-mixed-matrix-repro.ra` adds four matrix cells to
   9007199254740992. Reference returns 9007199254740996; compilation throws
   `Cannot mix BigInt and other types, use explicit conversions`.
   The exact-expression emitter converts numeric row registers to BigInt,
   while `numberOffset` multiplies by Number dimensions. Address calculations
   must remain checked numeric operations while loaded values can be BigInt.
   The experimental `matrix-tight` variant exposes this defect on the full task.
3. The inline batched prototype reaches the existing 128-statement region
   budget. The runtime falls back to compiling smaller nested regions, and
   still gets the measured speedup. Raising the limit indiscriminately is not
   required by this investigation; better helper integration is a separate
   generic optimization opportunity.

The delivery below fixes the first two findings. The historical prototypes above
remain available for reproducing the original investigation.

## Verification and timing limits

`euler272-verify.mjs` independently sieves root-contributing prime factors for
all integers through 10^7. It checks 48 cases: original/scaled/tight/batched-tight,
both modes, and six limits (1, 482390, 482391, 1000000, 1983163, 10000000).
The first valid number is 482391. All comparisons passed.

Every full timed variant asserts Answer=8495585919506151122 against the
unchanged original. The existing fixture's 10^7 and 10^9 answers are retained
in the harness. No full corpus audit was run; language/interpreter TypeScript
build and benchmark syntax checks passed.

The full reference batched-tight run was stopped after exceeding 90 seconds;
there is no completed full reference timing. The original fixture comment says
15 minutes for the full default; that historical comment was not remeasured.
Reference performance is compared at 10^9 instead. Do not extrapolate it to
claim a measured full-default reference speedup.

Repeated series: fresh serial processes, three rotated rounds, no overlapping
builds/tests from this investigation. Parsing/execution included; imports excluded.
Diagnostics/stage markers disabled. Other host workloads are not controlled.
The raw baseline records runtime hashes because another session changed HEAD
during the investigation; all samples use the same built runtime.

Repeated medians (three fresh processes per case):

| Mode / input | Original | Batched-tight | Speedup | Peak RSS before / after |
| --- | ---: | ---: | ---: | ---: |
| Compiled, 10^11 | 40.331 s | 2.688 s | 15.0x | 523 / 443 MiB |
| Reference, 10^9 | 9.623 s | 1.459 s | 6.60x | 477 / 370 MiB |

Original compiled range: 38.748–40.470 s; candidate: 2.573–2.781 s.
Reference original: 9.622–9.715 s; candidate: 1.431–1.481 s.
These plain-run medians are separate from the instrumented pilot series above.
Raw samples and diagnostics: `baselines/2026-10-30-euler272-investigation.json`.
The runtime and source hashes were checked unchanged throughout the repeated series.

Reproduce after building `packages/language` and `packages/interpreter`:

```sh
node benchmarks/euler272-investigation.mjs compiled original 100000000000
node benchmarks/euler272-investigation.mjs compiled batched-tight 100000000000
node benchmarks/euler272-investigation.mjs reference original 1000000000
node benchmarks/euler272-investigation.mjs reference batched-tight 1000000000
node benchmarks/euler272-verify.mjs
```


## Delivery

The production demo now uses scaled cofactor tables, exact remaining-prime
bounds and the quotient-interval tail. Redundant old power bounds were removed.
The resulting search fits the existing region budget and executes as one mixed
Number/BigInt region; neither the statement nor copy-admission limit changed.
The shared-helper prototype remains slower (4.867 s in one full check), so the
shipping code retains two explicit interval searches with comments.

General compiler repairs:

- Array read coordinates stay in the checked numeric backend even when loaded
  values feed exact BigInt expressions. Coordinate dependencies propagate back
  through assignments. Computed address temporaries are not hoisted outside
  their declaration scope. This fixes the mixed-matrix crash.
- Local integer-array aliases borrow numeric buffers only in read-only regions
  without calls. Rebinding refreshes dimensions, and publication retains normal
  snapshots. Mutable aliases and calls retain conservative fallback.
- Track external array aliases from their first assignment. Writes to an alias
  source must not reuse stale readers; this exposed and fixed an additional
  exact-loop correctness case. Existing safe old-alias stores after source
  rebinding remain compiled.

Final three-process medians, after merging the concurrent main updates:

| Mode / input | Original initial runtime | Shipping final runtime | Speedup |
| --- | ---: | ---: | ---: |
| Compiled, 10^11 | 40.331 s | 2.469 s | 16.3x |
| Reference, 10^9 | 9.623 s | 1.287 s | 7.48x |

Final compiled range 2.076–2.966 s, reference 1.274–2.027 s. Host load is not
controlled. A separate pre-merge series measured 2.143 s / 1.284 s; it is retained
separately rather than pooled with the final series. Original with the compiler
fixes alone took 37.245 s in one full diagnostic check: most task speedup comes
from the algorithm, not simply admitting the original loop to Number mode.
Final median process peak RSS: 507 MiB compiled / 368 MiB reference, versus
523 MiB / 477 MiB in the original series. The final whole-region lowering uses
more process memory than the initial fragmented prototype; no twofold RSS
reduction is claimed. Cofactor table dimensions still fall ninefold.

Verification after integration: 918 checks passed in 17 compiler/arithmetic
files; the alias file subsequently passed all nine tests with an additional
matrix-dimension regression. Full compiled golden, scoped fixture type audit
and scoped fixture differential passed (three checks). The fixture retains its
original two inputs and adds the boundary below/at 482391. Twelve shipping
comparisons against the independent sieve passed in both modes. The full
compiled default is now an ordinary regression test in `full-scale-demos`.
The existing full-reference execution exclusion is unchanged; no exhaustive
corpus run or completed full reference timing is claimed.

Final runtime/source hashes, raw samples and validation details are in the
baseline's `delivery` section. For the actual demo use variant `shipping` in
the benchmark command. The initial experiment sections above describe the
pre-delivery runtime, including defects that are now fixed.
