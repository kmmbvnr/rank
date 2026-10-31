# FFT profile and JavaScript comparison

Measured on 2026-10-31, Apple M5, Node v24.15.0. The workload is
[`demos/classic/fft.ra`](../demos/classic/fft.ra): a real-input, radix-2 DIF
FFT expressed with reshape, axis unpacking and array arithmetic.
The demo prints the real and imaginary spectrum of `1 2 3 4`.

## Baseline timing

Times below are milliseconds per complete transform. Each cell is the median
of five serial fresh-process samples. Each worker warms its implementation
for at least 300 ms, then measures a batch targeting 150 ms. Parsing, input
generation and correctness checks are outside the timed region. Both output
arrays are forced inside the Rank measurement. Roots, output permutation and
temporary buffers are included unless the row explicitly reuses a plan.

| Implementation | N=256 | N=1024 | N=4096 |
| --- | ---: | ---: | ---: |
| Rank, compilation enabled | 2.607 | 4.530 | 11.983 |
| Rank, all compilation disabled | 2.552 | 5.233 | 12.799 |
| JS, separate array passes | 0.04951 | 0.15949 | 0.74553 |
| JS, butterflies updated in place | 0.02752 | 0.10589 | 0.44607 |
| fft.js 4.0.4, new plan and output each call | 0.004531 | 0.017367 | 0.069361 |
| fft.js 4.0.4, reused plan and output | 0.000759 | 0.004355 | 0.016452 |

The two handwritten JS controls use the same DIF radix-2 algorithm and
bit-reversal ordering as Rank. The separate-pass control retains intermediate
arrays for differences and rotations. Both controls use typed buffers.
They are algorithm controls, not models of every Rank runtime check.

[fft.js](https://github.com/indutny/fft.js) uses radix-4/radix-2 kernels and a
specialized real transform. The harness calls `realTransform` followed by
`completeSpectrum`, so every comparison produces the full complex spectrum.
The library stores interleaved values; Rank returns separate real and imaginary
arrays. Conversion between these layouts is excluded. Reuse mode also excludes
plan and output allocation; setup mode includes them. This is a tested optimized
pure-JS baseline, not proof that it is the fastest implementation on every engine.
No native FFT library or WebAssembly is used.

At N=4096, Rank is about 173 times slower than fft.js with setup included and
728 times slower than its reusable-plan path. The compiler improves the median
by about 6%, but the timing ranges overlap widely: compiled 9.37–22.28 ms,
reference 10.44–23.23 ms. This run does not establish a reliable compiler speedup.
Other host activity was not controlled. The earlier exploratory chat timings
used less warmup and should not be compared as a before/after optimization.

## CPU and compiler findings

CPU and allocation profiles were separate from the timing series. The compiled
CPU profile repeatedly transforms N=4096 for about 2.5 seconds after warmup.
The following CPU categories include their callees, may overlap and must not
be summed:

| Category | Sampled CPU time |
| --- | ---: |
| Array binding contracts and element-kind checks | 26.3% |
| Block copying used by concatenation | 13.0% |
| Materializing selected views, including axis unpacking | 10.6% |
| Garbage collection | 4.3% |
| Reshape routines | 1.1% |

`storedScalarKinds` is the largest individual self-time entry. Binding checks
request exact element kinds, including the distinction between finite reals
and numeric limits. The compiled diagnostic call performs 166 type scans over
407,548 cells; the reference call performs 238 scans over 555,004 cells.
These are repeated scans of temporary arrays, not distinct input elements.

The main FFT stage loop falls back at `AllAxisExpression`, the inferred `#`
dimension in reshape. This is the first reported blocker; removing it alone
does not demonstrate that the rest of the loop can compile. The bit-reversal
loop does compile. Each FFT call executes 24 compiled tensor kernels, covering
the two complex-rotation expressions on each of the 12 stages.

A second call at the same size emits the same 24 tensor kernel source strings
again. The generated source embeds stage-dependent shapes and strides. The
ordinary tensor statement path retains one layout, while its multi-layout
variants currently cover concat expressions. Consequently the rotation kernels
cycle through their stage layouts and regenerate code. The emission hook is
called only when executable code is generated. This is a compiler-cache issue,
but CPU sampling puts array scans and data movement ahead of code emission.

Allocation sampling estimates about 11.4 MB of V8-managed allocations per
compiled transform at N=4096, including short-lived collected objects. This is
not retained memory, peak RSS or a complete accounting of ArrayBuffer backing
storage. The reusable fft.js path allocates almost no JS heap per transform.

The first optimization candidates are preserving exact element-kind evidence
through numeric kernels, reducing materialization during axis unpacking and
concat, and caching repeated tensor layouts. These require preserving Rank's
numeric-limit, error and value-sharing contracts. These profiles describe the
baseline before the cache repair below.

## Cache repair

The compiler now retains bounded executable variants for all tensor kernels,
extending the existing concat cache to recurring broadcast shapes. Each entry
contains executable code and source text, not input buffers. The existing
256-layout limit and runtime guards are unchanged.

The regression test cycles through four broadcast shapes three times, changing
both input buffers and scalar values. It checks the numerical results and
requires only four compilations. Before the repair it fails on the second
cycle with eight compilations. In the FFT diagnostic, a repeated N=4096 call
now executes 24 kernels and compiles zero new kernels, compared with 24 new
compilations in the baseline.

The new timing series compares a saved build of `29f6185b` against the same
revision plus the cache repair. Baseline and candidate run in alternating
order in serial fresh processes; both use the unchanged FFT demo. Five samples
per size use the same warmup and batch method as above.

| N | Before, ms | After, ms | Before / after |
| --- | ---: | ---: | ---: |
| 256 | 2.693 | 2.386 | 1.129 |
| 1024 | 4.978 | 4.777 | 1.042 |
| 4096 | 10.211 | 9.991 | 1.022 |

The cache defect is fixed, but this is a small end-to-end change. Timing ranges
overlap and include large outliers: at N=4096, baseline 10.03–35.97 ms and
candidate 9.65–33.95 ms. These samples do not establish a stable 2% speedup.
The strongest remaining costs are the array checks and data movement measured
above. The reusable fft.js control in this new series takes 0.01781 ms at
N=4096; the cache repair does not close that gap.

Validation after the repair: TypeScript build, 448 ordinary interpreter test
files with 10,300 passing tests, and the classic demo tests. The exhaustive
types, differential and Nurikabe audits were excluded. The interpreter suite
ran before the benchmark series, not concurrently with it.

Evidence: [before/after timing samples](baselines/2026-10-31-fft-cache-comparison.json)
and [post-repair diagnostics](baselines/2026-10-31-fft-cache-diagnostics.json).

## Incremental improvements

Each step compares against the immediately preceding build in alternating,
serial fresh processes, with five samples per size. The tables report measured
medians, not an estimate of the speedup of several changes combined.

### Step 1: retain exact domains when materializing numeric selections

Selected native numeric cells already have a proved uniform physical domain.
The materialized buffer now keeps that evidence, including the distinction
between `real` (which includes NaN) and `numeric-limit` (infinities).
Compiled outputs and contiguous slices already retained this information;
this change fixes the remaining noncontiguous selection path.

At N=4096, a warm FFT drops from 166 type scans over 407,548 cells to 102 scans
over 313,344 cells. Runtime guards and mixed-domain fallback are unchanged.

| N | Before, ms | After, ms |
| --- | ---: | ---: |
| 256 | 1.950 | 1.907 |
| 1024 | 4.211 | 3.971 |
| 4096 | 8.412 | 7.874 |

The N=4096 median decreases by about 6.4%; there are timing outliers and
overlapping ranges. Tests cover gathered finite reals, NaN and infinities,
binding boundaries, aliasing and numeric guards. FFT results still agree with
the direct DFT.

Evidence: [step 1 timing](baselines/2026-10-31-fft-step1.json) and
[diagnostics](baselines/2026-10-31-fft-step1-diagnostics.json).

### Step 2: prefer existing native block-copy plans

Materialization now tries the registered native copy plan before the general
per-cell selection copier. Contiguous slices still share storage first. A
selection with contiguous trailing runs can use checked `TypedArray.set`
blocks; irregular gathers retain the general path. This preserves the same
completed values and copy-on-write isolation.

| N | Before, ms | After, ms |
| --- | ---: | ---: |
| 256 | 2.357 | 2.352 |
| 1024 | 4.628 | 4.637 |
| 4096 | 9.082 | 8.492 |

The N=4096 median decreases by 6.5%. Smaller inputs show no clear improvement;
ranges overlap. The 148 focused tests include axis-unpacked blocks remaining
independent after writes to either the source or a result, in both compilation
modes. This improves materialization, not zero-copy strided views or whole-loop
compilation.

Evidence: [step 2 timing](baselines/2026-10-31-fft-step2.json).

## Reproduction and checks

```sh
npm run langium:generate
node node_modules/typescript/bin/tsc -b tsconfig.build.json
npm pack fft.js@4.0.4 --pack-destination /tmp --ignore-scripts \
  --cache /tmp/rank-fft-npm-cache
mkdir -p /tmp/rank-fft-library
tar -xzf /tmp/fft.js-4.0.4.tgz -C /tmp/rank-fft-library
node benchmarks/fft.mjs --samples=5 \
  --fftjs=/tmp/rank-fft-library/package/lib/fft.js \
  --output=/tmp/fft-timings.json
node benchmarks/fft.mjs --worker=compiled --size=4096 \
  --diagnostics --output=/tmp/fft-diagnostics.json
node benchmarks/fft.mjs --worker=compiled --size=4096 \
  --profile=cpu --output=/tmp/fft.cpuprofile
node benchmarks/fft.mjs --worker=compiled --size=4096 \
  --profile=allocation --output=/tmp/fft.heapprofile
```

For a before/after comparison, build an unchanged checkout separately and pass
its root with `--baseline=/path/to/baseline`. Select
`--modes=baseline,compiled,reference,fftjs-reuse` to reproduce the comparison
series. `--checkout` selects the candidate build; it defaults to this checkout.

Use `--worker=reference` for the uncompiled profiles. The library is downloaded
only for benchmarking; workspace dependencies and lockfiles are unchanged.
Small Rank and handwritten JS results are checked against an independent
direct DFT. All timed implementations are compared over both full output
components with absolute/relative tolerances. The five FFT demo tests and all
seven classic test files pass; `rank check demos/classic/fft.ra` also passes.

Raw evidence: [timings](baselines/2026-10-31-fft.json),
[CPU and allocation summaries](baselines/2026-10-31-fft-profiles.json),
[compiled diagnostics and generated code](baselines/2026-10-31-fft-compiled-diagnostics.json),
[reference diagnostics](baselines/2026-10-31-fft-reference-diagnostics.json).
