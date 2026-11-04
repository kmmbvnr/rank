# Euler 401 initial investigation

This report records the initial research before implementation. See
[euler401-followup.md](euler401-followup.md) for the delivered change and final
measurements.

Base: `44248615`, Node 24.15.0, Apple M5 / Intel i7-10750H.
Only research harnesses and candidate sources were added. Production code and
issue #447 are unchanged.

## Findings

The existing hyperbola algorithm is already O(sqrt(N)) time and bounded batch
space. At N=10^15 it visits 31,622,776 divisors, in 32 blocks. It does not loop
through all N integers. The issue's 87.4 / 51.2 s figures are historical:
a preliminary current-Mac full run was 4.375 s compiled / 5.730 s reference.
Subsequent Mac load rose substantially, so compare variants within the repeated
series rather than comparing those preliminary times with the table below.

The original compiled run published 442,718,864 typed cells in 448 arrays and
executed 96 tensor kernels. There were no copy-on-write copies. Publications
measure allocation traffic, not simultaneous live memory. Two parity-dependent
`choose` operations and the surrounding separately completed arithmetic create
many passes. The profile attributed 0.555 s to `chooseStoredIntegers`, with
substantial further mapping/widening costs. This is runtime overhead on top of
a suitable algorithm, rather than a fundamentally wrong asymptotic algorithm.

## Formula and array candidate

For nonnegative q and M, let x = q mod (6M). Then

    S2(q) mod M = (x (x+1) (2x+1) mod (6M)) / 6.

The polynomial difference at q and x is divisible by 6M, and the retained
remainder is divisible by 6. This removes the parity mask and both `choose`
arrays. Reduce the first product modulo 6M before the next multiplication.
All integer products stay exact BigInt; no rounding through Number is used.

The hyperbola identity, final correction and answer modulus are unchanged.
`euler401-array.ra` uses the original million-cell blocks.
`euler401-array65536.ra` retains the array code with 65,536-cell blocks.
The latter is the best portable candidate measured so far.

Three fresh-process runs per variant per host, alternating forward/reverse
order; medians below. Parsing and diagnostics are included; module imports
are excluded. RSS includes the interpreter process. Other sessions load the
Mac, and the absolute times drifted during its series.

| Variant | Mac seconds / MiB | Intel seconds / MiB |
| --- | ---: | ---: |
| Original compiled | 9.547 / 384.1 | 10.547 / 338.1 |
| Formula, 1M blocks | 6.625 / 340.2 | 8.060 / 341.0 |
| Formula, 64K blocks | 6.313 / 251.8 | 7.761 / 263.4 |
| Fused helper + consumer | 5.389 / 265.7 | 10.079 / 248.1 |
| Formula, 1M reference | 12.289 / 448.1 | 15.369 / 413.2 |

For 64K blocks, the compiled speedups over the original are 1.51x / 1.36x;
peak RSS falls 34% / 22%. The 1M candidate's Intel RSS does not improve.
The smaller blocks reduce live buffers, while total published cells remain
284,604,984; this is not elimination of the intermediate arrays.

## Compiler findings

The lazy sequence variant `euler401-fused.ra` is correct but slower: an initial
Mac full probe was 18.730 s / 176.9 MiB. Simply adding apostrophes is not a fix.
Known range progressions are admitted by the tensor binder only as gather
selectors: arithmetic sequences zip streams, whereas arrays broadcast.
Extending this capability needs an explicit finite sequence traversal proof.
Removing the restrictions wholesale would confuse these semantics.

A helper containing named finite stages can already be proved and emitted as
one consumer loop, without materializing intermediate arithmetic arrays.
The initial direct-return helper is deliberately excluded from ordinary entry
compilation by `planReturn`: forcing it at invocation may change demand/error
timing. A completed consumer, or an explicit completed result in the helper,
provides a valid boundary. Do not just remove the guard.

`euler401-consumer.ra` demonstrates this existing path. It publishes only the
31,622,776 divisor cells in 32 arrays, and executes 32 tensor consumers.
However, the emitted function-plan loop reads the same D cell three times
through `readArrayItem`. An explicit common lazy source in
`euler401-shared.ra` makes the compiler emit one read. Exploratory full runs:
5.188 s / 265.8 MiB Mac, 8.830 s / 247.9 MiB Intel. This helps the Intel fused
path, but does not beat the simple array candidate there. These shared probes
are single runs, not controlled medians.

Useful generic compiler directions:

- Share immutable input reads across one function-plan consumer, with the
  storage, callback, alias and error-location proofs needed to do so safely.
- Specialize checked stored-array reads in function-plan loops, using existing
  storage machinery instead of repeating the generic dispatch on every cell.
- Fuse finite range arithmetic with its reduction while preserving sequence
  zip rules, ordinary assignment completion and lazy demand boundaries.

The current one-loop plan emitter and the tensor emitter already differ in
array access strategy. Thus fewer passes alone do not guarantee lower time on
both CPUs. Prefer the portable array improvement until a compiler experiment
wins on Intel too. No speculative compiler patch is included in this research.

A hand-written BigInt JS loop with the same hyperbola formula gave exploratory
3.823 s / 51.9 MiB Mac, 6.489 s / 54.6 MiB Intel. It omits Rank startup,
publication, cancellation, demand budgets and location/type checks; its memory
is not a like-for-like runtime comparison and its timing is not a guaranteed
compiler target. It shows a remaining constant-factor opportunity.

The scalar Rank loop was correct and used about 175 MiB in an initial Mac
probe, but its 3.244 s was slower than the corresponding 2.955 s array probe.
There is no evidence here to justify replacing the array formulation with it.

## Verification and reproduction

`euler401-verify.mjs` passed 230 comparisons over 23 limits, including zero,
one, square boundaries and 9876, with an independent BigInt divisor-enumeration
oracle. It covers both modes for original, array, fused consumer, shared source
and scalar candidates. All 30 repeated full-scale runs returned `281632621`.
The consumer also passed the existing large two-block checkpoint:
N=2,000,000,000,000 => `679233331`.

No exhaustive audits or production test suites were run: this turn changes no
production code. Follow-up implementation needs focused compiler regression
coverage, the existing Rank demo tests and renewed performance comparisons.

From the repository root:

    node benchmarks/euler401-investigation.mjs SOURCE LIMIT MODE
    python3 benchmarks/experiments/euler401-series.py /tmp/series.jsonl
    node benchmarks/experiments/euler401-verify.mjs
    node benchmarks/experiments/euler401-hand.mjs

MODE is `compiled` or `reference`; defaults are N=10^15 and compiled.
Set PROFILE=/tmp/profile.cpuprofile for a CPU profile. Full diagnostics,
source hashes, series and exploratory probes are preserved in
`baselines/2026-11-04-euler401-investigation.json`.
