# Euler 531: invert the small gap, visit pairs by diagonals

The full result remains **4515432351156203105**. The existing interval fixtures
[2,60) -> 589886 and [1000,1060) -> 676762403 remain. The
[problem](https://projecteuler.net/problem=531) asks for the sum of the smallest
nonnegative simultaneous residues of phi(n) modulo n and phi(m) modulo m.
The old 46-second issue/exclusion note predates earlier compiler improvements:
at a81d19c8 the original full source already takes about 4.43 seconds.

## Algorithm

Let a=phi(n), b=phi(m), d=m-n, g=gcd(n,d). A solution exists exactly when
g divides b-a. Put d'=d/g, m'=m/g. They are coprime, and n/g is congruent to
-d' modulo m'. The original source already exploited the small gap d'<5000,
but computed its modular inverse with twenty rounds of vectorized Euclid.
Each round completed filtered arrays and tracked the still-active positions.

The replacement uses Euler's theorem with the existing `powmod` operation:

    v = m'^(phi(d')-1) mod d'
    k = -v mod d'
    h = (1 + m'*k) / d'
    inverse(n/g mod m') = -h mod m'
    x = a + n * (((b-a)/g * -h) mod m')

The d'=1 case works directly: powmod modulo one gives zero and h=1. No inverse
is taken on incompatible pairs. Totients are computed only for the input
interval and the small possible gaps, using `factors unique` and products of
p and p-1. This removes both full million-element sieve arrays and their loops.
It also avoids scaling storage with the interval's absolute lower bound. The
intermediate variant that kept the full sieve and changed only the inverse
measured 2.16 s / 221 MiB. The final factor-based variant has a higher process
peak than that prototype despite fewer logical totient entries, but removes
the nested sieve loops and scales with interval width. Its measured improvement
is relative to the original source; it is not the smallest-RSS prototype.

Every pair has a unique positive difference. One explicit loop over differences
visits contiguous diagonals, and array operations process all pairs on each
diagonal. The triangular prefix table, `upperindex` pair search, arbitrary
pair chunk size and active Euclid arrays disappear. There are no nested Rank
loops, and every line fits 40 columns. Empty, reversed and singleton intervals
return zero before constructing totient arrays.

## General compiler repair

The scalar-function compiler accepted an integer `reduce *`, but declined the
same operation with its explicit exact identity `with 1`. It now lowers
rank-one integer addition/multiplication folds through the existing function
plan consumer when their seed is absent or is the exact integer identity
(0 for +, 1 for *). Real and nonidentity seeds keep their ordinary type/work;
rank/axis/key variants also retain their existing paths.

Newly admitted folds use the existing private-fold guard when demand budgets,
custom polling or execution hooks are observable. This avoids replacing the
native symbolic fold's work units with plan-cell work. The budget regression
isolates scalar entry from block/function-body compilation, so it measures
this compiler's contract rather than unrelated block checkpoint differences.
Native stored-array folds may finish before polling cancellation; a compiled
traversal can observe cancellation earlier. Both remain usable on subsequent
ordinary calls. There is no totient-specific intrinsic or answer recognizer.

## Full-scale measurements

Node v24.15.0 on the Mac (arm64), fresh independent processes. Compiled timings
and RSS below are medians of three alternating before/after pairs, including
parse and execution. The baseline runtime/source is a81d19c8. Reference and
scalar JS numbers are single final observations; RSS is process peak.

| Workload | Before | After |
| --- | ---: | ---: |
| Compiled Rank | 4.434 s / 833 MiB | 2.188 s / 316 MiB |
| Reference Rank | 5.208 s / 877 MiB | 4.237 s / 700 MiB |
| Independent scalar JS | — | 1.605 s / 56 MiB |

Compiled time is about 2.03x faster, with 62% lower peak RSS. Reference time
falls by 19% and peak RSS by 20%. The independent JS program uses a classical
full totient sieve and extended Euclid on (n,m), not the Rank gap/powmod method.
It confirms the full answer. Rank takes about 1.36x its time in this observation;
the JS scalar loop also retains far less intermediate storage.

Most improvement is algorithmic. The new source with the old runtime takes
2.342 seconds / 350 MiB; the old source with the new runtime takes 4.457 seconds
/ 815 MiB. The compiler repair provides an additional modest improvement.
Other-demo controls stay within one-pair noise: Euler 529 is 4.287 -> 4.280 s,
and Euler 530 is 4.161 -> 4.207 s. Deferred factor plans were also tried, but
were slower and allocated more than completing the short reusable factor array.

Intel remains busy with an independent corpus worker and package temperature
at 100 C. All new cases pass there, including the full answer. A separate
nice=19 asserted run is 5.53 seconds / 320 MiB; it is not an unloaded
before/after performance comparison. No external process was stopped.

## Verification and reproduction

An independent test oracle counts coprimes directly to compute small totients
and applies extended Euclid to n and m. A direct search for the least CRT
solution validates that oracle over [1,20). Tests cover zero/one pair, reversed
ranges, coprime/incompatible pairs, both existing fixtures and all execution
modes. Wide input tests start at 2^54, with independently trial-factored
totients and BigInt CRT; full-scale totals exceed the safe Number range too.

41 Euler cases and 17 compiler cases pass. The latter prove scalar compiler
admission, exact/empty/wide products, real and nonidentity seed fallback,
rank-two shape preservation, scoped budget work and cancellation/reuse.
The focused Mac set verifies 324 cases across 12 files (322 in the initial
selected run plus two final compiler-admission cases). Intel verifies the same
58 new cases. Filtered differential passes the main demo and its fixture
(2 files, 1 embedded test block, about 8.6 seconds). The old full-scale exclusion
is removed. No full suite or exhaustive audit was run.

From the repository root:

    node benchmarks/euler531.mjs compiled
    node benchmarks/euler531.mjs reference
    node benchmarks/euler531.mjs compiled 2 60
    node benchmarks/euler531-js.mjs

From `packages/interpreter`:

    node scripts/test.mjs test/euler531.test.ts
    node scripts/test.mjs test/identity-seeded-folds.test.ts
    node scripts/test.mjs test/differential.test.ts -t euler/531_chineseleftovers

The original source is `fixtures/euler531-original.ra`; raw records and source
hashes are in `baselines/2026-11-09-euler531.json`. A frozen interpreter can be
selected with `RANK531_RUNTIME=/path/to/interpreter/out/index.js`. Set
`RANK531_EXPECTED=4515432351156203105` to assert a full benchmark, and
`RANK531_DIAGNOSTICS=1` for a separate diagnostic run.
