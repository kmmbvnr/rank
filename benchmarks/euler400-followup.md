# Euler 400: rolling arrays and implicit bitwise tensor fusion

Integration base: `0e64c25b`, Node v24.15.0. Euler 400 now retains only the two
preceding DP rows instead of a sparse index of 16,734,773 states. Its Rank
source stays array-oriented. A generic compiler admission change also allows
native `band`, `bor` and `bxor` to compose with arithmetic in an ordinary
assignment's implicit tensor kernel. The existing IR, shape/storage/builtin
guards and exact-integer emitter do the lowering; no Euler-specific helper,
Number-mode threshold change or new buffer-reuse rule is introduced.

The main row expression is:

```
Counts = (Prev (Ts bxor B) +
  Older (Ts bxor A)) mod Mod
Older = Prev
Prev = concat (array 1) Counts
```

`Counts` completes in one generated pass, including the two selector maps,
gathers, sum and modulo. The following ordinary assignments keep their
completion boundaries. Concat remains a separate allocation.

## Controlled comparison

Three fresh sequential processes per variant on each host, alternating order;
no overlapping benchmark, test or build from this investigation on that host.
Parsing and diagnostics are included; imports/startup are excluded. Peak RSS
includes the whole process. The shared machines can still have unrelated load.

| K=10000 | Apple M5 seconds / peak MiB | Intel i7-10750H seconds / peak MiB |
| --- | ---: | ---: |
| Original sparse DP, compiled | 9.015 / 1183.8 | 19.185 / 1164.1 |
| Final program, previous compiler admission rule | 4.072 / 414.2 | 10.624 / 318.7 |
| Final program and compiler | **2.481 / 328.7** | **7.037 / 335.5** |
| Final program, reference | 4.047 / 408.7 | 10.230 / 310.5 |

These are medians of three. Combined compiled speedups are 3.63x / 2.73x;
peak RSS drops 72.2% / 71.2%. The compiler-only comparison uses the **same
final Rank source** and an in-memory loader that restores the previous
admission condition: speedups 1.64x / 1.51x. Compiler-only memory improves on
Mac but rises about 17 MiB on Intel; the algorithm supplies the large memory
reduction on both. Do not describe tensor fusion alone as a universal peak-RSS
improvement.

The final program performs 9998 fused row assignments. Typed publication
traffic falls from 573,485,326 cells in the initial unsplit array prototype to
163,983,630 cells (including the small Grundy calculation). This is total
traffic, not live memory. All 24 controlled full runs return
`438505383468410633` modulo 10^18. Full parameters and Grundy values are unchanged.

Raw samples, relevant diagnostics, source hashes, ranges and validation totals:
`baselines/2026-11-04-euler400-followup.json`.

## Correctness and limits

Slot `j` stores the count for target `j-1`, with slot zero equal to one. The
row recurrence depends only on n-1 and n-2. `Stride` is a power of two strictly
greater than every `1 + Gs[n]`, so the XOR selectors stay inside the fixed
stored domain. The special n=0,1,2 behavior is preserved.

Counts and sums exceed safe Number integers. Arithmetic remains exact BigInt,
with existing typed integer output storage and arbitrary-width fallback. New
regressions cover signed inputs beyond 2^53, results beyond signed int64,
selector/domain errors and source locations, empty selectors, retained result
snapshots, replaced native bindings, budgets and cancellation. Existing
independent small-game enumeration remains the algorithm oracle.

Both Mac and Intel pass 508 tests in 29 focused ordinary files, including
`implicit-bitwise-gather`, `fibonacci-tree`, all `tensor-*` tests,
`compiled-array-operations`, `compiler-capabilities` and `interrupt`.
The full default answer is now asserted in both modes in
`fibonacci-tree.test.ts`, alongside boundary and K=1000 checkpoints.
The experiment verifier passes 175 comparisons across 22 orders and the old,
array, scalar and final sources. TypeScript build/test typecheck, semantic
boundary audit, application-form check and whitespace checks pass.
No full suite or exhaustive audit was run. The obsolete full Euler 400
execution-budget exclusion is removed; the full reference now takes seconds.

The initial investigation remains in `euler400-investigation.md`, with raw
exploratory evidence separately labelled. Its original full reference sample
was 239.681 s / 2889.3 MiB; that overlapping exploratory sample is not part of
the controlled timing comparison. The hand-JS three-buffer probe remains
faster and leaner (0.411 s Mac / 0.709 s Intel), but omits runtime initialization,
language guards, polling and diagnostics. It motivates later selector-address
specialization and safe row-buffer reuse; neither is claimed implemented here.

## Reproduce

After building, from the repository root:

```
python3 benchmarks/euler400-series.py /tmp/euler400.jsonl
node benchmarks/experiments/euler400-verify.mjs
```

A single full run:

```
node benchmarks/euler400-followup.mjs demos/euler/400_fibtree.ra 10000
```

Add `reference` as the last argument to disable compilation. The control is:

```
node --import ./benchmarks/experiments/euler400-no-implicit-bitwise.mjs \
  benchmarks/euler400-followup.mjs demos/euler/400_fibtree.ra 10000
```
