# Euler 373/378 and shared runtime costs

2026-11-02. Follow-up to `euler372-investigation.md` and issue #447.
Both hosts use Node 24.15.0. Mac arm64 and Intel i7 measurements are separate.
Times include parsing, analysis, compilation and execution. RSS is process
high-water memory, not live Rank storage. Raw observations and source hashes
are in `baselines/2026-11-02-euler-neighbours-runtime.json`.

## Shared causes and changes

These workloads expose several boundaries, rather than one universal slow
operation:

* Integer `abs` lacked a scalar native signature. Support multiple signatures
  while preserving real `abs`, module/name guards and exact fallback. This
  repairs the rejection chain identified in Euler 372.
* Proven scalar functions can return integer queues, sets and indexes and
  pass them through linked scalar helpers. The whole-loop compiler still
  rejects container-valued results that it cannot represent.
* Native integer-group iteration avoids allocating a Rank sequence plan for
  every group read. Captured endpoints preserve the existing finite snapshot.
  Generic sequence pipelines retain their normal sequence representation.
* Read-only Int32/Int64 arguments to scalar Number kernels borrow trusted
  backing buffers instead of converting the whole array on every call.
  Every loaded integer is checked; an unsafe load replays exact execution.
  Writes, observable headers and unsupported aliases retain fallback.
* Repeated overflowing scalar calls back off Number probes, up to 255 skipped
  calls, and periodically retry. Exact execution continues during backoff.
  Tail transfers also use eligible leaf kernels without increasing Rank depth.
* Native Fenwick reads and writes compile into exact regions. Number regions
  reject these external mutations, which must never be replayed. Receiver,
  prototype, module, readonly and index checks remain in force.
* Fenwick storage uses Float64 cells only while every stored integer is safe.
  It promotes to bigint storage before an unsafe update. A prefix whose sum
  exceeds the safe range is recomputed exactly. This is an exact representation
  optimization, not floating-point approximation.
* Small integer sorting and stable argsort use Int32 storage; larger values
  widen or retain the generic path. Return-signature memoization retains scalar
  type tags rather than scalar values, while preserving array revision checks.

The linked-container paths improve the unchanged old Euler 373 at Limit=10000
on Intel from 5.270 s / 448.9 MiB to 0.842 s / 254 MiB (single controls).
Algorithmic improvement below is separate from that compiler improvement.

## Controls

`euler-runtime-arrays.mjs` performs twenty weighted reductions of one million
Int32 cells. Three fresh processes per variant, medians:

| Host | Copies (`CONTROL=borrow`) | Borrowed reads | RSS, copies / borrowed |
| --- | ---: | ---: | ---: |
| Mac | 367 ms | 73 ms | 176 / 147 MiB |
| Intel | 800 ms | 191 ms | 162 / 133 MiB |

Euler 378, Limit=1000000, identical Rank source and exact answer
17911338911265382. Single process-local controls:

| Host | Interpreted Fenwick pass | Compiled, boxed storage | Compiled, compact storage |
| --- | ---: | ---: | ---: |
| Mac | 11.862 s | 0.926 s | 0.677 s |
| Intel | 40.630 s | 2.212 s | 1.661 s |

Mac RSS is respectively 468.5 / 185.7 / 183.4 MiB. The large memory gain comes
from compiling the pass; compact Fenwick storage is a smaller separate gain.
The full 60-million-entry compiled run returns **147534623725724718**.
A final full Mac observation took 50.483 s / 687.2 MiB, with other workspace
activity. Earlier overlapping measurements vary substantially; no full-input
isolated speedup ratio is claimed. Its reference execution remains excluded
from whole-corpus audits, with a small reference fixture and a full compiled
golden test. It is improved, but still a large sieve workload.

Loader controls in `euler-neighbours-runtime.mjs` disable individual changes
inside one process. The boxed Fenwick control is retained verbatim. These are
benchmark controls, not runtime options.

## Euler 373: exact multiplicative counting

The delivered source replaces side-pair enumeration and radius-indexed tables
with a multiplicative divisor sum. For radius r, consider only prime exponents
e at primes congruent to 1 modulo 4. Define

```
F = product(3e(e+1)+1)
M = product(2e+1)
H = product(2 floor(e/2)+1)
T(r) = (2F - 3M + 3H - 2) / 6
```

Rational unit-circle phases are units times independent Gaussian-prime ratios,
with exponents in [-e,e]. At one prime, the number of ordered triples of
exponents summing to zero is 3e(e+1)+1. Counting positive-angle phase triples
with product -1 gives 2F-3M+1: all three nonzero vectors contribute
2(F-3M+2), exactly one zero vector contributes 3(M-1), and all zero contributes
nothing. A transposition fixes H-1 isosceles triples. Integer-sided equilateral
triangles cannot have integer circumradius. Burnside's lemma therefore gives
the stated unordered count T(r).

Write T = 1 * W as a divisor convolution. Nonzero W(d) have only prime factors
congruent to 1 modulo 4. For d>1 with those exponents,

```
W(d) = product(6e)/3 - 2^omega(d)/2
```

Omit the subtraction when all exponents are even; W(1)=0. Consequently

```
sum(r T(r), r=1..N)
  = sum(d W(d) Q(Q+1)/2, Q=floor(N/d)).
```

The recursive Rank implementation enumerates each such d once, in increasing
prime order. It uses exact integers throughout. No answer or precomputed table
is embedded. Full answer: **727227472448913**.

The final formula prototype took 0.327 s / 283.1 MiB on Mac and a median of
0.815 s / 254.9 MiB over three Intel processes. The final delivered runtime
and source returned the same answer in 0.846 s on Intel. Full Mac reference
execution took 11.245 s / 460.2 MiB. The original full program exceeded a
35-second exploratory deadline, so there is no completed full original median.
An intermediate cached geometric algorithm took about 15.6 s and 712 MiB;
it is retained as an experiment, not used in production.

Verification includes exhaustive integer side triples through radius 120,
all 10000 individual radii against the old exact geometric algorithm, fixture
1200, and full golden answers. Unit tests independently enumerate side triples
through 80 in compiled, exact-loop and reference modes. Both scoped corpus
audits pass for the delivered 373 and small 378 fixture. Euler 373 is restored
to default corpus execution.

## Validation and remaining work

The final focused runtime suite passes 286 tests in 12 files; an earlier
delivery suite passes 261 tests including the full Euler 378 assertion.
Six scoped type/differential corpus cases pass. Language profile and semantic
boundary checks also pass. No exhaustive corpus audit was started.

One ordinary interpreter run passed 11070 tests and failed 12. Two assertions
described previous compiler counters and were updated and rechecked. The
remaining failures concern concurrently changed Euler 337, a manual rope
example, tower-loop counters, gather-fusion counters and four live-slice return
cases. The tower, gather and slice behavior was reproduced in the saved
pre-change runtime. Thus focused validation passes; the broad run is not green.

Euler 379 exposes a separate copy-admission cliff above 262144 destination
cells: disabling the cap in an experimental loader produces the full exact
answer 132314136838185 in 7.450 s, whereas the capped full run was stopped.
Raising the cap indiscriminately can regress short loops. A proposed proof of
nested work did not pass admission tests and is excluded from this delivery.
`PROBE_CAP=unbounded` is only an experiment. Production copy policy is unchanged.
Euler 370/379/386/388 are not marked complete by these measurements.
