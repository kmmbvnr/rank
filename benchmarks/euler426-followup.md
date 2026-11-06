# Euler 426: sum closed intervals and grow the live stack

2026-11-06. Full answer **31591886008** is unchanged. The default compiled
program was already fast on current main; the remaining issue was reference
cost and unnecessary storage.

## Program and correctness

The bracket-matching algorithm stores runs of balls. A run of `k` closures
at rounds `v+1` through `v+k` contributes

```
sum(2*r - 1, r=v+1..v+k) = (v+k)^2 - v^2 = k*(2*v+k)
```

Accumulate this contribution directly. The four-million-cell difference
array, its prefix scan and the final weights/gathers are unnecessary. This
also removes the implementation-specific `Cap` argument and its bound on
closing rounds.

Two private stacks retain rounds and run lengths. Check capacity only before
generating a run: a gap can add at most one stack entry, on its last partial
closure, and the following run checks capacity again. Start with at most 1024
cells and double via `concat … copy` when necessary. Existing initialized
entries are preserved; every newly active stack cell is explicitly written
before reading it. Memory follows maximum live depth instead of allocating
two stacks proportional to ten million input runs. A single event loop
alternates generating runs and consuming one compressed stack entry. The
Rank program has one loop and no nested loops.

The old final drain used `Last * 100`, which is zero at `Last=0`. It then
forgot the entire first group of balls. The new drain exceeds the total
possible ball count even at zero: `Last * 64 + 64`. Boundaries now agree with
the independent per-ball oracle: Last 0/1 -> **2116**, Last 2/3 -> **2197**.

## Compiler findings

No new compiler feature or admission threshold is needed. Existing numeric
loop compilation already supports completed concat copies and fresh local
array ownership. Keeping allocation and mutation in one ordinary Rank
function makes the buffers private throughout the compiled region; growing
them still compiles without a numeric replay.

A flattened loop mutating large global buffers was rejected by the existing
conditional-loop copy budget and took about 17 seconds. Moving the same
storage into its consuming function fixes ownership without weakening that
safety/cost policy. A fixed private-stack control used more memory. The
retained growing version gives a better balance.

## Measurements

Node v24.15.0, final paired base `c3dd25fb`. Three alternating fresh-process runs per
variant, same runtime for old and new source. Host load is uncontrolled;
these small timing gains should not be overstated. RSS is process peak,
not retained heap.

| Full Last=10000000 | Original | New |
| --- | ---: | ---: |
| Mac compiled median | 1.308 s | 1.021 s |
| Mac median peak RSS | 387 MiB | 180 MiB |
| Intel compiled median | 2.396 s | 2.152 s |
| Intel median peak RSS | 361 MiB | 170 MiB |

Compiled timing improves about 22% on Mac and 10% on Intel; memory falls by
about half. Three alternating 100000-run reference controls on Mac give
medians **2.806 -> 2.719 s**. This is a small gain, not evidence for a large
full-reference speedup.

Initial single full reference runs were **340.700 s** for the old program and
**358.262 s** for an earlier draft, with peak RSS **232 -> 179 MiB**. That draft
checked stack capacity at every closing event; the final version checks only
before generating a new run. These runs overlapped other work. They establish
full correctness and lower memory, not a reference speed win.

The final full reference run on integrated `c3dd25fb` completed in
**351.798 s**, peak RSS **179.750 MiB**, with the same answer. There is no
measured full-reference speed improvement. Full reference remains outside
the ordinary corpus budget; the delivered gains are compiled timing, memory
and the zero-boundary correction. The older full runs used `5e2099a8`, so
they also do not isolate later runtime integration changes.

## Verification

The existing independent oracle stores one entry per ball rather than one
entry per run; it is shared by the benchmark verifier and full-scale tests.
The verifier compares 32 boundary/checkpoint sizes across reference, exact
compiled and Number compiled execution: **96 comparisons per host**. The
per-ball oracle also checks the full ten-million-run answer independently.

Ordinary cross-mode tests stop at 10000 runs to remain fast. A forced
capacity-two stack control exercises repeated growth with one million runs
and requires numeric compilation without replay. The existing full compiled
golden test now also requires the Number loop and no numeric replay. Full
reference and its default fixture remain manual workloads.

All 21 focused tests pass on Mac and Intel, including after integration with
`c3dd25fb`; the Rank fixture passes in all three modes. TypeScript builds pass.
Earlier integrated reruns are retained separately; Mac wall times vary
substantially under uncontrolled host load, while peak memory remains around 180 MiB.
Exhaustive differential/type audits were not run.

See [raw data](baselines/2026-11-06-euler426-followup.json).
Build with `node node_modules/typescript/bin/tsc -b tsconfig.build.json`.
From `packages/interpreter`:

```sh
node scripts/test.mjs test/euler426.test.ts
node scripts/test.mjs test/full-scale-demos.test.ts -t '426|box-ball'
```

From the repository root:

```sh
node benchmarks/experiments/euler426-verify.mjs
node benchmarks/experiments/euler426-pairs.mjs
```

The runner accepts mode (`compiled`, `exact`, `reference`), Last, and an
optional source path. Original source is retained for reproducible paired
measurements. No runtime changes are hidden in the comparison.
