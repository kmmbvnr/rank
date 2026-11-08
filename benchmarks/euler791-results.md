# Euler 791: numeric deferred interval sums

Issue: https://github.com/kmmbvnr/rank/issues/560

The default `Limit=100000000`, modulus `433494437` and answer `404890862`
are unchanged. The solution retains the odd-triple transformation, its one
outer loop, the same pairs and the same two possible intervals of odd w.

## Compiler and storage

The numeric scalar-function compiler already used the shared tensor emitter,
which supports dyadic `min` and `max`. Its eligibility check nevertheless
rejected these nodes inside a deferred sum. Admitting recursively supported
dyadic extremes lets the entire helper run in checked Number registers.
Integer input, intermediate and reduction overflow still replay exactly;
unsupported shapes, callbacks and observable demand retain existing guards.
No syntax, language semantics or problem-specific compiler rule was added.

The Rank helper now consumes its own count, linear and square terms as
`Name'` deferred bindings, returning a scalar modular sum instead of a
three-row array of intermediate results. The generated consumer shares the
arithmetic in one traversal. The caller no longer indexes and combines the
three returned arrays. Readable single-assignment names replace reused bounds.

The two interval contributions can be divided by two separately: for odd
u, v and w, `u*u + v*v + w*w + 2*(u+v+w) + 3` is even. Modular addition then
commutes with interval and row summation, including a negative nonzero modulus.
The redundant validity mask is removed: with `Edge = Reach-u*u-4*u-1`,
`Rest = Edge-(v+2)^2`, and the chosen top ensures `v+2 <= floor(sqrt(Edge))`.
Rows without eligible v are empty. The independent tests include empty rows,
the small central gap and several positive and negative moduli.

## Measurements

Base revision: `ed0daec2`. Node 24.15.0 on Apple M5 arm64 and Intel i7-10750H x64.
One original baseline and three final fresh processes per host. Timings include
parsing, exclude module imports, and report process peak RSS. Baseline variance
was not measured; host load/frequency were uncontrolled. No final samples were
removed. These are local measurements, not published nightly results.

| Host | Original seconds | Final seconds | Median speedup | Original peak MiB | Final median peak MiB |
| --- | ---: | --- | ---: | ---: | ---: |
| Mac | 59.74 | 17.46 / 17.58 / 17.59 | 3.40x | 1055.78 | 275.09 |
| Intel | 141.07 | 47.41 / 46.44 / 44.72 | 3.04x | 413.86 | 263.00 |

The under-30-second target is met on Mac, not on this Intel host. The full demo
remains excluded from corpus audits because it still adds substantial runtime.

With deferred scalar sums but without the compiler fix, single full runs took
39.65 s / 373 MiB on Mac and 119.73 s / 341 MiB on Intel. This intermediate
source used the same arithmetic before the final variable renames and split
expressions. It is not pooled with the final timing samples.

An independent clamp-sum control measures the compiler change without any
Euler formula: sixteen passes over 262144 stored integers, applying `max -1000`
and `min 5000`, then summing. Three fresh-process before/after pairs on Mac
measured 181.64 ms versus 99.06 ms by median. The control checks against a
separate JavaScript sum. Timings include Rank parsing and function preparation.

At Limit=1000000, original diagnostic counters recorded 41603923 published
typed cells. The final diagnostic records one compiled Number loop and 2826
numeric helper calls. These counts explain the avoided intermediate storage;
they are not full-input time ratios. The original diagnostic used CPU profiling,
so its timing is not directly comparable with the final diagnostic.

## Verification

248 focused tests passed on both Mac and Intel across nine files, covering
function plans, scalar compiler behavior, exact overflow replay, demand errors,
array aliases and deferred bindings. The Euler tests enumerate ordered
quadruples independently through Limit=25, check the
[published S(1000)](https://projecteuler.net/problem=791), and compare the frozen
original at Limits 7, 31, 128 and 1001 with moduli 1, 2, 7, -7 and 433494437.
Both compiled and reference execution are covered. All full-input runs retained
`404890862`.

The TypeScript build, application-form checks, 65 semantic-owner checks and
13 policy tests passed. Full suites and exhaustive corpus audits were not run.

After merging concurrent main changes at `06fbf90a` (Euler 484 tensor work),
the build, five exclusion-policy checks and 298 focused tests passed on Mac.
A separate full-input integration run retained `404890862` in 17.59 s
with 275 MiB peak RSS. It is not pooled with the timing series above.
Implementation commits: `6fe2caa6` (compiler) and `056f189f` (solution and oracle).

## Reproduction

Build each checkout before timing. Use the base checkout for the original
runtime, and the frozen original source when comparing the original solution:

```sh
node node_modules/typescript/bin/tsc -b tsconfig.build.json
EXPECTED=404890862 node benchmarks/euler791.mjs
RANK_ROOT=/path/to/base RANK_SOURCE=benchmarks/fixtures/euler791-original.ra \
  EXPECTED=404890862 node benchmarks/euler791.mjs
node benchmarks/experiments/euler791-extreme.mjs
```

The first argument changes Limit; a second argument `reference` disables
compilation. `DIAGNOSTICS=1` and `PROFILE=path.cpuprofile` enable separate
instrumentation. Raw measurements and test logs are in `results/euler791/`.
