# Euler 304: Primonacci investigation

## Delivered implementation

The production program retains array fast doubling, computes the shared high
prefix once, and binds single-use suffix intermediates with ordinary `=`. Defaults
and the full answer **283988410192** are unchanged. No Number approximation is
used for modular products.

Generic prime enumeration now promotes a high-start traversal after **1024
primes have been delivered and further demand arrives**. The larger segmented
workspace is bounded below 2^48; its temporary base uses at most 1 MiB of bits,
and its typed prime list about 4.1 MiB. Short prefixes and larger arbitrary
integers retain direct primality testing. Membership retains its old region and
demand policy. Small observers retain the original single-pass byte base sieve;
only the wide workspace uses bit flags and two passes into a Uint32Array.

Threshold controls at Start=10^14, three fresh processes per cell:

| Delivered count | Previous runtime, ms | Threshold 256, ms | Threshold 1024, ms | Threshold 4096, ms | Threshold 8192, ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1000 | 23.1 | 116.1 | 22.5 | 22.5 | 23.2 |
| 10000 | 199.1 | 118.5 | 141.2 | 185.6 | 257.4 |
| 100000 | 1645.4 | 247.6 | 259.1 | 314.3 | 380.9 |

Promotion cannot know future demand: a caller stopping just after the threshold
can still pay setup for a short remaining tail. This is documented beside the
constant. No timing probes or changes to the `in primes` policy were added.

### End-to-end delivery controls

Three serial fresh-process samples per case in rotating order. Before and after
runtimes differ only in prime-sequence, prime-sieve and the diagnostic counter;
other generated JS modules were compared byte for byte. The baseline snapshot
was built from the current runtime based on 51362d77 with the pre-change prime
modules (their sources were identical at 7e04577a). Later ordinary tests do not
overlap these samples. Raw data: `baselines/2026-11-01-euler304-delivery.json`.

| Program/runtime | Compiled wall median, s | CPU median, s | Peak RSS median, MiB |
| --- | ---: | ---: | ---: |
| Original / previous runtime | 4.006 | 4.459 | 387.4 |
| New array program / previous runtime | 2.354 | 2.644 | 253.6 |
| Original / new runtime | 2.463 | 2.938 | 387.8 |
| New array program / new runtime | **0.850** | **1.143** | **261.4** |

Full reference medians: **7.823 -> 1.258 s**, peak RSS **456.4 -> 428.7 MiB**.
The measured compiled wall ratio is about 4.7x and peak RSS falls about 32.5%.
Reference RSS only changes modestly; do not claim the same memory gain there.
The small-observer compatibility repair was made after this series; it leaves
the high-start wide path measured here unchanged. Subsequent final-code controls
returned the same full answer in **1.062 s compiled / 1.131 s reference**, with
peak RSS 255.9 / 434.0 MiB. Host load is uncontrolled; these controls and ranges
must remain visible alongside the medians.

Regression controls, three serial before/after full runs each:

| Demo | Before wall, s | After wall, s | Before CPU, s | After CPU, s |
| --- | ---: | ---: | ---: | ---: |
| Euler 060 | 3.192 | 3.145 | 4.321 | 4.181 |
| Euler 263 | 2.850 | 2.923 | 3.057 | 3.153 |

Ranges overlap; the 263 median is about 2.5% slower, insufficient to separate
from host variation. An earlier experiment bit-packed small observers too;
its controls are preserved as `controls-packed-small.json` and that change was
removed from production. All controls assert their full original golden answer.

### Delivered validation

- TypeScript build passes.
- Seven new long-prime tests cover delayed promotion, endpoints, iteration and
  membership independence, interruption, the wide upper edge and fallback across
  that edge; 39 focused prime tests pass in total.
- 112 independent small-input checks cover seven program variants and both
  engines; the oracle uses trial division and linear Fibonacci recurrence.
- Complete independent segmented sieve matches every one of 100000 production
  prime values, including segment boundaries.
- Four fixture blocks cover the original range, a singleton, a binary boundary,
  and Start=0/Mod=1. A full-scale ordinary test asserts the complete answer and
  verifies wide-prime and exact tensor execution.
- The main's execution-budget exclusion is removed for both engines.
- 10498 ordinary interpreter tests pass across 457 files (exhaustive audits excluded)
- four scoped type/differential checks and two scoped name-facts checks pass for the main and fixture; semantic-boundary and application-form checks pass

The general compiler extension for deferred tensor stages inside arbitrary loop
bodies is **not implemented here**. The demo uses explicit ordinary bindings;
existing plan capture, unused-plan behavior and error timing are unchanged. The
fastest gap-recurrence prototype remains an experiment, preserving the user's
preference for the array program.

## Historical research

The following measurements predate implementation and are retained with their
original experiment boundaries.

## Current result

The next unfinished numbered entry in the live #447 table was
`euler/304_primonacci.ra`. The current full default already completes in seconds;
its historical budget exclusion should not be treated as a current measurement.
The answer remains **283988410192**.

Measured on 2026-11-01, Apple M5, Node v24.15.0, macOS arm64, runtime built from
`7e04577a` (build files predate this investigation). Three fresh serial processes
per case, rotating case order for the primary series. Startup/import time is
excluded; parsing and execution are included. Staged execution splits immediately
after `Pr = ... array`, in the same interpreter, to measure prime enumeration and
Fibonacci work separately. Diagnostics are enabled consistently. This is a busy
host: ranges are material, and independently computed medians need not add up.
Peak RSS is the entire process, not retained heap or an allocation count.

| Variant | Compiled wall median, s | Fibonacci phase median, s | Peak RSS median, MiB |
| --- | ---: | ---: | ---: |
| Original array program | 4.169 | 2.152 | 377.8 |
| Same array program, three deferred intermediates changed to ordinary bindings | 3.333 | 1.373 | 253.2 |
| Scalar fast doubling for each prime | 2.806 | 0.468 | 174.5 |
| Common binary prefix, original deferred array suffix | 2.926 | 1.188 | 379.7 |
| Common binary prefix, ordinary array suffix bindings | 2.558 | 0.498 | 256.1 |
| Cached Fibonacci values for prime gaps | 1.990 | 0.077 | 184.6 |

Original compiled samples span 3.778–5.611 s; ordinary-binding samples span
2.515–3.983 s. Prefix variants were measured in a later serial three-sample series;
they are evidence of a useful direction, not a precisely controlled speedup ratio.

Reference medians (same primary series): original **5.842 s / 442.1 MiB**;
ordinary bindings **3.224 s / 437.2 MiB**; gap algorithm **2.152 s / 184.0 MiB**.
Reference original samples span 5.454–8.217 s. No scalar reference full run was
needed to choose the direction.

## Where time and memory go

The existing algorithm is valid fast doubling, O(Count * log(max prime)). It
runs 47 bit stages across 100,000 primes. It is not computing Fibonacci terms by
walking to 10^14. It already benefits from compiled exact tensor kernels:
94 compiled tensor executions in the original full run. However, 9,359,452 cells
still go through ordinary cell evaluation (28,159,452 in reference).

The outer loop explicitly declines with `loop:deferred-binding:AssignmentStatement`.
The source tensor frontend rejects deferred statements, and its ordinary consumer
cannot bind the deferred name `Twice` as a numeric tensor input (`tensor:binding:Twice`,
47 times). Native graphs do compile some other stages. Thus the issue is partial
lowering, not a completely uncompiled program. Scalar operator guards declining
arrays do not by themselves mean an error or a missing tensor kernel.

Changing `Twice'`, `Shifted'` and `Next'` to ordinary bindings removes ordinary
computed cells in the full compiled run and increases compiled tensors from
94 to 188. It leaves all array operations and ordinary completion boundaries in
place. This is an explicit program change, not permission to ignore deferred
semantics in the compiler. A general compiler improvement would connect proved
pure deferred stages to their consumers inside loop bodies while preserving
capture/rebinding, non-demand and error timing. Existing scalar-function stage
support is narrower; the present loop is not a proved scalar function.

Number-only arithmetic is unsafe: residues are below 1.24e12, but products may
approach 1.53e24. Exact BigInt operations or a separately proved exact modular
multiplication backend remain necessary. The successful tensor paths here use
exact arithmetic (`numberTensors = 0`). `cowCopies = 0` in the measured original:
RSS reduction must not be attributed to removal of observed CoW copies.

## Algorithm alternatives

**Keep arrays:** all selected primes share a high binary prefix. Here the first
prime is 100000000000031 and the last is 100000003235443. Their XOR needs 24 bits,
whereas the full indices need 47. Compute the common 23-bit prefix once with
scalar fast doubling, broadcast its two Fibonacci states, and execute the
existing array suffix on only 24 bits. This is derived from min/max and has no
hardcoded prime-range width. Count=1 and power-of-two boundaries are covered by
small checks. The suffix still uses `choose` and array arithmetic.

**Fastest Fibonacci phase:** compute two initial Fibonacci values, precompute
Fibonacci residues through the largest prime gap, then advance between primes.
For gap g and state A=F(n), B=F(n+1):

```
C = (A * F(g+1) + (B-A) * F(g)) mod Mod
B = (B * F(g+1) + A * F(g)) mod Mod
A = C
```

The gap phase includes finding the largest gap and constructing its table. It
avoids repeated logarithmic exponent work but introduces a sequential recurrence.
Keep this as a measured option if preserving array structure is the priority.
The simpler scalar-per-prime prototype independently shows that the existing
compiled scalar backend is much closer to native arithmetic than these tensor
stages, though it still repeats all 47 stages per prime.

## Generic prime-sequence opportunity

`runtime/prime-sequence.ts` uses the bounded segmented `PrimeSieve` only through
2^40-1. Above it, it visits odd BigInt candidates with small-factor screening and
Miller–Rabin. This is appropriate for isolated huge queries, but this workload
asks for 100,000 consecutive primes in a range of only about 3.24 million.

Standalone JavaScript enumeration prototypes, fresh processes, three samples:

| Method | Wall median, s | Peak RSS median, MiB |
| --- | ---: | ---: |
| Existing `primeRange` | 1.711 | 104.8 |
| Segmented screening by factors through 65,536, then existing primality check | 1.381 | 106.0 |
| Complete segmented sieve, base primes through 10,000,000 | 0.207 | 126.1 |

Both prototypes use blocks of 1,048,576 integer positions. The small-factor
variant remains exact because survivors retain the existing primality check.
The complete sieve skips that check only if its base table covers the integer
square root of the segment end. It is an experiment for this safe-integer range,
not a general arbitrary-BigInt enumeration implementation. Prototype base flags
use bytes and a JS prime list; a production bounded bit/typed table can be more
compact. The larger sieve trades roughly 21 MiB of process RSS for much faster
long-range enumeration. It is not a memory win by itself.

Do not simply raise the global cap: short demands should not pay for a table to
sqrt(Start), and arbitrary BigInt starts must retain the existing path. A useful
general improvement is demand-aware segmented enumeration for long runs at high
safe-integer starts, with explicit workspace limits and cancellation. Membership
queries have a different demand pattern and need separate regression controls.
No end-to-end runtime combining this sieve with the Rank variants was measured;
do not add independent phase medians and report the sum as a measured runtime.

## Verification and reproduction

- Every timed full Rank variant asserts the published sum 283988410192.
- 96 independent small checks: six Rank variants, both engines, eight input sets.
  Oracle uses trial division and a linear Fibonacci recurrence, not fast doubling.
  Includes Start=0,1,2, Mod=1,2, Count=1, and ranges crossing binary boundaries.
- Independent complete sieve compared **every one of 100,000 primes** against
  existing enumeration, not just the final sum. All matched; prime sum is
  10000000161855857652. Verification is excluded from its recorded timing.
- Production code is untouched; no ordinary or exhaustive suites were started.

```
node benchmarks/euler304-investigation.mjs compiled 100000 original
node benchmarks/euler304-investigation.mjs compiled 100000 prefixeager
node benchmarks/euler304-investigation.mjs reference 100000 gaps
node benchmarks/experiments/euler304-samples.mjs
node benchmarks/experiments/euler304-extra-samples.mjs
node benchmarks/experiments/euler304-verify.mjs
VERIFY=1 node benchmarks/experiments/euler304-primes.mjs screen 100000 10000000 1048576
```

Raw measurements: `baselines/2026-11-01-euler304-{samples,extra}.json`.
Independent checks: corresponding `verification.json` and `prime-verification.json`.

Recommended implementation order: retain array syntax, improve generic prime
range enumeration with bounded/adaptive demand, then consumer lowering for pure
deferred tensor stages. The common-prefix rewrite is a compact additional
algorithm improvement; the gap recurrence is an optional larger rewrite.
