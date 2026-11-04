# Euler 407 investigation

Historical research on `86719518`. The loader experiments below require
that base; they deliberately reject the delivered runtime. See
[euler407-followup.md](euler407-followup.md) for the production change and
final controlled measurements.

Research base: `86719518`, Node 24.15.0, 2026-11-04.
The live #447 table still lists `407_idempotents.ra` as unfinished,
after completed Euler 404. No issue updates or production fixes were made.

## Findings

The demo enumerates coprime factor splits `n = u v`, `u < v`.
Euler's theorem supplies inverses modulo u. Complementary idempotents
`e` and `n + 1 - e` let the program retain the least nontrivial solution;
the largest is its complement. Prime powers retain M(n)=1.
The full answer remains **39782849136421**.

The split scan visits **about 71 million** candidates at N=10^7.
This is a reasonable O(N log N) search; it is not enumerating every a<n.
The original manual modular-power loop is replaceable by the existing
`Rs E U powmod`. A single compiled control changed 12.69 to 11.68 s;
this alone does not remove the dominant allocation traffic.

The original publishes 166,569 typed arrays, totalling 1,429,015,508 cells
throughout execution. These are publication traffic, NOT live memory.
Its two compiled loops use the publishing backend, not Number regions.
A reference CPU profile also shows copies, array arithmetic and GC.

## Compiler experiment

`experiments/euler407-prototype.mjs` is a runtime load hook; it never edits
production source or built output. It explores:

- rank-one pointwise `choose` and `powmod`, sharing scalar native lowering;
- fresh private evaluation of copied array expressions;
- an explicitly opted-in larger private-copy attempt.

The experiment is NOT a generic correctness-ready implementation.
In particular, it has not established multidimensional ternary broadcasting,
all copy/alias cases, rebinding, error timing, cancellation or budget behavior.

The unchanged source also binds boolean masks and named range selectors
that the present private lowering cannot complete as a single region.
The research sources inline one mask and materialize the store selector.
`euler407-private.ra` includes an artificial scalar assignment after the
array store: its only purpose is to discard the array-valued loop result.
Do not ship that assignment. The incremental variant avoids it naturally.

At small inputs the prototype compiles the main pass to Number. At full
input the ordinary copy policy rejects the 10,000,001-cell destination:
`number-loop:condition-write-budget` (probe cap 262,144, not the 64-cell
small-copy allowance). `RANK407_LARGE_PROBE=1` bypasses ONLY this cost gate
for research. All checked integer arithmetic and overflow replay remain.
This is not evidence for globally raising either threshold. A production
fix should prove sufficient work in range/vector passes, or include the
fresh table allocation in a private region without an artificial wrapper.
Entry-work proofs currently exclude root ranges here and cannot count the
named selector/native-call pattern adequately.

## Program experiment

`euler407-incremental.ra` initializes Least(n)=n, representing M(n)=1.
Every update from Old to New increases the final answer by Old-New.
This eliminates the final dense index/mask/choose/reduction arrays and
makes the loop's last statement a useful scalar accumulation. Invalid
inverse residues propose n, leaving the current minimum unchanged.
The split/inverse algorithm and exact answer are preserved.

This is still research code: short legacy names and the initial phi sieve
need normal style cleanup before a production change. It does not justify
adding helper wrappers solely to obtain compilation.

Removing every `copy` reduces publications but did not show a speed win.
Lazy candidate intermediates pass small checks, but the full run was
stopped; no successful full lazy timing is claimed. A snapshot of Least
is required before mutation; removing that copy from a retained plan
correctly raises the read-only-plan diagnostic.

## Verification and reproduction

`euler407-verify.mjs` makes **168** comparisons: six sources, 14 limits
from 2 through 1000, both compilation settings, against independent
exhaustive search of every a<n. The hook is loaded, but ordinary reference
execution remains disabled for compilation. Full measured runs assert the
existing full golden answer. This is not a full compiler regression suite;
no exhaustive audits or full npm test were run.

Run from repository root after the ordinary TypeScript build:

```sh
node --import ./benchmarks/experiments/euler407-prototype.mjs \
  benchmarks/experiments/euler407-verify.mjs
python3 benchmarks/experiments/euler407-series.py
python3 benchmarks/experiments/euler407-incremental-series.py
node benchmarks/experiments/euler407-hand.mjs
```

The series use the existing Euler 404 generic execution harness with
explicit source and limit arguments. Module imports precede timing;
parsing and execution are timed, peak RSS covers the whole process.
Each timed run is a fresh process; compiled variants have three samples,
reference variants one. The initial series alternates variant order.
The Mac was busy with unrelated sessions: absolute timings are variable.
Manual JS uses the same split/inverse mathematics and typed buffers,
but omits Rank's observable state, replay, polling and error contracts.
It shows headroom, not an equivalent implementation ready to substitute.

Measured summaries and raw samples are in the adjacent baseline JSON.

## Measured results

Seconds / MiB, medians of three compiled fresh processes:

| Variant | Mac M5 | Intel i7-10750H |
| --- | ---: | ---: |
| Original compiled | 27.564 / 1351.5 | 32.903 / 917.5 |
| Private compiler prototype | 10.295 / 710.0 | 11.396 / 554.6 |
| Incremental + compiler prototype | 4.840 / 653.3 | 10.575 / 534.2 |

The incremental series ran in a later phase; do not treat the ratio to
the earlier original as a stable same-load speedup. The alternating
private-only series gives 2.68x Mac / 2.89x Intel, with roughly 47% / 40%
lower peak RSS. An earlier original Mac sample was only 12.69 s.

Reference single samples, original to powmod-only: Mac 38.740 to 22.455 s,
1480.5 to 1401.1 MiB; Intel 48.862 to 45.043 s, 1182.3 to 1200.4 MiB.
Manual JS: Mac 0.836 s / 112.0 MiB; Intel 1.673 s / 108.2 MiB.

The incremental source on the ordinary compiler took 20.222 s /
1312.4 MiB in one Mac control. With prototype it publishes only about
10 million typed cells (principally the final table), down from
1.429 billion original publication cells. Checked execution is still
well above the manual JS lower-contract control.
