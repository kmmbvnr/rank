# Euler 291 investigation and delivery

## Implemented result

Based on `4a7cb2ae`, macOS arm64 / Node v24.15.0. Fresh whole-source runs,
three samples per case, serial and alternating order; parse/JIT included,
imports and baseline-loader transpilation excluded. External host load was
uncontrolled. The frozen baseline restores the three changed interpreter
modules; other dependencies use the same current build.

| Full default | Before | After |
| --- | ---: | ---: |
| Original compiled vs shipping compiled | 3.277 s | 2.790 s |
| Compact demo compiled, isolating runtime changes | 3.832 s | 2.790 s |
| Reference | >90 s, stopped in research phase | 23.332 s |

All completed runs assert `4037526`. New median peak RSS is 695 MiB compiled
and 743 MiB reference. The censored reference baseline is from the earlier
research phase, not a completed timing or a fresh three-sample median.

The demo fixes strict limits, derives its self-prime cutoff, uses `powmod`,
and marks the two roots with strided scalar fills. Blocks are capped at
50 million cells: one block at the default limit, bounded storage for larger
inputs. Full default assertions remain, boundary fixtures were added, and
both program and fixture are restored to the ordinary audit catalogue.

General runtime/compiler changes:

* The ordinary reference interpreter can use its native integer writer for
  a simple scalar `=` into a linear selection with private polling. Compound,
  vector and observable-polling reference paths are unchanged. This narrower
  contract replaces the broader gate-removal research prototype.
* Number loops support scalar integer `=`, `+=`, `-=`, `*=` on trailing
  ranges with scalar prefixes, either stride direction, once-only scalar
  evaluation (also for empty selections), widening and exact overflow replay.
  Array-RHS snapshots/live results are preserved.
* Guarded positional Number `powmod` calls reuse the existing bounded exact
  modular kernel, including cooperative checkpoints. Unsupported domains and
  invalid arguments retain the ordinary exact implementation and errors.

No Number admission threshold changed. The default 50-million-cell external
sieve still uses the exact compiled writer when Number declines its copy;
root preparation uses Number. The new fill lowering benefits other admitted
regions rather than bypassing this policy for Euler 291.

General controls, fresh-process medians:

| Workload | Before | After |
| --- | ---: | ---: |
| Arithmetic plus short scalar fills, compiled | 159.8 ms | 123.1 ms |
| Short scalar fills, reference | 212.4 ms | 166.7 ms |
| Scalar powmod loop, compiled | 172.1 ms | 112.0 ms |
| Plain scalar fills, compiled | 120.5 ms | 125.9 ms |

The plain-fill case did not improve; the native exact writer was already
cheap. Mixed arithmetic benefits from staying in Number registers. Controls
026/104/129 completed correctly. The initial 093 median was 11% slower, so
four additional alternating pairs were run alone: 2220.6 -> 2158.4 ms, with
large variation in both groups. A repeatable 093 slowdown was not established;
small percentages in these host conditions are not reliable claims.

Validation:

* TypeScript build passed.
* 28 focused files / 1263 tests passed with local `--testTimeout 15000`.
  The existing 200-million-iteration negative-stride/while test also exceeded
  its default 5 s on unmodified `4a7cb2ae` (5.601 s), reproduced in a separate
  baseline directory. Its source and checked-in timeout remain unchanged.
* Full compiled Euler 289, 290 and 291 golden tests passed.
* Scoped type/differential checks passed for both 291 files: 4 tests, 4249
  unrelated cases skipped. Full-size defaults and all three fixture blocks ran.
* 122 independent trial-division comparisons passed for shipping code: 61
  distinct limits in each mode, including strict-prime boundaries and zero.
* Native reference fills are additionally compared against the ordinary cell
  writer using non-observing arbitrary host polling to keep that path active.
  Coverage includes aliases, wide values, reverse strides, invalid/empty
  selections, excluded compound/vector/indirect cases, and cancellation.

After integrating concurrent main commit `df78a6ae`, the TypeScript build,
207 focused tests (including its range-map checks), full compiled 291 golden,
and another 122 oracle comparisons passed. Additional whole-source smoke
checks returned the same full answer in both engines (2.660 s compiled and
19.049 s reference, one sample each). These are integration checks, not a
replacement for the three-sample measurements above.

Full package suites/exhaustive audits were not run. Full raw samples,
source hashes and the pre-change research results are retained in the JSON.

```sh
python3 benchmarks/euler291-delivery-series.py 3
node benchmarks/euler291-verify.mjs shipping compiled
node benchmarks/euler291-verify.mjs shipping reference
```

## Pre-change research

Revision: `b37b17407df1c3e0dad8430a131a943e338b1ad7`.
macOS arm64, Node v24.15.0. The research phase left production files unchanged.
At selection, the next unfinished pair in issue #447 was `291_panaitopolprimes.ra` and its fixture.
Both currently have execution-budget exclusions, rather than current timings.

The problem asks for primes **strictly below** the limit:
https://projecteuler.net/problem=291

## Findings

The existing algorithm is already a polynomial sieve, not trial division over
5e15 integers. It sieves approximately 50 million indices of
`f(n) = 2*n*(n+1)+1`, using primes congruent to 1 modulo 4 and their two roots.
The full compiled original returns `4037526` in about four seconds today.
Its default reference run exceeded a 90-second process deadline: preparing
2,081,138 modular roots alone took 54.90 seconds. Do not report 90 seconds as
its completed runtime.

The dominant reference cost is ordinary statement/loop execution. Manual
modular exponentiation repeats many interpreted assignments per prime;
5 sieve blocks repeat the per-prime root-to-index calculations. These costs
are largely removed in the original's two Number-compiled numeric regions.

There are two general execution gaps:

* `eval/assignments.ts` gates the existing native integer selection writer on
  `compilation !== false`. In reference mode a scalar slice fill instead
  allocates operands/replacements and writes individual cells. The `bulk`
  loader experiment enables that existing primitive without enabling JIT.
  On the bounded 1e11 case, counters change from zero bulk writes to 26,032
  writes over 438,735 cells; compiled-loop entries remain zero.
* Number slice lowering currently requires an array-slice RHS. A scalar
  strided fill, `Sv (Start to End by Step) = 1`, is supported by the exact
  compiled backend but loses the Number region. At 1e11, replacing the
  scalar marking loop with slices changes the sieve's Number entries from
  one to zero. This is a useful general compiler improvement to implement
  and verify, not yet implemented in that research phase.

`powmod` also lacks a registered positional Number kernel. A research loader
registers the existing exact safe-integer modular-power kernel, including its
cooperative checkpointed entry. Its isolated full-program improvement was
small relative to observed variation (4.383 -> 4.229 s); that experiment alone
is insufficient to establish a useful speedup.

## A correctness bug, independently reproduced

`Top = ((Limit - 1) // 2) isqrt` can include an index with `f(Top) >= Limit`.
For example, Limit 13 incorrectly returns 2 instead of 1; Limit 100 returns 5
instead of 4. The experiment uses:

```rank
Top = ((((2 * Limit - 3) max 0) isqrt - 1) // 2) max 0
```

This follows `(2*n+1)^2 = 2*f(n)-1` and retains the strict upper bound. The
fixed 6,000-element self-prime exception is replaced with a bound derived
from the sieving-prime limit, capped by Top. This also avoids unnecessary
individual primality checks on small inputs. The unnecessary `+100000`
prime-generation margin is removed.

The independent oracle trial-divides each small `f(n)`. Its 61 distinct
limits include 0, 1, 1e6 and values immediately below, at and above primes of
this form. Original fails 37 cases, including its error at Limit 0.
Corrected variants pass 427 oracle comparisons across seven variant/engine/probe
configurations (61 inputs each). These are arithmetic/demo checks,
not a complete validation of the loader's generic assignment semantics.

## Serial measurements

Timed phase harness: four consecutive executions in one runtime (roots,
small self-primes, block sieve, output). Parsing and JIT are included;
module imports and loader transpilation are excluded. Each sample uses a
fresh Node process. The primary series alternates forward/reverse case
order. No other experiments from this investigation overlapped it; external
host load is uncontrolled. Diagnostics runs are separate.

| Full default variant | Compiled | Reference | Peak RSS |
| --- | ---: | ---: | ---: |
| Original, primary 3-sample median | 4.383 s | >90 s, stopped | compiled 638 MiB |
| Batched roots + one block + paired slices + native reference writer, 3 samples | 5.606 s | 15.676 s | compiled 885 / reference 958 MiB |
| Original, later comparison, 3 samples | 3.972 s | — | compiled 715 MiB |
| Compact powmod + one block + paired slices + native writer/Number powmod probes | 3.362 s, 3 samples | 24.316–25.263 s, 2 samples | compiled 692 / reference 748–752 MiB |

The compact candidate saves about 15% compiled time in the later comparison
and keeps the root computation simpler. Its full reference result is also
`4037526`. It is the better balanced candidate; batched roots gain additional
reference speed but regress compiled time and increase memory.

Simply increasing the block size with the ordinary reference writer reached
2.3 GiB peak RSS. It should not be shipped as an isolated tweak. Enabling the
native selection primitive avoids that large allocation peak in the tested
candidate. Diagnostics reported zero typed unpacks in the small comparisons:
do not attribute this allocation saving to an observed typed-buffer unpack.
Peak RSS is whole-process high-water memory, not retained array storage.

An additional unsplit whole-source run checks that splitting the measurement
into phases did not hide a correctness or compilation failure. Whole-source results were 3.978 s original compiled, 3.343 s compact compiled,
and 24.309 s compact reference, all with the full golden answer. Raw results
and exact sample counts are in the baseline JSON.

## Pre-change implementation priorities

1. Fix the strict bound and derive the self-prime cutoff; add boundary fixtures.
2. Make ordinary integer slice writes use the existing native primitive where
   the interpreter can prove its contract. Test against the ordinary cell path
   for aliases, duplicate indices, overflow, invalid selectors, errors and
   interruption before broadening the reference-mode gate.
3. Add Number lowering for scalar strided fills, retaining RHS evaluation on
   empty selections, checked range arithmetic, private writes and exact replay.
4. Compare the compact `powmod`/paired-slice form again with that compiler
   support. Keep native Number powmod only with an independently verified
   domain/error/checkpoint contract and a measured benefit.

Do not replace the demo with the fastest-reference variant by default: it
currently makes compiled execution slower. Preserve its full golden fixture
and separately add the strict-limit examples. During research, no catalogue lanes or budgets were changed and no GitHub
content was written. Implementation and restored coverage are described above.

## Reproduction

```sh
./node_modules/.bin/tsc -b packages/language packages/interpreter
node benchmarks/euler291-investigation.mjs compiled original 5000000000000000
node benchmarks/euler291-verify.mjs bounded compiled
node benchmarks/euler291-verify.mjs bounded reference
python3 benchmarks/euler291-series.py 3
python3 benchmarks/euler291-series.py 3 --balanced
RANK291_PROBE=both node --import ./benchmarks/experiments/euler291-probe-loader.mjs benchmarks/euler291-investigation.mjs compiled boundedwholepair 5000000000000000
WHOLE=1 RANK291_PROBE=both node --import ./benchmarks/experiments/euler291-probe-loader.mjs benchmarks/euler291-investigation.mjs reference boundedwholepair 5000000000000000
```

`euler291-series.py` reproduces the primary series; later compact-candidate
samples, oracle runs, diagnostics and exploratory results are retained in
`baselines/2026-10-31-euler291-investigation.json`. The initial exploratory
Number-powmod loader lacked cooperative registration; repeated-series and
final compact-candidate measurements use the final cooperative loader.
The research-only phase did not run full package suites or exhaustive audits.
