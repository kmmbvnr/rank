# Euler 578: powerful prefixes and read-only numeric recursion

Base: `b3b75fa628e115e7a252f305e29fdf2834b351fc`.
The default N=10^13 retains the exact answer **9219696799346**.
The million checkpoint is 922052; N=10^9 gives 921966697.

## Program and cost

The former Lucy prime-count table and exponent-pattern stack are replaced by
powerful prefixes and squarefree tails. Every admissible number has a unique
prefix of prime powers with nonincreasing exponents at least two. Its remaining
primes occur once and exceed the last prefix prime. Sorted prime-power rules
bound the prefix search; each CPU helper has one loop, without syntactic nesting.
Broadcasts and a scan construct the small tail table.

For Q(x), the squarefree count, Mobius inversion gives
Q(x)=sum(mu(d)*floor(x/d^2)). Prefix sums of mu(d)^2 answer small queries.
If F(x,a) excludes the first a primes, then
F(x,a)=F(x,a-1)-F(floor(x/p[a-1]),a), with F(x,0)=Q(x).
The prime-count shortcut is restricted to x<=sqrt(N), where its table is valid.
An independent direct-factorization oracle covers prime-power and prime-gap
boundaries. The powerful-prefix enumeration visits about 5.17 million nodes.

The dense tail cache uses at most 10001 columns and seven rows. These are
performance cutoffs, not mathematical bounds: larger queries recurse exactly.
A vector alternating sum over prime powers constructs each row. Explicit
`copy` publishes the scan once before repeated indexing; ordinary binding of
the lazy scan alone would recompute it. The default prime range exceeds the
library factorsieve cap, so a vector Mobius sieve keeps that existing memory
limit intact. No hand-written index memo cache or new library limit is added.

## General compiler changes

An explicit native copy of a range in an ordinary function binding can reach
the same range-array proof as its eager unwrapped form. Copy guards, shadowing,
ordinary assignment boundaries and deferred/public plan rules remain intact.

Captured integer reads at one- and two-dimensional scalar addresses avoid
allocating an index array per read. The exact path still resolves bindings and
keeps ordinary errors. Read-only integer function graphs can additionally use
checked Number execution with captured integer scalars, completed private typed
arrays and non-tail self recursion. Borrowed physical readers are prepared at
entry and invalidated on rebinding/revision. Int64 cells are checked as read.
All integer parameters, intermediates and results must remain safe integers;
overflow replays through exact arithmetic. No threshold or syntax is changed.

Opaque, shared, higher-rank and per-cell validation readers keep exact paths.
Inspection, demand budgets and observable function hooks decline the new path.
Recursive calls preserve the logical depth limit and cancellation checkpoints;
ordinary errors replay for source frames, and cancellation propagates directly.
Existing constant-depth tail recursion is retained.

## Measurements

Node v24.15.0, Apple M5 arm64 and Intel i7-10750H x64. Full compiled comparisons
use three alternating fresh-process old/new pairs on each host. Every completed
sample checks its exact answer. Timing includes parsing/execution, excluding
interpreter import; RSS is process high-water. Diagnostics/profiling are off.
No tests or other benchmarks launched by this session overlap a measurement on
the same host. Intel was nearly idle before the runs (load 0.16/0.05/0.01).

| Host, full compiled | Old seconds | New seconds | Old RSS MiB | New RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac arm64 | 46.319 | 7.866 | 337.7 | 335.3 |
| Intel x64 | 104.953 | 21.126 | 345.1 | 317.3 |


The catalogue's historical 9.5-minute estimate is not a current baseline:
the old program on the current base takes about 46 seconds on Mac.
An unchanged new-source/old-runtime Mac control takes 38.686 s / 537.8 MiB.
The Intel new-source/old-runtime control takes 101.705 s / 567.0 MiB.
The common compiler change therefore contributes substantially; the program
rewrite alone does not explain the final compiled improvement. This control
is a single sample rather than a repeated median.

At N=10^9, single Mac reference controls improve 16.126 -> 3.222 s, with
RSS 439.9 -> 470.4 MiB. This reduced-input reference run has a memory regression;
it is not evidence of lower allocation or lower reference memory generally.
The corresponding single Intel reference controls are 44.104 -> 10.208 s,
with RSS 428.2 -> 444.2 MiB.
Full compiled memory and reference memory are reported separately.

The full new reference run was externally terminated after its 300-second
process deadline on Mac. It produced no verified answer or peak-RSS measurement.
The main therefore retains its manual full-reference lane with an updated
explanation. A dedicated full compiled golden runs in the ordinary Euler unit
file, and the existing small fixture remains in all three corpus audits.

## Rejected experiments

A fully materialized array frontier took 34.212 s and 1198 MiB on Mac and was
rejected. A larger 100000-column array table took 5.747 s but 384 MiB; the
smaller six-prime table trades time for lower memory. Earlier nested scalar
prototypes helped isolate capture and recursion costs, but were replaced by
one-loop sorted-rule enumeration and array row construction. Prototype runs
used evolving compiler revisions and are diagnostic, not paired comparisons.
Reducing the cache to 1000 columns took 18.330 s compiled / 326.9 MiB
and 3.912 s reference at N=10^9 / 475.7 MiB on Mac; it was rejected because
the full compiled slowdown buys little memory and reference RSS does not fall.
An unmaterialized scan-table experiment was externally stopped with SIGINT
(exit 130); it has no measured completion time, peak RSS or verified answer.
Its source hash and available completed prototype observations are retained
in the raw results, separately from final primary samples.

## Verification and reproduction

658 focused checks pass on Intel. On Mac, 123 scalar checks, 471 surrounding
function/plan/interrupt/range checks and the 64 Euler checks pass. Direct small
factorization through 20000 independently defines the expected counts. Cases
cover zero, one, exponent-order violations, prime squares, cache-cut changes,
the million checkpoint on compiled/reference and scalar-kernel-disabled routes,
the old search through 10^9 and the full compiled golden.

Three filtered Mac checks pass for the ordinary fixture: differential,
inferred types and name facts. TypeScript builds and exclusion-policy checks
pass. The new compiler checks cover COW aliases, rebinding, unsafe captured
cells/scalars, recursive overflow/error frames, maximum call depth and recovery,
tail recursion, shared/opaque inputs, observer hooks, budgets and atomic
cancellation. Three stale exact diagnostic call-count assertions also failed
on the clean base; their bridge-dependent counts are replaced with positive
activity/fallback checks while all behavioral assertions are retained.
Full npm test and exhaustive corpus audits were not run.

```sh
node benchmarks/euler578.mjs compiled
node benchmarks/euler578.mjs reference 1000000000
node benchmarks/euler578.mjs exact 1000000
node benchmarks/euler578.mjs compiled 10000000000000 benchmarks/fixtures/euler578-original.ra
```

`exact` disables scalar function kernels and Number loop compilation;
it does not disable every compiled backend. `reference` disables compilation.
`RANK578_RUNTIME` selects a built runtime, `RANK578_EXPECTED` checks the answer,
and `RANK578_DIAGNOSTICS=1` / `RANK578_PROFILE=path` enable separate instrumented
runs. Raw results: `baselines/2026-11-10-euler578.json`.
