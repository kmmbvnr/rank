# Euler 411 investigation

Historical research snapshot. See [delivered implementation and verification](euler411-followup.md).

Issue: https://github.com/kmmbvnr/rank/issues/447
Problem: https://projecteuler.net/problem=411
Baseline: `c1887c6e`, Node v24.15.0, macOS arm64 and Linux Intel.
Production code and issue status are unchanged: these are research prototypes.

## Findings

The program generates period representatives of `(2^i mod n, 3^i mod n)`,
sorts packed integer keys `x*n+y`, and computes the longest nondecreasing
subsequence of y, skipping repeated stations. For M points this uses
O(M log M + M log S(n)) work and O(M) storage. It is already a sensible
algorithm rather than a quadratic search.

The default processes **49,935,581 points**. Its hot numerical loops already
compile: 238 numeric entries and no overflows. The `order` helper's unsupported
`factors` operation is outside the hot scans and is not the main bottleneck.
The historical issue estimate of 26 s compiled is not the present Mac result.

An instrumented single full run spent 1.744 s generating, 1.486 s sorting and
7.828 s preparing/executing subsequence scans. These are wall-clock intervals
including allocations and boundary costs, not isolated kernel timings.

| k | Points | Path length | Generate / sort / scan, s |
| --- | ---: | ---: | ---: |
| 27 | 9,565,953 | 9,565,938 | 0.296 / 0.301 / 1.773 |
| 29 | 19,803,868 | 8,875 | 0.673 / 0.590 / 3.160 |

## Controlled full runs

Three sequential fresh processes per variant on each host, alternating
baseline and combined candidate. Every answer is **9936352**. All 379
interpreter output JS modules match byte-for-byte between hosts.
Numbers are medians of time and per-process peak RSS, respectively.

| Host | Original | Demo changes + borrow prototype |
| --- | ---: | ---: |
| Mac | 11.210 s / 1639.7 MiB | 7.877 s / 1269.8 MiB |
| Intel | 22.686 s / 832.1 MiB | 15.594 s / 637.9 MiB |

That is **1.42x / 1.45x** faster, with about **23%** lower median peak RSS.
RSS depends on platform and garbage collection; it is not retained payload.
Samples were sequential within each host; unrelated load was not controlled.

The combined candidate contains two source changes:

1. For n=3^m, return the already calculated period. For m>=1, powers of 2
   cover all phi(n) units while y is zero, yielding a horizontal path of
   phi(n) points. Earlier positive-y points have x <= 2^(m-1), and there
   are only m of them: a path using these has at most 2^(m-1)+m points,
   which cannot beat phi(n) for m>=2. Check m=1 separately; n=1 has one
   station. There is no such shortcut here for powers of two.
2. Start the tails array at min(Len,1024) and double it when needed with
   `concat Tails Tails copy`. The existing compiler supports completed
   concatenation and private rebinding. Every new cell is overwritten before
   use; amortized growth follows path length rather than the point count.

Source-only singles: Mac 8.896 s / 1315.5 MiB; Intel 17.747 s / 696.0 MiB.
These are not medians or additive estimates of individual optimizations.

An append shortcut also worked: if y is at least the last tail, append it
without binary search. Its exploratory Mac sample was 9.611 s, but overlapped
another local experiment, so it is not a controlled speedup estimate. It is
not included in the combined candidate above.

## General compiler/runtime opportunity

`number-loop-runtime.ts` permits borrowing packed Int64 inputs for a direct
indexed pass only without nested loops or array destinations. Here `Keys I`
is read once per outer iteration, then a different private array is searched
and updated. The blanket restrictions force a complete Number copy of Keys.
Baseline diagnostics count **49,909,368** converted input cells and about
**998 MB** of cumulative snapshot payload allocation; neither is peak RAM.

The hook prototype relaxes admission for the read-only source, retains
private destination buffers, and checks each actual BigInt load. On unchanged
source a single Mac sample changed 11.069 s / 1648.0 MiB to 9.919 s /
1523.7 MiB. Number read-buffer counters fell to zero. Controlled combined
results above include this relaxation.

Deleting the admission conditions alone is incorrect: writing regions use
an identity `integerCell` helper, so a raw BigInt reaches Number arithmetic
and throws TypeError. The prototype also checks and converts BigInt loads.
Production needs a reusable read-only access/profitability proof and dedicated
cases for aliases, nested reads, overflow replay, errors, binding replacement,
cancellation and budgets. Bounded oracle checks do not prove these contracts.

A narrower hand-written JS implementation of the same period/sort/search
algorithm took **10.196 s / 521.3 MiB** in one sequential Mac sample. It uses
Float64 storage, unchecked arithmetic and a different sorting path, without
Rank's integer, error, alias or cancellation contracts. This does not establish
a large remaining compiler-only time gap; its lower memory use makes
intermediate buffers worth further investigation.

Forcing the existing self-sort assignment path did not enable in-place sorting
here: its counter stayed zero. No ownership checks were removed. That
experiment is not included in the candidate.

## Verification and remaining work

An independent oracle generates all 2n+1 specified stations without period
arithmetic, sorts coordinate pairs and deduplicates them. **312 comparisons**
cover four source variants, both engines and 39 inputs: 1..32, 50, 81, 123,
128, 243, 729 and 10000. The same 312 checks pass with the borrow hook.
All default full runs of retained candidates match 9936352.

A shortcut for both pure powers of two and three was rejected: it produces
**9936351**. Only the proved powers-of-three shortcut remains.

Reference was measured only on bounded defaults: Count=8 took 0.311 s and
Count=13 took 4.222 s, returning 9052 and 50705. No full default reference
timing or exhaustive audit was run; extrapolation is not a measurement.

Next: implement and test general packed read-only input lowering, retain the
two verified demo changes, and reorganize its nested loops into helpers and
array mapping to meet Rank style. Rerun focused tests and both-host benchmarks
before marking Done. Full default reference exclusion remains unchanged.

## Reproduction

From the repository root after building interpreter output:

```sh
node benchmarks/euler411-investigation.mjs compiled
node benchmarks/euler411-investigation.mjs compiled 1 30 combined
node --import ./benchmarks/experiments/euler411-borrow-probe.mjs \
  benchmarks/euler411-investigation.mjs compiled 1 30 combined
node benchmarks/experiments/euler411-verify.mjs
node --import ./benchmarks/experiments/euler411-borrow-probe.mjs \
  benchmarks/experiments/euler411-verify.mjs
node benchmarks/experiments/euler411-hand.mjs plain
```

The runner accepts a mode (`compiled` or `reference`), First, Count, then a
variant (`original`, `append`, `three`, `grow`, `combined`, or `phases`).
`RANK411_POWER` overrides the exponent; default is 5.
Raw measurements, diagnostics and runtime hashes:
`baselines/2026-11-05-euler411-investigation.json`.
