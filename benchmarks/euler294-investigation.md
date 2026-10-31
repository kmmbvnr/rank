# Euler 294 investigation

Baseline: `42c9271bc5942dbf906d42319099a52fd3a74599`.
The production demo now uses the periodic formulation below. The fixture keeps
the full default and both official examples, adding empty-input, period-boundary
and noninvertible-modulus checks. No compiler code or thresholds were changed.
Issue #447's historical timings are not current measurements.

## Delivery

Three additional fresh serial processes per shipping workload gave medians:

| Workload | Compiled | Reference |
| --- | ---: | ---: |
| Full default | 0.142 s | 0.181 s |
| Extended fixture, four test blocks | 0.203 s | 0.672 s |

All full runs return `789184709`; every fixture block passes in both modes.
The independent 202-case verifier now reads the production demo, rather than
the prototype, and passes with seven separate enumeration checks. Scoped
type/differential audits passed four tests; scoped name-facts audits passed two.
Full suites were not run. No Euler 294 execution exclusion needed removal.
Raw delivery samples: [JSON](baselines/2026-10-31-euler294-delivery.json).

## Measurements

Node 24.15.0, macOS arm64. Three fresh processes per case, executed serially,
with variant order reversed in the middle repeat. Interpreter construction and
module startup are excluded; parsing and compilation are included. Host load
was uncontrolled, so these are local comparisons rather than universal timings.

| Full N=3138428376721, Mod=10^9 | Original median | Periodic prototype median | Speedup |
| --- | ---: | ---: | ---: |
| Compiled | 1.549 s | 0.144 s | 10.8x |
| Reference | 12.476 s | 0.180 s | 69.3x |
| Compiled peak RSS | 190.8 MiB | 177.4 MiB | |
| Reference peak RSS | 242.0 MiB | 182.5 MiB | |

Timing ranges: original compiled 1.312–2.033 s, periodic compiled
0.143–0.290 s; original reference 12.046–12.927 s, periodic reference
0.177–0.373 s. Short cases have substantial parse/JIT and host-load noise.
RSS is process maximum, including interpreter infrastructure; it is not a
measurement of DP buffers alone.

Raw data: [samples](baselines/2026-10-31-euler294-samples.json),
[verification](baselines/2026-10-31-euler294-verification.json),
[compiler trace](baselines/2026-10-31-euler294-compiler.json).

## Where the original spends work

The binary block algorithm is logarithmic in N and mathematically correct.
It maintains 24 digit sums times 23 residues. Each block product visits
529 * (1+...+24) = 158700 scalar products, including zero coefficients.
The full input performs 42 squarings plus 21 accumulator products:
9,998,100 products and associated divisions, remainder operations, selections
and stores. Repeated interpreter dispatch explains much of the reference gap.

The main loop already compiles to an exact BigInt loop. Its generated inner
operation multiplies two BigInts and then takes the remainder. Diagnostics show
two compiled loops, one Number loop (the tiny initial table fill), zero mixed
loops, zero Number overflows, zero COW copies and zero selection snapshots.
There is no evidence here of repeated speculative overflow or excess DP copies.

An observation-only loader exposes a Number-lowering rejection at
`Out = Res mod Mod`: `loop:unbound-name:NameExpression`, node `Res`.
This is a fresh region-local array used in an array-valued arithmetic operation;
the exact backend can retain this expression, while the Number lowering cannot.
The enclosing if/for rejections are consequences, not four separate bugs.

There are general compiler opportunities: operations on region-local arrays,
and scalar `(A * B) mod M` fusion. The array expression compiler already has a
modular-product path, and `runtime/modular-power.ts` already has an exact
Number multiplication kernel for normalized residues with modulus <=2^30.
The loop expression backend currently lowers multiplication and remainder
separately. Default residues can produce products near 10^18, so simply
enabling Number for this region is insufficient. Ownership, rebinding, safe
fallback, operand evaluation order and error behavior must also be checked.
No compiler-only speedup is claimed: no such prototype was benchmarked here.

## Smaller algorithm using the 22-position period

[The problem](https://projecteuler.net/problem=294) fixes both the digit sum
and divisor at 23. Powers of 10 run through every nonzero residue modulo 23
once per 22 positions. Split N=22Q+R. A complete block is invariant under
multiplying residues by any nonzero residue. At each digit sum its distribution
has only two coefficients: Z for residue zero, and A for each nonzero residue.
Represent it by total T=Z+22A and difference D=Z-A; both multiply under
block convolution.

At a nontrivial 23rd root of unity z, the one-period generating function is

```
product(w=1..22, (1-x^10 z^(10w))/(1-x z^w))
  = (1-x^230)(1-x)/((1-x^10)(1-x^23)).
```

Only degrees 0..23 matter, so for Q full periods:

```
D(x) = (1-x)^Q / ((1-x^10)^Q (1-x^23)^Q)  modulo x^24.
```

This is the convolution of a length-24 binomial vector
`(-1)^k C(Q,k)` and a sparse vector with coefficients
`B[0]=1, B[10]=Q, B[20]=Q(Q+1)/2, B[23]=Q`.
The ordinary digit DP is needed only for R<=21 trailing digits (R=11 at the
full input). Leading zeros keep the original interpretation intact.

Let Ztail and Ttail be the tail's zero-residue and total polynomials. The
zero-residue coefficient after joining both parts is

```
[x^23] (Twhole*Ttail + D*(23*Ztail-Ttail)) / 23.
```

The first term is simply the digit-sum count over all N positions:

```
All = sum(j=0..2, (-1)^j C(N,j) C(N+22-10j,23-10j)).
```

The second is a dot product with reversed D. All arithmetic is exact BigInt;
divide by 23 before reducing modulo Mod. This avoids assuming that 23 has a
modular inverse and handles Mod=23,46,529 and large moduli. Binomial operations
have a strict domain in Rank: clamp their lower argument and then mask out
terms that conventionally have coefficient zero. Q=0 and N=0 are supported.

This is more specialized mathematically than generic table exponentiation,
but the prototype still expresses the polynomial calculation with ordinary
array operations, binomial, convolve, sum and a bounded tail DP. No lookup
answers or precomputed result tables are involved.

## Verification and reproduction

`euler294-verify.mjs` constructs an independent exact per-digit DP through
N=100. It checks 202 Rank executions (N=0..100 in compiled/reference modes)
with moduli 1,23,46,529,10^9,10^18 distributed over those inputs. It also checks
the oracle by direct enumeration for N=0..6. All passed.
The official N=9 and N=42 exact examples passed separately; full input in both
modes returns 789184709 in every repeated sample. Build of language/interpreter
passed. No exhaustive test suites were started for this demo change.

```
node benchmarks/experiments/euler294-verify.mjs
node benchmarks/experiments/euler294-samples.mjs
node benchmarks/experiments/euler294-delivery.mjs
node benchmarks/experiments/euler294-compiler-trace.mjs
node benchmarks/euler294-investigation.mjs compiled periodic 42 1000000000000000000
```

The trace script writes generated JavaScript to `/tmp/rank294-generated.js`.
The loader changes diagnostic reporting only; it retains backend selection.
The shipping implementation is the periodic formulation. General
compiler support remains a separate candidate requiring its own controlled
experiment and semantic tests; it cannot remove the original algorithm's
roughly ten million products.
