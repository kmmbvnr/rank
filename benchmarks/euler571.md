# Euler 571: fuse weighted sums and batch the prefix search

Base: `e8333ddfac6062137082e98ed9bc4c0f06516f51`.
The default sums the ten least 12-super-pandigital numbers: **30510390701978**.
The statement's base-10 values remain **1093265784** for one and **20319792309**
for ten; base 5 starts at **978**.

## Findings

The original algorithm already visits base-B digit permutations in increasing
order and filters them through chunk digit masks in lower bases. It handles
about 174 million candidates before reaching the default result. The main
avoidable cost is constructing a product matrix for every prefix and reducing
it afterward. The baseline profile spends over half its sampled time in
integer array multiplication, generic reduction and cell readers.

Writing the product and row sum together exposed two shared fusion limits.
The weighted-axis kernel accepted rank-2 coefficient arrays only, and rejected
matrix counts above 2^20 even when the absolute sum bound proved exact Number
arithmetic. Merely contracting the expression, without closing these limits,
left the full prototype near its baseline time.

## Shared implementation

`Matrix * Weights sum axis 1` now accepts the ordinary rank-1 trailing vector
spelling on either operand side. Both matrix axes still support explicitly
shaped weights; negative axis spellings retain their behavior. Matrix counts
may span Int32 when the absolute coefficient/product sum fits safe Number
precision. Every product and partial sum is then exact. Wider signed-word
arithmetic keeps its original low-word product restriction and int64 bound.
No global Number admission threshold changes.

Unchanged compact matrices reuse the existing tensor bounds cache, keyed by
tracked storage identity and revision. Writes invalidate the proof. This
avoids scanning the same permutation weight matrix for every prefix. Host
interrupt polling keeps the checkpointed bounds scan. Opaque readers and
column contracts decline, and shared storage never enters the bounds cache.
Budget and inspection modes retain their existing routes. Arbitrary-precision
matrix contraction, real inputs and ordinary eager binding boundaries remain.

## Rank program

Library integer `permutations` replaces the hand-written expansion loops.
A small CPU helper constructs position weights with one scatter loop. Prefix
rows are generated and deduplicated as arrays. The main loop visits those
prefixes in order; a `reduce` applies successive base filters. Chunk-mask
construction and filtering each have a separate helper with one loop. There
are no syntactically nested loops, and every Rank line is within 40 columns.

The product and axis sum are one expression, without an eager product binding.
Only one suffix batch is processed at a time. The prefix width also handles
bases 2 and 3 and a zero requested count, covered against exhaustive integers.
Chunk tables still distinguish a genuine zero digit from leading padding.
The search covers B-digit base-B pandigitals; the requested hits must be found
in that range, as in the original algorithm. Default and statement inputs
satisfy this condition.

## Measurements

| Host/mode | Old seconds | New seconds | Old RSS MiB | New RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| mac, compiled (median of 3) | 67.907 | 16.754 | 441.2 | 406.6 |
| intel, compiled (median of 3) | 170.810 | 43.950 | 400.9 | 338.4 |
| mac, reference (one full sample) | 74.300 | 69.104 | 643.9 | 451.2 |
| intel, reference (one full sample) | 175.850 | 164.815 | 474.4 | 436.8 |

Compiled medians improve by 4.05x on Mac and 3.89x on Intel. The single full
reference pairs improve by about 6-7%, with lower peak RSS. Mac compiled RSS
ranges overlap (old 430-484 MiB, new 401-438 MiB), so the reported memory
comparison uses medians rather than claiming every new sample is lower.

Single old-source/new-runtime controls took 71.936 s on Mac and 173.524 s on
Intel. New-source/old-runtime controls took 63.029 s and 166.446 s. Both the
contracted source expression and the shared fusion support are needed for the
main gain.

Base-10 reference medians (T=10, three pairs) were 0.628 -> 0.613 s on Mac
and 1.895 -> 1.849 s on Intel. The one-minute load before samples ranged from
1.47 to 3.27 on Mac and 0.33 to 1.87 on Intel. A during-run Intel process
snapshot showed the benchmark as the dominant CPU consumer on its 12 logical
CPUs.

Node v24.15.0 on Apple M5 arm64 and Intel i7-10750H x64. Full compiled timings
use three alternating fresh-process old/new pairs per host; full reference
and source/runtime controls are single samples. Base-10 reference timings use
three old/new pairs. Every sample checks its exact answer. Elapsed time includes
parsing/execution and excludes interpreter import. RSS is the process high-water
mark; diagnostics and profiling are disabled. Raw samples are in
`baselines/2026-11-10-euler571.json`.

## Verification

224 focused checks passed on each host. Independent exhaustive integer searches
in bases 2 through 7 check zero and multiple requested counts on Number, exact
and reference backends. All modes retain the base-10 statement values; the
full base-12 golden is checked by tests and measurements. Shared tests cover
both axes, signed large Int32 counts, transposes, vector operand order, invalid
shapes, opaque readers, exact wide contraction, bounds reuse and invalidation,
budgets and cancellation. Euler 548, tensor bounds, Number axis sums and real
array function regressions pass. Full npm test and exhaustive audits were not
run. Mac additionally passed the selected fixture in differential, types and
name-facts audits, TypeScript build and five exclusion-policy checks.
The full default retains its manual corpus lane because of reference
execution cost; focused tests and benchmarks check the full golden, while the
small fixture remains in ordinary audits.

```sh
node benchmarks/euler571.mjs compiled 12 10
node benchmarks/euler571.mjs reference 12 10
node benchmarks/euler571.mjs exact 10 10
node benchmarks/euler571.mjs compiled 12 10 benchmarks/fixtures/euler571-original.ra
```

`RANK571_RUNTIME` selects another built runtime; `RANK571_EXPECTED` checks the
answer. `RANK571_DIAGNOSTICS=1` and `RANK571_PROFILE=path` enable separate
instrumented runs.
