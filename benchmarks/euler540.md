# Euler 540: odd Möbius inversion and packed array passes

The full N=3141592653589793 result remains **500000000002845**.
The old program was already much faster than the historical 100-second issue
estimate: a profiled exploratory Mac run took 10.5 seconds. Primary paired
measurements below use the current frozen a8ae3012 runtime, with profiling off.

## Counting and batching

Primitive triples correspond to m>n>0, opposite parity, gcd(m,n)=1 and
m*m+n*n<=N. A common divisor is odd. If R(X) counts opposite-parity pairs
without the gcd condition, then

    P(N) = sum over odd d of mu(d) * R(N // d^2).

Only d<=floor(sqrt(N/5)) can contribute. The replacement sieves only odd
integers; a small prime changes each sign once, its square clears the sign,
and one remaining prime flips it again. Squareful residuals already have
zero coefficients, so stripping each small prime once is sufficient.

R(X) is tabulated through T=1000000 instead of the old 10000000. For large X,
the first 2K rows contribute K*K, where K=floor((isqrt(2X-1)+1)/4).
Remaining rows use

    upper = min(m-1, isqrt(X-m*m))
    count = (upper+1-(m mod 2)) // 2.

Their lengths are prefix-summed and flattened into one ragged sequence.
Batches of at most 250000 rows recover their owner with upperindex, calculate
row counts using exact isqrt and multiply by the owner's Möbius sign. This
replaces thousands of helper invocations and the nested row loops. Ordinary
bindings retain the fast materialized-array path in reference execution.

Direct divisors stop at a split near N^(1/3), enlarged to at least
floor(sqrt(N/(T+1))). The cube-root approximation only chooses a work split;
all bounds and contributions are exact. Beyond the split, group equal
q=N//d^2. Their endpoints are isqrt(N//(q+1)) and isqrt(N//q), clipped by the
split; odd Möbius prefix sums give each group's weight. The bound on the split
ensures that every tail q fits the small R table. This avoids the old
multi-million-element quotient and selection arrays.

N<5 returns zero. Table and Batch are adjustable, clamped to effective
minimums of five and one. They are bounded-work defaults, not a claim of a
universal optimal threshold. The Rank code uses existing library operations,
one explicit loop, meaningful names, and at most 40 columns per line.

## Shared runtime changes

1. Seeded sums over ready Int32 vectors now build packed prefixes. Seeds and
   prefixes inside the safe Number range are exact; leaving Int32 promotes
   private output, and unsafe prefixes replay the ordinary arbitrary-precision
   scan. Empty inputs retain their seed. Noninteger seeds and other storage
   retain existing behavior. This removes 12.5 million boxed prefixes from
   `Mu scan + with 0`. Budgeted and observable execution keep the old path.
2. Dense ascending constructor-proved range targets for lowerindex/upperindex
   merge through a numeric source with one cursor. A first binary search skips
   the source prefix. Sparse queries keep galloping searches. A small Int64
   source is privately narrowed after every signed word is checked; endpoints
   reject wide values before allocating. Temporary source storage is bounded
   by the result size and is not cached. Edited ranges lose the proof, and a
   singleton with an unbounded step retains scalar target generation.
3. Ready private Int64 unary passes read machine words rather than allocating
   a BigInt at every cell. The single rounded addition matches Number(BigInt)
   conversion, including signed endpoints. Integer results retain unsafe-input
   replay; nonuniform validators keep their ordinary per-cell reads. Shared
   Int64 buffers retain the old load path. Existing work checkpoints remain.

These are native array paths used in both reference and compiled execution;
no Euler-specific runtime operation or syntax was added.

## Measurements

Node 24.15.0, separate processes, three alternating pairs in each mode on each
host. Values are medians of execution time and process peak RSS. Every full
sample checks the exact answer. No benchmark jobs overlap on one host.

| Host / mode | Before seconds / MiB | After seconds / MiB |
| --- | ---: | ---: |
| Mac arm64, compiled | 8.346 / 1729.6 | 6.055 / 550.8 |
| Mac arm64, reference | 13.319 / 2060.3 | 4.903 / 551.2 |
| Intel i7-10750H, compiled | 20.397 / 1078.5 | 12.030 / 420.1 |
| Intel i7-10750H, reference | 28.908 / 1685.2 | 11.774 / 415.9 |

Mac load was roughly 2.7-3.5 and RSS varied with collection timing. CPU
medians also decrease: compiled 11.526->9.195 seconds, reference
16.499->8.111 seconds. Intel recorded zero other Node processes before every
sample; load rose from 0.02 to about 1.85 during this single workload.
Intel CPU medians decrease 27.401->18.356 and 37.017->19.108 seconds.

Single controls with the new source on the old runtime take 6.804 seconds /
1230.6 MiB on Mac and 15.985 seconds / 850.7 MiB on Intel. The shared changes
therefore contribute substantial memory savings beyond the demo rewrite.
These controls are single samples rather than repeated medians.

A fully deferred prototype gave a faster compiled pass, but reference time
rose to 68 seconds; a partially deferred version still took 55 seconds in
reference. Both were rejected. Separate eager array stages plus packed native
passes give the useful improvement across modes. Exploratory measurements are
labelled separately in the [raw data](baselines/2026-11-09-euler540.json).

## Verification

Independent enumeration of coprime opposite-parity pairs covers small bounds
and boundaries at primitive/nonprimitive norms. Independent factorization
checks every stored odd Möbius coefficient through 1000. Forced small tables
and batches of one/seven/thirteen exercise zero-length rows, group endpoints,
partial final batches and clamped parameters. All three backends check the
million-bound regression and the full answer; a single solver is also reused
across different geometry.

Runtime checks cover exact seeded prefixes, Int32 widening, unsafe-number
replay, empty inputs, real seeds, cancellation, unchanged source buffers,
perfect-square boundaries, signed Int64 Number conversion, trusted strided
views, constructor-range mutation and an arbitrarily large singleton step.

Mac: 338 focused checks across selected runs, plus both filtered differential
files, passed. Intel: 136 Euler/runtime checks passed. TypeScript build passed.
Exhaustive type/corpus audits and the full npm suite were not run. The full
demo now returns to the ordinary differential corpus.

Reproduce from the repository root:

```sh
node benchmarks/euler540.mjs compiled
node benchmarks/euler540.mjs reference
```

`RANK540_RUNTIME` selects a frozen interpreter entry point; the third argument
can select `benchmarks/fixtures/euler540-original.ra`. RANK540_TABLE and
RANK540_BATCH override the new program's defaults. Primary samples disable
RANK540_DIAGNOSTICS and RANK540_PROFILE. Build output must match the source.
