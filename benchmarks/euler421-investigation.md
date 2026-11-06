Historical research at `5e4a0cb1`. Delivered changes and final measurements are in [the follow-up](euler421-followup.md).

# Euler 421 investigation

Research base `5e4a0cb1`, Node 24.15.0, 2026-11-06. The next unfinished row
in #447 is `421_primefactors.ra`. Production sources, exclusion policy and
GitHub are unchanged. Alternative programs and patched built runtimes below
are experiments, not a delivered compiler change.

## Diagnosis

The number-theoretic reduction is sound: for each prime p, the solutions of
x^15=-1 modulo p are negatives of the d-th roots of unity, where
`d=gcd(15,p-1)` is 1,3,5 or 15. Count the occurrences of each residue up to N
and weight by p. Enumerating n up to 10^11 is unnecessary.

The current program implements modular exponentiation manually over whole
arrays. Its repeated products, masks and array rebinding cause substantial
work and allocation. Existing `powmod` already broadcasts over base, exponent
and modulus arrays, including exact modular products above Number's ordinary
safe-product limit. Replacing `vpow` calls with the library operation is a
small, independently useful source improvement.

The original full run took 40.684 s / 1241.6 MiB on Mac and 100.119 s /
907 MiB on Intel. These are single observations; the issue's old 57-second
number is not a controlled baseline for current machines.

## Source experiments

All full runs below use N=10^11 and M=10^8, and return
**2304215802083466198**.

- `builtin`: remove the custom array exponentiation helper and use `powmod`.
- `order`: additionally omit the redundant d-th-power check. A nonzero
  candidate a^((p-1)/d) already has order dividing d. It must still have exact
  order d: reject 1 for d=3/5; reject cube/fifth power 1 for d=15. Removing
  this check did not establish a speed improvement in the exploratory runs.
- `scalar`: find the root and count residues per prime in compiled private
  scalar helpers. Stream primes instead of retaining large intermediate
  arrays. Each function has one loop, and no loops are nested in Rank source.
  The search ends when a root is found; it has no arbitrary base-200 cap.
- `ranked`: the same scalar calculation lifted with declared `rank 0 0` and
  followed by sum, with no top-level source loop. This is materially slower
  than the compiled loop despite matching answers.
- `batched`: keep bulk array roots but process groups of 32768 primes. It
  reduces the exploratory Mac peak to 549 MiB, but still takes 12.219 s.
- `periodic`: split N into complete periods and a tail before counting roots,
  replacing the division per root with a comparison. A scout run took
  4.294 s / 181 MiB, without establishing a gain over the scalar control.

Three alternating fresh-process samples, diagnostics enabled, uncontrolled
host load (especially noisy on Mac):

| Compiled full input | Mac median | Mac peak RSS range | Intel median | Intel peak RSS range |
| --- | ---: | ---: | ---: | ---: |
| Library powmod | 16.360 s | 1066–1272 MiB | 31.552 s | 787–866 MiB |
| Private per-prime loop | 5.648 s | 181–186 MiB | 9.729 s | 167–169 MiB |
| Array rank 0 form | 12.515 s | 578–589 MiB | 28.406 s | 561–562 MiB |

The earlier scalar scout was 3.513 s / 181 MiB on Mac. Use the repeated
samples for decisions; do not present that best scout as the delivered median.
The original/library/scalar/ranked controls were also measured in three
alternating samples at M=10^6; those records are in the raw results.

Reference execution is a real tradeoff: at M=10^6, single probes were
original 0.661 s / 360 MiB, library 0.331 s / 231 MiB, scalar 1.957 s /
455 MiB, batched arrays 0.346 s / 212 MiB. The full library reference scout
was 15.444 s / 1174 MiB. A scalar rewrite alone therefore improves compiled
execution while worsening the uncompiled engine at the measured small bound.

## General compiler gaps and isolated prototypes

### Array max in a loop condition

In `for E max greater 0`, scalar-extrema inference registers E as an integer
before proving that it is an array. Entry correctly rejects the resulting
plan (`number-loop:binding-contract`); no wrong result is published. An
instrumented entry shows rejected binding `E: integer`, while its actual
binding contract is a rank-one array. This happens hundreds of times in the
manual exponentiation helper.

A separate built-runtime prototype lowers integer-array min/max before
scalar-extrema inference. On the unchanged original program it removes those
rejections and runs the full Mac input in 23.332 s / 1104 MiB. The source
control replacing `E max` with `E sum` (valid for nonnegative exponents) also
unlocks its Number loops: 24.726 s / 1179 MiB. Both remain worse than native
powmod. The general min/max capability is still worth implementing rather
than teaching users to change their reduction to satisfy the compiler.

### Number functions with gcd and linked helpers

The scalar Number kernel does not lower gcd, even though the Number loop
compiler does. Also, the ordinary non-leaf scalar-call path runs the exact
kernel; its existing raw Number entry is mainly available through compiled
callers. Thus the explicit loop can keep `root_sum` in a Number region while
the equivalent ranked call repeatedly executes exact scalar work.

Separate experimental built runtimes add integer gcd lowering, allow a
conservatively guarded Number attempt for integer non-leaf calls, and combine
both. The combined ranked program still has its array form; its full-answer
checks pass. Separate three-sample medians were 10.601 s / 543–545 MiB on Mac and
27.236 s / 564 MiB on Intel, versus 12.515 / 28.406 s for the earlier
ranked batch. The Intel difference is only about 4% and these batches were
not interleaved; it is not convincing evidence of a large speedup. Both
capabilities work, but they do not by themselves solve ranked execution.
This does **not** eliminate the whole gap to the compiled prime loop:
ranked result traversal, argument/return contracts, binding checks and
boxing/conversion remain. A prepared typed ranked consumer is a further
opportunity, not an implemented or guaranteed speedup.

The prototype scripts patch copies of the compiled JS under `/tmp`. They do
not change interpreter TypeScript. They are not production-ready: observable
execution, depth/errors, overflow backoff, dependency changes and broader
return kinds need dedicated regression tests before shipping a general ABI.

## JS control

A direct JS control uses the same Rank segmented prime iterator and modular
power helper, with the same mathematical per-prime algorithm. Single probes
were 3.036 s / 89.6 MiB on Mac and 4.598 s / 88 MiB on Intel. It saw
5,761,455 primes, and the largest first successful base was 41. This validates
the existing base-200 cap for this particular full input, not for arbitrary
bounds. The control excludes language parsing, contracts and execution frames.
In three further alternating Mac control pairs, medians were JS 2.225 s
and Rank's scalar loop 4.020 s (about 1.81x), peaks 89–91 versus 179–181 MiB.
The first scouts therefore understated the gap to JS. Samples and host-load
variation are retained in the result JSON.

## Verification and next implementation

An independent oracle directly enumerates positive x and tests exact
`x^15+1` divisibility, including primes 2,3,5 and empty/small prime bounds.
Eight source variants × two engines × 14 cases give 224 checks. A second
oracle enumerates all roots modulo primes through 31 and counts exact periods
for N=2^53-1, 2^53+1 and 10^30: 48 checks. The combined compiler prototype
passes the same checks. Full answers are checked separately on both hosts.
No exhaustive audit or full workspace test suite was run.

Recommended implementation order:

1. Replace manual `vpow` with the existing library operation.
2. Make the ranked per-prime consumer use a prepared numerical entry like
   the compiled loop, preserving source/result snapshots, live dependencies,
   call-depth and error contracts. Repeated capture-domain discovery and
   per-cell entry/return work need investigation here. Measure rather than
   assume that merely admitting Number arithmetic solves the gap.
3. Close the general array min/max and scalar Number gcd/non-leaf entry gaps,
   with demand/alias/error/overflow/interrupt tests. The current combined
   prototype is only partial, and its Intel speed gain is small.
4. Choose the final array-oriented source after comparing reference behavior
   as well as compiled performance. Do not silently trade the reference
   regression for a fast compiled-only result.

Reproduction scripts and original sources are under `experiments/euler421-*`.
The prototype patch scripts take an isolated built `out` directory. Set
`RANK421_RUNTIME=file:///absolute/path/out/index.js` to run against that copy.
Raw measurements and verification records are retained in
[the result JSON](baselines/2026-11-06-euler421-investigation.json).
