# Euler 407: private ternary vectors and fewer arrays

Measurement base: `a953e835` plus this change, Node 24.15.0,
Apple M5 arm64 and Intel i7-10750H x64, 2026-11-04.
Full default N=10^7, answer **39782849136421**.

## Program

The coprime factor-split algorithm is retained. It visits about 71 million
pairs, not every candidate idempotent a<n. Library `powmod` replaces the
manual nested modular-power loop. A small broadcast table computes phi(n)
exactly as `n // rad(n) * product(p-1)` over distinct prime divisors.
A short `totients` function releases these preparation matrices before
the large pass. This retains one loop and no floating-point totient arithmetic.

`Least(n)=n` initially represents M(n)=1. Updating Least from Old to New
increases the final answer by Old-New. The total is accumulated immediately,
removing the final N-cell index, mask and choose arrays. Noninvertible residues
propose n and cannot lower the existing value. N=0 and N=1 return zero.
The original Rank fixture and full input/golden are unchanged.
Production Rank lines stay within 40 columns; no compilation-only helper or
artificial scalar assignment is needed.

## General compiler changes

- Integer pointwise `powmod` and homogeneous integer/real `choose` lower
  inside private numeric regions. Shapes broadcast over all three inputs,
  including multidimensional and scalar operands. Both choose branches
  remain eager. Invalid modular domains, shape failures and unsafe integers
  replay the original execution, retaining demand order and diagnostics.
- Fresh computed array copies avoid a duplicate buffer. Named arrays keep
  their copy/snapshot path. Native identities remain guarded.
- Copy-cost entry proofs include finite range loops and completed named
  range selectors. They inspect at most four arithmetic entry positions,
  not body arrays or callbacks. Pure guarded native calls are permitted;
  ordinary helpers, mutable bounds and escaping control stay conservative.
  The 64-cell allowance and 262144-cell probe cap are unchanged.
- Array-element contracts are proved before private publication, without
  observing cells or refining contracts. A conflicting rebind falls back
  rather than reporting a late error at the loop header.

These changes do not remove integer precision checks, change ordinary `=`
completion, or make unreferenced lazy bindings execute early. Boolean array
results and mixed numeric element kinds retain the existing fallback.

## Verification

- Mac and Intel: **1239 distinct tests in 39 files** pass, including full
  Euler 407 in both engines, vector operations, mixed exact arithmetic,
  copy/work admission, aliases, interruption, composable regions and binding
  contracts. Forty new edge cases were rerun after final fixture refinements.
- Independent exhaustive a<n enumeration covers 16 small limits from 0 to
  1000 in both modes, including prime powers and the first mixed factors.
- Mac scoped audits: Euler 407 main and fixture pass differential (2),
  inferred types (2), and name facts (2). Main removed from execution-budget
  exclusions; the small fixture stays unchanged.
- TypeScript build including test types, semantic boundaries, application
  forms and whitespace checks pass. No exhaustive audit/full npm test.

## Measurement method

`experiments/euler407-final-series.py` launches three fresh compiled processes
per source/control, alternating forward/reverse order, followed by one fresh
reference run per source. Parsing and execution are timed after module imports
and Interpreter construction. Peak RSS covers the whole process. All 22 runs
assert the full golden. Samples are sequential on each host. The shared Mac
has unrelated load, so absolute timings vary.

`euler407-no-ternary.mjs` disables only the new private ternary admission in
memory. The final Rank source and all other compiler changes stay identical;
this isolates the value of admitting the complete numeric loop. It is a
research control, not a runtime option. No generated files are edited.

Historical load-hook prototypes and manual JS timings are recorded separately
in [the initial investigation](euler407-investigation.md). They are not the
final production measurements.

## Results

Seconds / MiB, three-sample compiled medians:

| Variant | Mac M5 | Intel i7-10750H |
| --- | ---: | ---: |
| Original compiled | 14.847 / 1255.3 | 29.634 / 917.6 |
| Final compiled | 4.972 / 513.6 | 8.624 / 495.8 |
| Same final source, ternary admission disabled | 15.140 / 1223.6 | 28.706 / 885.9 |

Compiled speedup is **2.99x Mac / 3.44x Intel**. Peak RSS falls about
**59% / 46%**. Same-source compiler controls show **3.05x / 3.33x**
speedups. One Number loop handles the main scan without overflow or copy
probes. Typed publication traffic falls from 166,569 arrays / 1,429,015,508
cells to 20 arrays / 14,250,189 cells. Traffic is not simultaneous live RAM.

Reference single samples:

| Source | Mac seconds / MiB | Intel seconds / MiB |
| --- | ---: | ---: |
| Original | 18.294 / 1441.8 | 42.895 / 1186.0 |
| Final | 18.766 / 1257.8 | 38.986 / 1201.1 |

Mac reference time is 2.6% higher in this single comparison; Intel time
is 9.1% lower. Mac reference RSS is 12.8% lower, Intel RSS 1.3% higher.
These noisy single samples do not establish a reference speedup on both
architectures or a memory reduction in every execution mode.

Earlier unscoped totient preparation samples and their exact Rank source
are retained in the raw record. Scoping preparation reduced a separate
Mac reference sample from 1353.6 to 1236.9 MiB. Final measurements above
use the scoped version on both hosts.

[Raw samples, source hashes and verification](baselines/2026-11-04-euler407-followup.json).
