# Euler 764: keep column-broadcast masks packed

Issue: https://github.com/kmmbvnr/rank/issues/557

The full input remains Limit=10^16 and Mod=10^9; the answer remains `255228881`.
The three parametric families, rectangular search bounds, equations and GCD
kernel are unchanged. The existing compact broadcast GCD was not the main
remaining bottleneck: the final column-mask broadcast lost the packed Boolean
recipe, making the selection read Boolean cells individually.

## Runtime change

The packed Boolean recipe already supported equal shapes and broadcasting a
row. It now also supports broadcasting an R-by-1 column over an R-by-C matrix,
for `and`, `or` and `xor`, in either operand order. Each output word repeats
column bits across its rows, including words that straddle row boundaries.
A zero-width output reads no input. The recipe composes with existing row
broadcasts, resolves the source at demand time and retains deferred validation.
No boxed Boolean matrix or problem-specific kernel is introduced.

This changes language implementation before changing the demo. With the
original Block=256, the full run fell from 43.27 to 19.54 seconds on Mac and
from 117.46 to 47.01 seconds on Intel. These are single uninstrumented baseline
and intermediate samples, not estimates of timing variance. They already
establish the main improvement without a source change.

The only demo edit reduces Block from 256 to 64 rows to lower peak memory.
The algorithm, number of candidate pairs and full answer are preserved.

## Measurement method

Base revision: `ba3fa2e4`. Apple M5 arm64 and Intel i7-10750H x64, Node 24.15.0.
Each sample starts a fresh process. Times include parsing and exclude module
imports; CPU time and peak process RSS are recorded separately. There is one
original full baseline and three final samples per host. Baseline variance was
not measured; other host activity and frequency are not controlled. No samples
are discarded. Diagnostic profiles are separate from primary timings.

The full baseline profile samples `readArrayItem`, expansion and generic
operation dispatch much more often than GCD. A smaller Limit=10^14 diagnostic
run also showed generic operand expansion and reads. Its instrumented timing
is not pooled with the uninstrumented timing series.

The Intel baseline build contains the same interpreter code as `ba3fa2e4`;
the intervening commits after the previous task changed demos and reports.
Raw samples and profile summaries are in `results/euler764/`. The original
source is frozen in `fixtures/euler764-original.ra`.

## Full-input results

| Host | Original seconds | Final seconds | Median speedup | Original peak MiB | Final median peak MiB |
| --- | ---: | --- | ---: | ---: | ---: |
| Mac | 43.27 | 18.61 / 18.40 / 18.38 | 2.35x | 623.08 | 469.42 |
| Intel | 117.46 | 44.99 / 45.82 / 45.24 | 2.60x | 641.63 | 416.16 |

## Reproduction

Build the chosen runtime before invoking the harness:

```sh
EXPECTED=255228881 node benchmarks/euler764.mjs 10000000000000000 64
RANK_SOURCE=benchmarks/fixtures/euler764-original.ra \
  EXPECTED=255228881 node benchmarks/euler764.mjs 10000000000000000 256
```

Use the original runtime for the original baseline. `RANK_ROOT` selects an
independent built checkout. A fourth argument `reference` disables compilation;
`DIAGNOSTICS=1` and `PROFILE=path.cpuprofile` enable separate profiling runs.

## Verification

Tests enumerate the original equation `16*x*x + y^4 = z*z` and primitive
positive triples at small limits, independently of the three parameter grids.
They cover Block=1, 3, 64 and 256 in both execution modes and the
[published example values](https://projecteuler.net/problem=764).
Packed-mask tests cover both operand orders, all three Boolean operations,
empty axes, word and row tails, counting, selection positions, source mutation
and composition with a row mask. All full runs produce `255228881`.

All 175 focused tests passed on each host. TypeScript build, 65-owner semantic
boundaries, application-form checks and five exclusion-policy tests passed.

The under-30-second issue target is met on Mac, not on this Intel host. The
full demo remains excluded from corpus audits because it still takes tens of
seconds. Full suites and exhaustive audits were not run.

Runtime change: `a254407e`. Demo and equation tests: `71689027`.
