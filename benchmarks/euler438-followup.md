# Euler 438: exact endpoint intervals and stronger difference bounds

Default N=7; answer **2046409616809**, from **24883200** polynomials.
Baseline: `c53fd955`, retained in `experiments/euler438-original.ra`.
The [problem](https://projecteuler.net/problem=438) requires one real root in
each half-open interval [i,i+1), i=1..N; the statement's N=4 count and sum
are 12 and 2087.

## Measurements

Individual Node v24.15.0 processes, Apple M5 arm64 and Intel i7-10750H x86_64.
Times include parsing; RSS is process peak. No Node heap/GC flags are used.

| Host / mode | Original | Final | Original peak MiB | Final peak MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac compiled | 58.624 s | 2.370 s | 211 | 383 |
| Mac reference | >300 s, stopped | 2.341 s | not recorded | 354 |
| Intel compiled | 133.307 s | 6.114 s | 203 | 343 |
| Intel reference | 300 s timeout | 5.948 s | not recorded | 341 |

Compiled improves about 25x / 22x. The reference controls did not complete,
so their entries are deadline lower bounds, not completed measurements or
exact speed ratios. Mac termination was confirmed as exit 143; Intel's
process-level timeout returned 124.

**Memory tradeoff:** the retained array version uses more peak RSS than the
old scalar compiled search: about +172 MiB on Mac and +140 MiB on Intel.
Early full-frontier prototypes peaked at 741 MiB; bounded recursive batches
and compact integer products reduced that substantially. This is a speed/
memory tradeoff, not an overall memory reduction. Neither a full 5.87-million
prefix frontier nor all candidate polynomials is retained.

## Why the old program was slow

The scalar program uses a falling-factorial basis and bounds the next integer
coefficient by consecutive forward differences. At default size it visits
6343305 nodes, including 5867776 final prefixes, with nested scalar loops.
The initial artificial sentinel 10^18 also makes Number entry correctly
reject an unsafe integer input. A diagnostic N=7-only sentinel of 10^9
restored Number loops and measured 5.306 s / 213 MiB, but did not repair the
reference search or remove the approximate boundary predicate. This is not
a reason to weaken the compiler's integer guard.

## Exact final-coefficient count

Fix all coefficients except the constant c. Write P(k)=V(k)+c and D(k)=P'(k).
For each k=1..N+1 the required sign immediately to its left is
s(k)=(-1)^(N+1-k). If P(k) is nonzero its sign suffices. Equality is allowed
exactly when s(k) D(k)<0: a simple root then has the right sign on its left.
A zero derivative at a zero endpoint is a repeated root and cannot satisfy
the distinct floor requirements.

Thus every endpoint supplies a lower or upper integer bound on c, with an
extra unit when equality is forbidden. Intersect these bounds once. Their
alternation guarantees one root in each [i,i+1); degree N leaves no room for
extra, repeated or complex roots. This replaces J+0.9999, duplicate-boundary
checks and the second, incompatible sign pattern with exact integer work.

All roots are positive, so coefficient signs alternate and S(t)=|P(-1)|-1.
For the fixed prefix, P(-1)=C+c, with known C. Its sign is (-1)^N throughout
a valid interval. The count and score sum over all c are arithmetic-series
formulas; individual last coefficients are never enumerated.

## Stronger prefix bounds

For any sorted endpoint subset with alternating parity, the divided-difference
weights alternate in sign just as P's required endpoint signs do. Their
weighted sum therefore has a known weak sign. For order N-t, lower unknown
coefficients vanish and the new falling-factorial coefficient a_t has weight
one, giving an integer lower or upper bound on a_t.

Use every such subset, not just consecutive endpoints. Divided differences
of integer-coefficient polynomials at integer nodes are integers, so setup
uses exact integer division; there is no floating interpolation. The tiny
coefficient tables are prepared once. `matmul`, axis reductions and scan-based
interval expansion evaluate many prefixes together. Recursive batches of 256
bound the frontier; every helper has at most one loop, without nested Rank
loops. All production lines fit 40 columns. Ordinary bindings retain their
normal snapshots; explicit copies compact the reused prefix/bound matrices.

## General numeric runtime improvement

Dense integer `matmul` already proves an absolute-product bound before using
Number arithmetic. It now publishes Int32 results when safe. When the bound
itself fits Int32, compute directly into the compact buffer; otherwise check
the actual safe integer sums, allowing cancellation to produce compact results.
Wider and arbitrary-precision results retain their exact paths. Real products
retain real storage and accumulation order. Observable/budgeted execution keeps
its existing store/checkpoint path. Integer transpose scratch also keeps its
compact physical kind.

This reduces output storage from eight to four bytes per cell and can avoid
the temporary Float64 output. It also exposes packed integer operands to the
next gather/arithmetic kernel. There is no Euler-specific intrinsic or unsafe
narrowing. On the final program with only this runtime change disabled, Mac
controls measured 2.823 s compiled / 2.728 s reference, versus 2.370 / 2.341 s
with it enabled. Intel runtime-only controls are 7.234 / 6.946 s before,
versus 6.114 / 5.948 s after. Most of the total speedup is the search/counting
rewrite.

## Verification and reproduction

The independent host oracle enumerates ordinary power-basis coefficients within
Vieta bounds through degree 4. It deflates integer roots exactly and checks
strict sign changes in the remaining intervals, using neither derivatives nor
difference bounds. It recovers all 12 statement polynomials and sum 2087.
A separate aggregate test feeds every Vieta-bounded quartic prefix to the final
constant-interval helper. Degrees 0..6 run in compiled/exact/reference modes;
the full default answer and count remain explicit assertions. Existing fixtures
retain N=4,5,6 and run in all three modes. Degree zero returns the natural empty
coefficient tuple: count 1, score 0.

Compact-matmul tests cover signed Int32 edges, cancellation, safe wide outputs,
unsafe intermediates, arbitrary-precision fallback and mixed real operands.
Selected ordinary suites cover general integer/real products, arbitrary axes,
ranked cells, sparse kernels, cancellation/budgets and numerical demo regressions.
164 selected tests in 10 files pass on each host. Exhaustive corpus audits
are left to CI. The old full-scale exclusion is removed.

```
node benchmarks/experiments/euler438-run.mjs compiled 7
node benchmarks/experiments/euler438-run.mjs reference 7
node benchmarks/experiments/euler438-verify.mjs
```

`RANK438_RUNTIME` selects a different built interpreter index.js URL for a
runtime-only control. Run original reference controls with a process-level
deadline; they exceeded 300 seconds on both hosts. Raw source hashes, diagnostics,
completed measurements and stop statuses are in
`baselines/2026-11-07-euler438.json`.
