# Euler 501–513: algorithms and runtime boundaries

Scope: Euler 501, 502, 504, 505, 507, 511 and 513, from issue #447.
The investigation started at `6fc3115f` in an isolated worktree. The data below
records that isolated implementation before integration with later main changes.
Every full default has a compiled golden regression; independent checks cover
all answers. The shared runtime changes are scalar choose lowering, native
integer overload support, Number function capabilities and packed boolean gathers.

## Full defaults

Node v24.15.0 on Apple M5 / arm64 and Intel / x86_64. Seconds and process peak
RSS are medians of three fresh, serial processes, except Euler 505, which has
one final full sample on each host. Timing includes parsing and compilation;
runtime imports and process startup are excluded. Other host activity was
uncontrolled. These timings are not comparable with the old concurrent audit.

| Euler | Mac seconds | Mac MiB | Intel seconds | Intel MiB | Exact answer |
| --- | ---: | ---: | ---: | ---: | ---: |
| 501 | 2.141 | 222.6 | 7.591 | 212.1 | 197912312715 |
| 502 | 5.677 | 454.8 | 16.963 | 317.7 | 749485217 |
| 504 | 1.003 | 572.5 | 2.784 | 437.6 | 694687 |
| 505 | 55.539 | 180.9 | 165.534 | 164.9 | 714591308667615832 |
| 507 | 7.259 | 189.5 | 17.135 | 183.9 | 316558047002627270 |
| 511 | 0.801 | 203.6 | 1.467 | 195.9 | 935247012 |
| 513 | 2.839 | 649.6 | 9.425 | 595.6 | 2925619196 |

For 501, use `rank501-final-{mac,intel}.json`; those runs replace the intermediate
501 source in `rank505-delivery-{mac,intel}.json`. Every row records the source
SHA-256, Node version, CPU, arguments, answer and RSS. The raw variant name
`original` means the production demo at measurement time; `baseline` is the
saved source from `6fc3115f`.

## What changed

### 501: one sieve table and direct prime-pattern counting

The Lucy sieve stores pi(v) and pi(N//v) in two rows of a private table.
Ascending quotient indices and descending ordinary values read the previous
prime's values before replacing them. This removes the repeated replication,
gather and slice-update buffers. The final p^7, p^3*q and p*q*r counts use the
same table directly, without constructing owner/index vectors for all prime
pairs. Quotient comparisons bound p^4 and p^7 without forming huge powers.

The final full diagnostic publishes one two-million-cell table. At N=10^10,
source-control medians are 0.861 → 0.248 s on Mac and 2.700 → 0.685 s on Intel.
The compact final counter also lowers full Mac RSS from the intermediate
vector-counter version's 578.0 MiB to 222.6 MiB.

Tradeoff: at N=10^8, a single reference control slows from 0.292 to 1.373 s
on Mac and from 0.847 to 4.573 s on Intel. The full reference sieve was not run.
It retains its manual/reference audit lane; the full compiled answer has a
separate regression and its small fixture remains in the audits.

### 502: exact convolution and Bostan–Mori

`pmul` uses the existing `A convolve B mod Md` operation. Its exact NTT/CRT
implementation replaces an outer product, square zero padding and a skew
reshape/reduction. Bostan–Mori now also handles the width-10000 term, replacing
the quadratic coefficient recurrence. The height-10000 generation passes remain.

The original full program currently fails because the Bostan–Mori range
`Nn mod 2 till U len by 2` is parsed as a scalar. Explicit bounds fix it.
The saved source with only those range corrections returns the same full answer
in 13.557 s on Mac / 39.923 s on Intel (one control each), versus the delivered
5.677 / 16.963 s medians. The earlier overlapping 36.988 s Mac observation is
retained separately and is not used for the final comparison.

Small independent linear-series coefficients, both original fixtures (including
huge width/height), and the corrected original full algorithm verify the result.

### 504: direct packed boolean gathers

The Rank demo keeps its array implementation. The old full profile attributed
58.6% of sampled self time to generic gather. It read packed bits through a
per-cell Proxy, built a boxed result, then packed that result again.

For completed tracked one-dimensional boolean sources, validated irregular
indices now gather directly into bitmap words. Output selector shape, repeated
indices, COW aliases and semantic array types are retained. Foreign/changed
headers, missing cells, inspection, budgets and unsupported views keep ordinary
execution. Cancellation checkpoints remain in the native loop. New counters are
`packedBooleanGathers` and `packedBooleanGatherCells`.

Disabling only this runtime path on unchanged full source gives 4.311 → 1.027 s
on Mac and 11.323 → 2.689 s on Intel (three-sample medians for both controls).
The demo still publishes about 103 million cumulative typed cells in its numeric
stages. This change removes the gather's temporary boxed cells and Proxy reads;
it is not a claim that all intermediate arrays have been fused or removed.

### 505: direct whole-tree alpha–beta

The issue's 32-statement limit is historical: the existing region limit is 128.
The unchanged source instead misses its hot loop because scalar choose falls
through to generic array selection, which classifies boolean Mx as a rank-three
integer array. Hoisting Mx does not fix that failure.

The shared compiler now recognizes infix and postfix scalar choose with equal
scalar branch domains. Both alternatives evaluate eagerly and once, in source
order. Native bindings are guarded; operands with host/user callbacks retain
ordinary execution because those callbacks could replace choose. Tests cover
shadowing, mutation of a published native call, errors in unselected operands,
error order, exact overflow replay and unsupported array/mixed domains.

On the saved explicit-stack source at N=10^9, disabling/enabling only choose
lowering changes 6.129 → 0.375 s on Mac and 21.361 → 0.917 s on Intel.

The delivered Rank solution implements the recurrence directly. With
M=2^60-1, an internal value is min(M-left, M-right); a parent window [a,b]
therefore gives each child [M-b,M-a]. The first child tightens the second child's
window across the whole irregular tree. The previous decomposition searched
sibling blocks independently with full windows. The new scalar helper also
removes stack-array access and publication. Its depth is about 40 at the default.

An independent C++ oracle implements both traversals with exact unsigned
60-bit arithmetic. Full results agree. Expanded recurrence nodes drop from
1,927,082,767 to 501,469,432, a 3.84x reduction. Function visits are
1,927,082,767 and 769,099,656; the latter includes explicit leaf calls, whereas
the old depth-one shortcut computes both leaves in one call. These counts
compare algorithms and ordering, not window propagation in isolation.

Full unchanged Rank execution was interrupted; no current full-input speedup
against that baseline is claimed. Exact 60-bit values exceed Number precision;
the delivered recursive search uses exact integer execution. The full reference
search retains its budget exclusion and small fixtures remain audited.

### 507: streaming generation and scalar L1 reduction

Each lattice now owns six scalar registers. The weighted median is either a
coordinate with at least half the total weight or the ordinary median of the
three ratios. Floor and successor candidates preserve the L1 minimization.
The helper fits a bounded 512-visit proof budget; excessive functions still
fall back. Integer abs, scalar choose and extrema use the existing checked
Number function backend. Stored boolean input domains are selected from tracked
storage facts rather than guessed as integer arrays.

Tribonacci generation and reduction run in one private compiled region. Each
length is below 10^14+3*10^7, so groups of at most 64 lengths sum below 2^53.
The final sum over those partials is an arbitrary-precision integer. Lc still
selects smaller groups; larger requested groups use this safe cap. N=0 retains
its zero result. The full diagnostic publishes only 312,500 partial cells,
without the old chunk arrays or repeated active-set compaction.

At N=100000, medians are 1.491 → 0.200 s on Mac and 3.553 → 0.531 s on Intel.
An intermediate version retaining vector generation took about 25 s and
740 MiB on full Mac input; streaming lowers that to the final table above.
An integer-only rational weighted-median C++ traversal verifies all twenty
million pairs. Small independent bases are checked by exhaustive coefficient
search with bounds derived from Cramer's rule. Tests also cross group boundaries
and vary Lc, in both engines.

### 511: cyclic convolution without a circulant

The old helper materializes a K by (K+1) circulant and product on each power
step. The solution now takes an exact modular polynomial convolution, adds one
zero and folds the two K-wide rows modulo x^K-1. The K*(K+1) index vector is gone.
No floating-point transform or new language operation is introduced.

An earlier full-source comparison returned 935247012 in 16.380 s / 752.2 MiB
for the old algorithm and 0.806 s / 204.1 MiB for the convolution candidate.
Those are single exploratory observations. The final table reports new
three-process delivery medians. One-step residue DP verifies small N/K inputs;
the existing fixture and original full algorithm agree.

### 513: signed scalar Euclidean floor sums

Vector preparation of trapezoid calls remains. Each call now uses a scalar
floor-sum loop with signed quotient normalization and Euclidean remainder
swapping. It handles reversed/empty intervals and the strict-boundary offset.
This replaces repeated gathers and active-array compaction in trap.

At N=10000, medians are 4.294 → 0.960 s on Mac and 16.833 → 3.185 s on Intel.
A C++ port of the original trapezoid reciprocity independently verifies the
full result. Direct triangle enumeration verifies small n; signed intervals
and integers wider than 64 bits are checked by direct floor enumeration.

## Runtime scope and remaining reference work

There is no single defect common to every workload. The repeated costs were
missing scalar compiler coverage, intermediate array publication, generic
gather dispatch, and algorithms predating the exact convolution primitive.
General changes retain native identity checks and overflow replay. The native
call catalogue supports multiple proven scalar signatures, including the
integer and real abs domains. Number functions admit the audited abs/choose/
extrema paths. Foreign callbacks are excluded from direct scalar choose.

Full reference checks on Mac / Intel took 5.777 / 20.264 s for 502,
1.135 / 3.026 s for 504, 0.769 / 1.422 s for 511, and 15.669 / 54.619 s for 513
(single checks). Their four historical execution exclusions are removed.
501, 505 and 507 retain reference budget lanes with corrected descriptions.

## Verification

- All seven full golden answers pass in dedicated regressions. Heavy tests use
  fresh built-runtime processes with hard deadlines; the original in-VM run
  also passed all seven tests, but took 247.8 s under Vitest instrumentation.
- 1608 Euler 505 comparisons cover original, control, recursive and production
  sources in both engines, against a bottom-up BigInt oracle.
- 244 additional fixture/parameter checks compare neighbour algorithms and both
  engines. Production tests add independent divisors, quadrilateral counts,
  triangle enumeration, generating-series coefficients, residue DP and lattice
  coefficient search. Native full oracles cover 501/505/507/513; the old exact
  full algorithms independently check 502/511, and 504 retains its source.
- The scoped type and differential audits pass 22 cases; scoped name facts pass
  11. They include the four restored full mains and all seven small fixtures.
- 459 focused tests pass after the intended abs eligibility update; 73 further
  kernel/real/packed-gather checks pass. TypeScript build, semantic-owner and
  application-form checks pass. No exhaustive corpus audit was started.

The broad interpreter run passed 11057 tests and failed 13: ten failures also
reproduce on clean `6fc3115f` (four live-slice results, Euler 324/337 and tensor
kernel-count expectations, and missing manual coverage); two concurrent-load
timeouts pass on focused repetition; the old assertion excluding integer abs
was updated for the new capability. Language tests pass 1512 with two reproduced
baseline diagnostics failures. Common tests pass 447 with the reproduced
missing-manual failure. These are not reported as clean whole-suite passes.

## Reproduction

Build with `npm run langium:generate` and
`./node_modules/.bin/tsc -b tsconfig.build.json`. Workspace package links must
resolve this checkout's output. The full regression harness uses built output;
feature-isolation controls require a Node version with module.registerHooks.

```sh
node benchmarks/euler505-investigation.mjs 505 full compiled
node benchmarks/euler505-investigation.mjs 507 full compiled
CONTROL=choose node benchmarks/euler505-investigation.mjs 505 1000000000 compiled baseline
CONTROL=packed node benchmarks/euler505-investigation.mjs 504 full compiled
CONTROL=abs node benchmarks/euler505-investigation.mjs 507 10000 compiled
node benchmarks/experiments/euler505-validate.mjs
node benchmarks/experiments/euler505-neighbour-checks.mjs
python3 benchmarks/experiments/euler505-delivery-series.py "$PWD" node /tmp/euler505-series.json
clang++ -O3 benchmarks/experiments/euler505-oracle.cpp -o /tmp/euler505-oracle
clang++ -O3 benchmarks/experiments/euler-neighbour-oracles.cpp -o /tmp/euler-neighbours
/tmp/euler505-oracle 1000000000000 1
/tmp/euler-neighbours 501 1000000000000
/tmp/euler-neighbours 507 20000000
/tmp/euler-neighbours 513 100000
```

`DIAGNOSTICS=1` records counters; `PROFILE=/tmp/profile.json` samples execution.
Diagnostic/profile observations are screening evidence, separate from serial
medians. Cumulative published-cell counters are not retained memory or bytes.
Raw results and profile summaries are in `baselines/2026-11-02-euler505/`.

## Integration with current main

The final commit is rebased onto `16c1287e`. It preserves the intervening
container, metadata, overload and Euler changes. Native integer abs signatures
and the shared overload catalogue are already supplied by that main revision;
this commit reuses them and extends Number-kernel admission, scalar choose
lowering, proof budget and packed boolean gather handling.

Fresh full runs after integration, one serial process per case and host,
confirm every golden answer on both architectures (Node v24.15.0). These are
verification samples, separate from the medians above.

| Euler | Mac seconds | Intel seconds |
| --- | ---: | ---: |
| 501 | 2.481 | 7.463 |
| 502 | 5.953 | 16.603 |
| 504 | 0.996 | 2.638 |
| 505 | 55.322 | 167.881 |
| 507 | 7.183 | 17.354 |
| 511 | 0.799 | 1.558 |
| 513 | 2.832 | 9.582 |

After the rebase, 111 focused tests and 69 tests covering the intervening
compiler/container features pass. An additional integration regression verifies
that scalar choose eagerly reads both borrowed Int32-array alternatives,
including an out-of-bounds alternative. Semantic-owner, application-form and
TypeScript build checks also pass. The broad-suite baseline failures described
above remain separate from this focused verification.
