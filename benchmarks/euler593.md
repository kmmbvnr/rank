# Euler 593: native overlapping-window medians

Baseline: `3ffe11fdb8c39590502e69794a3891222f09c54a`.
Delivery additionally integrates main through `f1abfd87`; the primary samples
retain their original runtime hashes, and focused checks were repeated.
Defaults remain N=10000000, K=100000; answer **96632320042.0**.

## Program

The old program builds an odd-only sieve in a large integer array, generates
modular powers, and maintains two median pointers with nested Rank loops.
The new program uses the existing compact `primesieve` library operation and
reduces each prime's exponent modulo 10006. The sole prime divisible by 10007
is corrected to zero explicitly. This also handles a reduced zero exponent.

The offset sequence still uses floor(k/10000)+1 with one-based mathematical
indices. `Values window K median axis 1` keeps the overlapping windows as a
view until the median consumer. The logical N-by-K window tensor is never
materialized. The ordinary median binding stores only N-K+1 real values,
then sums them. Here every median is an exactly representable half-integer,
and the sum remains below 2^53. Formatting to one decimal preserves the old
answer string. Invalid inputs now report `need 1 <= K <= N` explicitly.

The source has **no explicit loops** and fits 40 columns. It uses the same
language operations as ordinary user programs; no Euler-specific builtin or
compiler recognizer was added.

## General runtime change

The existing median axis reduction recognizes unpadded, unit-stride windows
over a one-dimensional stored Int32 source. It shares a frequency histogram
across windows. Nearby median changes walk at most 64 cells. A Fenwick index
over 64-cell frequency blocks is built only at the first long jump; subsequent
updates keep it current. Alternating distant values therefore have bounded
search cost, while ordinary nearby changes avoid repeated rank searches.

Histogram storage is limited to 4 MiB and to a size proportional to the input;
sparse domains keep ordinary sorting. The output uses eight bytes per window.
This is not a general real-valued or multidimensional window-median kernel.
Those layouts, padding/stride variants and wide integer domains retain their
existing implementation.

Only runtime-registered windows with matching readers and geometry qualify.
The source and checked identity wrappers must expose trusted private storage.
Opaque readers, host mutations, shared buffers, column contracts, demand
budgets, inspection and host polling decline the fast path. Canonical builtin
identity is checked; a redefined function keeps its own dispatch. Cancellation
is polled during bounded private work, and inputs and earlier outputs remain
unchanged. Window registration does not read input cells. A final guard change
also avoids rereading a host source-shape getter during registration; the
primary samples precede that header-only change. Final guard tests and full
answers were repeated, and both runtime hashes are saved.

## Measurements

Node v24.15.0. Three alternating fresh-process pairs per comparison, plus three
new full reference runs. Time includes parsing and excludes interpreter import;
RSS is the process high-water mark. No other task-owned test/build/Node job ran
on the same host during primary measurements.

**The Mac was heavily loaded**: recorded one-minute loads were 18.68–22.72;
Intel loads were 1.58–2.57. These are paired observations under that load,
not unloaded latency estimates. Intel confirms the direction of the improvement.

| Host / workload | Old seconds | New seconds | Old RSS MiB | New RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Apple M5, full compiled | 6.160 | 3.170 | 1413.5 | 461.6 |
| Intel i7-10750H, full compiled | 8.467 | 3.948 | 1157.0 | 434.1 |
| Apple M5, reference N=100000/K=10000 | 3.124 | 0.335 | 191.7 | 176.3 |
| Intel i7-10750H, reference N=100000/K=10000 | 3.388 | 0.344 | 183.2 | 165.9 |

New full reference medians: **3.390 s / 573.0 MiB on Mac**, and
**4.114 s / 472.4 MiB on Intel**. Full old reference was not timed; the small
reference speedup must not be presented as a measured full-input speedup.
Full compiled peak RSS decreases about **67% on Mac and 62% on Intel**.

Raw samples and source/runtime hashes: `baselines/2026-11-11-euler593.json`.
Reproduce with `node benchmarks/euler593.mjs compiled` or `reference`.
Additional arguments select N, K and source path. `RANK593_RUNTIME` selects an
alternate interpreter index.js; the original source is in `fixtures/`.

## Verification

- 797 focused checks on each host after integration (259 workload checks plus
  deferred composition, plans, publishing loops and the capability matrix): window demand/folds/dimensions, statistics,
  native axis reductions, dense and sparse values, odd/even/empty windows,
  negative and Int32 boundary values, deterministic random data, long jumps,
  changed readers/geometry, host getters/writes, shared buffers, custom
  functions, finite-real errors, cancellation, budgets and inspection.
- Euler checks compare both engines with independent prime enumeration,
  unreduced modular powers and sorted windows. They cover the 10000 offset
  boundary, prime 10007 and the 10006 exponent period, and compare the original
  count-pointer implementation at additional inputs.
- Both engines pass the full golden answer on Mac and Intel. Both filtered
  differential files pass, including both fixture test blocks. The fixture now
  asserts the full answer; the full demo is restored to ordinary corpus audits.
- TypeScript build, 13 runner/semantic checks and 65 semantic owners pass.
  Exhaustive audits and the entire repository test suite were not run.
