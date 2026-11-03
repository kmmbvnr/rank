# Euler 365: exact partial totals and scalar tensor reads

The algorithm computes Lucas residues, pairwise modular inverses, then Garner
CRT reconstruction for C(501, 3) = 20,833,250 prime triples. The full answer
remains **162619462356610313**. Independent JavaScript reconstruction agrees.

## Delivered changes

The demo stores one partial total per outer iteration and applies an exact
`sum` at the end. This keeps default-input CRT arithmetic in the checked Number
loop instead of switching to mixed arithmetic for the large final total.
There are only 501 partial totals. Larger values retain normal checked-loop
fallback to exact arithmetic; no unchecked narrowing was introduced.

The interpreter now reads full scalar coordinates of multidimensional arrays
without allocating selector lists or traversing general selector dispatch.
The path uses live `readArrayItem` storage access for integers, reals, text,
missing cells and views. Noninteger addresses, partial selections and extra
selectors use the existing path. Bounds errors preserve axis and value details.
This is a general reference-interpreter improvement, not a new compiler backend.

## Measurements

Mac arm64, Node v24.15.0, worktree based on e91fe64e with unrelated existing
changes. Other machine work was running. Compiled times are medians of three
fresh processes, alternating original and production. Reference timings are
single observations. Do not infer Intel results or an isolated release result.

| Workload | Before | After |
| --- | ---: | ---: |
| Full compiled | 0.818 s | 0.499 s |
| Compiled peak RSS | 198.3 MiB | 197.8 MiB |
| Full reference | 45.886 s | 44.205 s |
| Reference peak RSS | 312.4 MiB | 313.8 MiB |
| One million scalar matrix reads | 168.4 ms, general path | 94.1 ms, fast path |

Compiled speed improves by about **1.64x**, with essentially unchanged memory.
The small end-to-end reference difference is not enough to claim a stable
speedup under this load. Most reference time remains ordinary expression,
application and binding dispatch over the CRT triples. A sampled original
profile attributed 44.393 of 45.886 unprofiled seconds to CRT reconstruction.

An array-only inner-loop experiment improved reference to 11.787 s but used
1034 MiB, while compiled execution regressed to 12.146 s / 634 MiB. It was not
adopted. The compiled array sample overlapped a reference profiling process.

An independent handwritten JS implementation took 0.065 s / 59 MiB in one run,
including 0.054 s for CRT. It omits Rank parsing, runtime contracts, publication,
checkpoints and error behavior, so this indicates algorithmic cost rather than
a promised compiler target. It also uses checked-by-input numeric partials;
Rank continues to provide exact fallback for other inputs.

## Verification and reproduction

The fixture retains Lucas/CRT examples and adds Lucas zero/identity cases,
fewer than three primes, an independently calculated single CRT triple and
the full golden answer. Scoped differential verification covers the standalone
program and fixture in both engines. Focused selector tests compare the new
path with general selection across storage types, missing cells, dimensions,
bounds errors, invalid selectors, live writes and rebinding: 195 focused tests
passed. TypeScript builds. The standalone differential case took 87.4 s
(reference 87.0 s, compiled 0.394 s); the six-block fixture took 94.2 s.
Those source-based audit runs have different overhead from built-runtime timings.
The historical full-program reference-budget exclusion was removed.

```
node benchmarks/euler365-investigation.mjs original compiled
node benchmarks/euler365-investigation.mjs production compiled
node benchmarks/euler365-investigation.mjs production reference
node benchmarks/euler365-investigation.mjs array reference
node benchmarks/experiments/euler365-manual.mjs
```

Set `DIAG=1` for diagnostics or `PROFILE=/tmp/365.cpuprofile` for a CPU profile.
`experiments/euler365-original.ra` preserves the initial workload for repeatable
comparisons. Raw observations, including earlier exploratory runs, are in
`baselines/2026-11-03-euler365-investigation.json`. No full audit was run.
