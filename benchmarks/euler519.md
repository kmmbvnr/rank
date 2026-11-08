# Euler 519: polynomial inversion instead of block matrices

The full result remains **804739330** for `N=20000`. The statement values
**T(4)=48**, **T(10)=17760**, and the existing **T(1234)=881371376** fixture
remain unchanged. The main demo is back in differential execution.

## Diagnosis and algorithm

The old program builds two q-series, forms the numerator and denominator of the
fountain generating function, and solves the coefficient recurrence by blocks
of 500 using matrix products. It allocates large Toeplitz-related matrices and
splits coefficients into 15-bit halves to keep floating-point dot products
exact. Its historical issue entry says about 23 seconds. Earlier runtime work
has already reduced that: initial observations on the current frozen baseline
are 1.95 seconds on Mac and 4.68 seconds on Intel. The matrices still cost a lot
of memory; the initial Mac process peaks at about 1.61 GiB.

The q-series formula is unchanged. If their numerator/denominator are `Upper`
and `Lower`, set `P=2*Upper-Lower`, `Q=Lower-2*x*P`. The required generating
function is `3*x*P/Q`. Only coefficients through degree N are needed; the old
extra padded block is unnecessary. Updates whose initial exponent exceeds N
are skipped explicitly. Division by `1-x^Step` is a modular prefix down the
rows of a padded reshape.

The block matrices, half splitting, within-block solve and growing block result
are replaced by Newton doubling:

```
Inverse <- Inverse * (2 - Q * Inverse)
```

Each step truncates to at most twice the current length. The constant term of Q
is 1, so the iteration works over the composite modulus 1000000000: no inverse
of a nonunit coefficient is required. Existing exact modular `convolve` supplies
the products and avoids large integer dot products. A final convolution with
`x*P` gives the requested coefficient. There is no new convolution library,
native extension or floating-point approximation in this rewrite.

The Rank program has one explicit loop, for the q-series. A small ordinary
helper and bounded `repeat` perform Newton doubling. Names describe the series,
shifts and dimensions; every Rank line fits 40 columns.

## General compiler coverage

The new source initially refused Number compilation at `Flat take Length`.
Number regions now lower `take` and `drop` over completed numeric/boolean
arrays, including multiple dimensions. Counts are nonnegative integers, clamp
to the leading dimension, and preserve all trailing dimensions. Source and
count evaluation retain their order; only selected prefix/tail cells are copied
into private storage. A later write cannot change a retained earlier result.
This is private completion, not a new zero-copy slicing implementation.

Unsupported or wide counts and arithmetic retain ordinary/exact replay. Bare
sequence ranges are not silently treated as broadcast arrays. Named-column/table/order metadata keeps its ordinary evaluation contract. Observable demand
budgets keep the ordinary path before private preparation, and cached regions
recheck that budget on entry. Existing cancellation/polling remains in the
vector traversal. Tests cover empty dimensions, boolean and real data, signed
zero, wide integer storage, aliasing, suppressed reads, invalid counts, source
errors and a warmed ordinary Rank function under a budget.

At N=1234 the q-series enters one Number loop and computes zero reference cells.
The convolution rewrite supplies the main overall improvement. A single Mac
control runs the final source on the old runtime in **0.560 s / 237.7 MiB**;
final compiled samples are about **0.468 s / 207.6 MiB**. These single controls
do not establish a universal compiler speed ratio. Native reference execution
of the final algorithm is also fast.

## Measurements

Node 24.15.0, Apple M5 and Intel i7-10750H. Runtime/source baseline is frozen at
`05147758`; the original source is retained in `benchmarks/fixtures`.
Three alternating old/new compiled pairs per host use fresh processes with
diagnostics disabled. Table values are medians; memory is whole-process peak
RSS, including parser/runtime startup and V8's GC policy.

| Host | Old compiled | New compiled | Old peak RSS | New peak RSS |
| --- | ---: | ---: | ---: | ---: |
| Apple M5 | 2.747 s | 0.468 s | 1477.1 MiB | 207.6 MiB |
| Intel i7 | 4.686 s | 0.898 s | 578.0 MiB | 198.3 MiB |

Mac old samples are noisy: **1.894–3.406 s**, with **1029–1503 MiB** peak RSS;
new samples are **0.463–0.516 s**, **207–210 MiB**. Initial old observations were
faster than that final median. Treat this as a measured range, not a stable
sixfold speed guarantee. Intel old/new ranges are **4.649–4.881 s** /
**0.873–0.920 s**, with **527–584 MiB** / **195–198 MiB** RSS. Intel load averages
before the pairs were 0.15/0.21/0.15, 0.43/0.27/0.17 and 0.47/0.29/0.18. Our
other tests/benchmarks did not run on a measured host concurrently.

Single reference observations (not medians):

| Host | Old reference | New reference | Old peak RSS | New peak RSS |
| --- | ---: | ---: | ---: | ---: |
| Apple M5 | 1.871 s | 0.469 s | 1254.9 MiB | 238.2 MiB |
| Intel i7 | 4.539 s | 0.933 s | 589.0 MiB | 227.0 MiB |

The raw observations, source hashes and diagnostic snapshot are retained in the
baseline JSON. CPU/GC differences do not support extrapolating one host's
absolute peak RSS or speed ratio to another architecture.

## Verification

- **64 new tests pass on both hosts**: 56 for count slices and 8 for the demo.
- An independent oracle enumerates supported coin positions and proper colourings
  directly through 12 coins. Two touching supporting coins force the third
  colour above them; adjacent upper coins are checked separately. It reproduces
  the small values from the [official problem](https://projecteuler.net/problem=519)
  without using a generating function, convolution or matrix solve.
- An independent scalar partition update and quadratic BigInt quotient recurrence
  checks coefficients through 1234. The program is checked at 29 limits in each
  of default, reference and Number-loop-disabled modes, including zero,
  power-of-two boundaries and the non-power-of-two Newton truncations.
- The original statement fixture passes in all three modes. Every timed full run
  retains the original default answer 804739330.
- Broader numerical, vector, slice, convolution, linalg and callback tests have
  **464 passes and one failure out of 465 on each host**. The failure is the old
  counter expectation `private integer row-slice writes > fuses a discarded
  slice transform with mod`: it expects one Number entry and gets zero. The
  same failure reproduces on clean baseline `05147758` (71 passes / 1 failure in
  that file). Its value/error comparisons pass. This change does not claim to
  repair that preexisting counter expectation.
- The full main demo and its fixture pass scoped differential execution on both
  hosts: 2 completed, 1 test block, 4 Number loop entries. No full differential
  corpus, exhaustive type/name audit or full repository suite was started.
- Interpreter source/test TypeScript builds and whitespace checks pass.

## Reproduction

```
node benchmarks/euler519.mjs compiled
node benchmarks/euler519.mjs reference
node benchmarks/euler519.mjs compiled 1234
```

The optional final argument selects the retained original source. Use
`RANK519_RUNTIME` to select a frozen runtime and `RANK519_EXPECTED=804739330`
for a full-answer check. `RANK519_DIAGNOSTICS=1` and `RANK519_PROFILE=/tmp/euler519.cpuprofile`
enable separate diagnostic/profile observations; leave both off for timings.
