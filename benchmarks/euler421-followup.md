# Euler 421: bounded array work and numerical function coverage

The default N=10^11, M=10^8 still returns **2304215802083466198**. The demo
uses library `powmod`, processes 32768 primes at a time and finds roots
without the arbitrary base-200 cutoff. Each function has one loop; no Rank
loops are nested. Names and lines follow the repository's Rank style.

## Why this source

The per-prime scalar control is faster when compiled, but slower without the
compiler. The final program keeps bulk array operations in small groups. It
improves both measured engines and substantially reduces peak memory. The
root search writes into preallocated result slots instead of growing two
concatenations; d=3/5 only need a nontrivial root, while d=15 also tests its
cube and fifth power. Complete residue periods are counted mathematically.

Three fresh-process samples of the final full program, Node 24.15.0,
diagnostics enabled, uncontrolled host load:

| Host | Original full, single observation | Final compiled median | Original RSS | Final RSS range |
| --- | ---: | ---: | ---: | ---: |
| Mac | 40.684 s | 13.699 s | 1241.6 MiB | 536–552 MiB |
| Intel | 100.119 s | 33.397 s | 907 MiB | 557–560 MiB |

The original full observations predate the final batch; these are not three
interleaved full before/after pairs. At M=10^6, three alternating original /
final pairs provide the more controlled comparison:

| Host / mode | Original median | Final median |
| --- | ---: | ---: |
| Mac compiled | 0.716 s | 0.355 s |
| Mac reference | 0.613 s | 0.263 s |
| Intel compiled | 1.851 s | 0.978 s |
| Intel reference | 1.745 s | 0.739 s |

Full reference single probes return the same answer: 8.740 s / 588.9 MiB
on Mac and 18.088 s / 546.9 MiB on Intel. No original full reference timing
was recorded; do not infer its improvement from compiled measurements.

## General compiler changes

- Recognize native integer-array min/max before scalar-extrema inference.
  In particular, `for E max greater 0` no longer registers an array E as an
  integer slot and then repeatedly rejects its binding contract. Empty or
  unsafe inputs retain native errors/exact replay; observable extrema stay
  on the existing path.
- Add integer gcd to scalar Number kernels, using the shared exact-safe
  Euclidean implementation and guarded demand behavior.
- Ordinary private non-leaf integer functions can attempt their existing
  Number kernel, with exact replay and bounded retry after overflow.
- Prepare a private integer ranked traversal once instead of rediscovering
  captured domains and return specializations for every cell. This applies
  to completed scalar dyadic operands; scalar captures, memo/generator,
  inspection and observable execution retain their ordinary boundaries.
  Dependency/native-binding guards and depth/return checks remain live.
- Reuse linked helper wrappers while their function identity, private-entry
  policy and live callee guards remain valid. This removes repeated wrapper
  allocation without treating a previously valid helper as permanently valid.

These changes are general capabilities, not a recognition of Euler 421.
The unchanged exploratory ranked program's full Mac scout falls from
15.663 to 8.123 s, with similar peak memory. These are separate single
observations, not a controlled median comparison; ranked execution still
has substantial overhead versus the streamed compiled scalar control.
The final demo deliberately uses the array batching compromise above.

## Verification

431 targeted tests passed on Mac and 131 on Intel, plus four scoped type/
differential audit cases (the default and its fixture). After rebasing onto
the concurrent integer-reader/wide-sum repairs, 299 integration cases passed
(including two additional hook/cache-policy cases). The suite covers
gcd/signs, nested helpers, ranked snapshots,
unused deferred cells/errors, wide replay, existing compiled budget outcomes,
observable min/max, shapes, ordinary function/vector kernels, and the new
demo. Direct residue enumeration verifies small primes including 2,3,5,
empty bounds, published checkpoints and N around 2^53 and at 10^30.
Full golden answers are verified on Mac and Intel.

A pre-existing `scalar-plans.test.ts` assertion also failed on the frozen
baseline: it required a scalar-expression hook even though native deferred
plan stages can execute without that backend. The test now verifies the
result and absence of premature execution without requiring that particular
optimization path. It retains the disabled-compiler hook assertion.

The default is restored to type/differential audits; the stale 57-second
exclusion is removed. Exhaustive audits and the full workspace suite were
not run. Final selected test/audit counts and integration checks are recorded
in the raw results and the issue comment.

Raw measurements: [follow-up JSON](baselines/2026-11-06-euler421-followup.json).
The [historical investigation](euler421-investigation.md) retains alternative
algorithms, JS controls and the rejected/partial compiler prototypes.

## Reproduction

After building, preserve a separate baseline runtime at `5e4a0cb1`:

```sh
RANK421_BASELINE=file:///absolute/baseline/packages/interpreter/out/index.js \
  node benchmarks/experiments/euler421-followup.mjs
node benchmarks/experiments/euler421-followup.mjs --full
node benchmarks/experiments/euler421-run.mjs reference 100000000 \
  demos/euler/421_primefactors.ra
```
