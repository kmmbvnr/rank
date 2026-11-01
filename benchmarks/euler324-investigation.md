# Euler 324 investigation

Investigated at `50256d57`, Node v24.15.0, on Apple M5 and the Intel host.
The next unfinished default in #447 was `euler/324_tower.ra`. The production source change and restored audit coverage are described below.
Compiler ownership specialization remains a research follow-up.

## Delivered implementation

The production demo computes the certified period and reduces N before binary
powering, keeping the original small-index check first. Its polynomial product
uses `(A convolve B) mod Mod`. The original recurrence coefficients and initial
terms are retained; no answer table, new large cache or compiler patch is added.
Short comments identify the factor degrees, repeated-root factor and certificate.

The new focused test executes the actual production initializer, reads Mod, C
and Period, and verifies x^Period = 1 using independent exact monic polynomial
division. This is tied to current source constants, not to a frozen experiment:
future coefficient/modulus changes cannot silently invalidate the shortcut.
Other checks derive small counts from domino placements, compare unreduced
polynomial powers around period boundaries, preserve negative-index behavior,
and check aliased squaring without input mutation. All three engine configurations
execute the full 10000-digit default and assert answer 96972774.

Final production measurements, medians of three fresh processes per case in
rotating sequential order; all inputs are the full default:

| Case | Mac ms | Intel ms | Mac peak MiB | Intel peak MiB |
| --- | ---: | ---: | ---: | ---: |
| Original, compiled | 6041.4 | 15851.5 | 420.2 | 513.7 |
| Production, compiled | **186.9** | **497.3** | **186.1** | **175.9** |
| Production, reference | **387.6** | **1143.7** | **197.6** | **182.9** |

The compiled workload improves about 32x on both hosts, with lower peak memory.
These are separate delivery measurements; historical research medians below
are retained with their original samples. Other machine work was not stopped,
and peak-RSS variation in old runs remains in the raw records. Parsing, analysis,
compilation and execution are included; imports and interpreter construction
are excluded. RSS is peak total process memory.

Validation:

- 229 focused tests passed on each host: 16 Euler tests plus the existing
  convolution and modular-fold suites.
- The actual production source passed 99 recurrence comparisons and 12
  product checks per host across reference, compiled and exact-loop modes.
- The Rank fixture adds one small period-boundary test without repeating
  the full default inside the fixture.
- The full main was removed from demo-execution-exclusions.json, with an
  eligibility regression assertion. Both main and fixture passed scoped
  inferred-type and differential audits: four audit tests.
- Build, semantic-boundary checks and application-form checks passed.
- No exhaustive audit or timeout increase was used. The generic compiler
  ownership optimization remains separate and was not implemented here.

Delivery reproduction and raw records:

```sh
node benchmarks/experiments/euler324-delivery-series.mjs
node benchmarks/experiments/euler324-verify.mjs production
```

`baselines/2026-11-02-euler324-delivery-{mac,intel,verification}.json`.

## Source-style follow-up

The [current demo](../demos/euler/324_tower.ra) initializes A0 and C with one
`array shape K` block each, replacing repeated concat assignments. The new C
constructor already supplies a materialized array, so its extra copy is removed.
The period comment now starts with its purpose, x^Period = 1, before the factor
and certificate details. Every demo/fixture line remains within 40 columns.
Algorithm, coefficient values, final result copy and audit eligibility are
unchanged.

The existing 16 Euler tests passed on both hosts, and four scoped main/fixture
type/differential audits passed. The tests read the actual table values, certify
the period and execute the full default in all three configurations.

Seven fresh-process alternating compiled medians before/after the style change:

| Host | Time before | Time after | Peak MiB before | Peak MiB after |
| --- | ---: | ---: | ---: | ---: |
| Mac M5 | 188.3 ms | 181.4 ms | 186.3 | 183.9 |
| Intel | 498.2 ms | 478.2 ms | 171.8 | 171.5 |

Reference medians from three samples stayed near 411/407 ms on Mac and
1121/1123 ms on Intel, with slightly lower peak RSS. An initial short Mac
series had large outliers and suggested a slowdown; the seven-sample follow-up
did not reproduce it. Diagnostics reported the same execution paths and work
counters. These checks establish no observed regression; the small timing
changes are not presented as another algorithmic speedup. All full runs returned
96972774. Raw samples, runner and verification are in
`baselines/2026-11-02-euler324-style.json`.

## Finding

The [problem statement](https://projecteuler.net/problem=324) asks for the
number of domino tilings of a 3x3x10^10000 tower modulo 100000007. The demo
uses a fixed degree-23 recurrence for even heights; Exp is half the height.
It already uses binary polynomial powering, so it does not enumerate towers.
However, a 10000-digit exponent still has about 33219 bits, requiring tens of
thousands of degree-23 polynomial products.

The largest improvement is exact algebraic exponent reduction for this fixed
recurrence. A 240-bit period is sufficient for every state of the recurrence,
not only for the sample answers or one choice of initial values. Reducing Exp
modulo that period removes most of the work. Using the existing `convolve`
operation also replaces the explicit product loop with an array operation and
improves reference execution after the exponent reduction.

## Exact period certificate

Let q=100000007 and

```
F(x) = x^23 - C[0]*x^22 - ... - C[22].
```

q is prime. F is not squarefree: its squarefree part has degree 19, with
irreducible factor degrees 1, 2, 3, 3, 5, 5; gcd(F,F') has degree 4. For the
squarefree part, nonzero roots have orders dividing q^d-1. Therefore

```
R = lcm(q-1, q^2-1, q^3-1, q^5-1)
  = (q^2-1)*(q^3-1)*(q^5-1)/(q-1)^2
L = q*R
```

is a period for x modulo F. The extra factor q is important: it covers the
repeated factors because their multiplicities are at most 23 < q, and in
characteristic q, (x^R-1)^q = x^(qR)-1.

The independent Python script `experiments/euler324-period.py` performs exact
finite-field gcd/distinct-degree factorization, checks the expression for L,
and verifies `x^L mod F == 1` directly. It does not select L by comparing the
Euler answer. A second implementation in JS independently verifies the same
polynomial identity. Its decimal value is

```
1000000650000187800031655003430420247856611939800369774636680613053644752
```

The Rank candidate computes L from Mod, then applies `N = N mod Period` after
the original small-index check. No answer table or enormous power table is
added. This certificate depends on the fixed Mod and C from the demo; it is
not a generic compiler transformation for arbitrary recurrences. Changing those
constants would require revalidating the certificate.

## Candidate code

[Complete reviewable candidate](experiments/euler324-period-convolve.ra).
The period is computed with four short assignments:

```rank
Period = Mod * (Mod ** 2 - 1)
Period *= (Mod ** 3 - 1)
Period *= (Mod ** 5 - 1)
Period //= (Mod - 1) ** 2
```

The first nested product loop becomes:

```rank
P = (A convolve B) mod Mod
```

The existing modular convolution fusion performs exact residue arithmetic;
there is no floating FFT approximation. The reduction loop and final take/copy
remain. Convolution produces different representatives for some coefficients
than the old unreduced sums, but the resulting polynomial is identical modulo
Mod. Every use by recurrence already operates in that modular ring.

## Repeated measurements

Three fresh processes per case, rotating order, sequential per host. Timing
includes parse, analysis, compilation and execution, excluding imports and
interpreter construction. Memory is peak total process RSS. Other machine
work was not stopped; all samples, including variation, are retained. CPU
profiling and diagnostics used separate runs. Every full sample returned
`96972774`.

Full default input (10000-digit exponent):

| Variant | Mac compiled ms | Intel compiled ms | Mac peak MiB | Intel peak MiB |
| --- | ---: | ---: | ---: | ---: |
| Original | 6904.4 | 16148.7 | 439.0 | 428.4 |
| Period reduction | 187.7 | 497.6 | 184.1 | 179.6 |
| Period + convolve | **187.2** | **500.7** | **186.1** | **172.7** |

The combined candidate is about 36.9x / 32.3x faster and uses about 253 /
256 MiB less peak memory. Small differences between the two reduced compiled
variants are not evidence that convolve itself improves compiled speed.

Full candidate reference execution:

| Variant | Mac reference ms | Intel reference ms | Mac peak MiB | Intel peak MiB |
| --- | ---: | ---: | ---: | ---: |
| Period reduction | 653.6 | 2098.5 | 206.0 | 191.2 |
| Period + convolve | **386.6** | **1155.7** | **196.6** | **181.3** |

The full candidate becomes practical in both engines. The original full
reference was not measured. Its separate reduced 100-digit reference controls
were 765.8 ms / 2402.3 ms and 260.0 / 251.5 MiB; these are a different input
and must not be presented as a full-input speedup ratio.

To isolate library convolution without exponent reduction, at 1000 digits:

| Variant | Mac compiled ms | Intel compiled ms | Mac peak MiB | Intel peak MiB |
| --- | ---: | ---: | ---: | ---: |
| Original | 661.3 | 1895.8 | 270.0 | 261.9 |
| Convolve only | 637.2 | 1916.0 | 270.9 | 259.6 |

Convolve alone is not a consistent compiled performance win here. It is useful
for compact code and for accelerating the reference path of the reduced problem.

## Compiler findings

The original N loop compiles, and combine can use the direct scalar-function
kernel with array parameters. This is not a wholly interpreted workload.
Nevertheless, recurrence's whole-function scalar proof first rejects `N odd`.
Replacing it with `N mod 2 equal 1` exposes another rejection, `A combine B`.
Removing the parity spelling alone does not produce a whole-function kernel.

The exact scalar-function kernel performs ownership/alias protection on each
array store, including the fresh local P in combine. In a separate 1000-digit
CPU profile, approximate self times included 198 ms in generated code, 77 ms
in arrayForWrite, 42 ms in isSharedArray, 18 ms in sharesNumericSlices, plus
27 ms in scalar selection reads and 19 ms in readPosition. The emitter in
`jit/scalar-function-kernel.ts` calls arrayForWrite for every scalar array
assignment. These are general opportunities to reduce storage and dispatch
overhead, independently of the period shortcut.

A useful compiler follow-up is proving that a constructor-owned array remains
unaliased until its final return, then avoiding redundant per-cell ownership
checks and specializing its reads/writes. `localArrayWrites` alone is not a
sufficient escape proof: it identifies constructor destinations, but another
local binding or retained selection can still require snapshots. A fix must
preserve aliases, host storage, error/bounds timing, cancellation and observation.
No unsafe ownership bypass or compiler patch was made in this investigation.

An independent direct JS recurrence, using the full unreduced 33219-bit exponent,
returned the same answer in a single 336 ms control / 62.8 MiB. This is not a
fair JIT benchmark: it excludes Rank parsing/analysis and implements plain
private JS arrays without Rank alias/selection contracts. It demonstrates
remaining implementation cost, not a promise that the compiler can safely
achieve that time by merely removing guards.

## Verification

- Python exact finite-field factorization and polynomial period certificate.
- Independent JS exact polynomial certificate `x^L mod F == 1`.
- Independent 3x3 slice-transfer enumeration using 512 masks checks all 51
  tower values for half-height 0 through 50. This derives small counts from
  domino placements rather than reusing A0 or the recurrence.
- The JS oracle also checks all three statement examples and computes the
  full answer using both reduced and unreduced exponents.
- On each host, five Rank variants (original, period, convolve, combined,
  and parity control) passed 495 recurrence comparisons and 60 polynomial
  product checks across reference, compiled and exact-loop modes.
- Inputs include 0..24, 50, 500, 500000, 2^53+1, L-1, L, L+1 and 2L+29.
  Expected recurrence values use independent direct polynomial exponentiation
  without period reduction. Product comparisons normalize modulo Mod because
  the native convolution changes coefficient representatives.

The research phase changed no production test, timeout, exclusion or issue.
The final delivery changes are listed above; no exhaustive audits were run.

## Research recommendation before delivery

Apply period reduction plus convolve, with focused tests for the polynomial
certificate, period boundaries and all statement/full-size answers. Once the
actual production source passes the scoped type/differential corpus checks,
restore the full default to normal audits: both engines now finish quickly.
Keep the certificate tied to the actual C/Mod constants so future edits cannot
silently invalidate the period. Treat fresh-array ownership specialization as
a separate generic compiler optimization with its own correctness/performance
checks; it is not needed to obtain the demonstrated reduction in time and memory.

## Reproduce

After building the runtime:

```sh
node benchmarks/experiments/euler324-series.mjs
python3 benchmarks/experiments/euler324-period.py
node benchmarks/experiments/euler324-oracle.mjs
node benchmarks/experiments/euler324-verify.mjs
node benchmarks/euler324-investigation.mjs compiled 10000 period-convolve
node benchmarks/euler324-investigation.mjs reference 10000 period-convolve
```

RANK_ROOT selects a built runtime; source variants remain beside the scripts.
The source is frozen at the revision above. Raw records and verification are
in `baselines/2026-11-02-euler324-{mac,intel,verification}.json`.
