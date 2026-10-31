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

### Step 3: fuse adjacent real-array arithmetic assignments

A compiled loop block can now group up to eight adjacent pure real-array
assignments into one kernel. It supports checked `+`, `-`, `*`, `/`, trailing
broadcasts and dependent intermediate values. Each named output is still
materialized and committed in the original order through the normal binding
and mutation checks. Calls and structural operations terminate a region.
Guard failure writes no published buffer and falls back to the original
statements. Observable cancellation, generators and finally blocks retain
ordinary dispatch. Executable variants are bounded to 32 per region.

The initial unrestricted version added overhead on short vectors, so the
selected path uses the existing 1024-cell dense-kernel minimum. Unsupported
regions do not retry overlapping suffixes. In FFT the four assignments to
`Dr`, `Di`, `Tr` and `Ti` become one kernel per stage at N=4096: 12 executions
instead of 24. Type scans drop to 80 over 268,288 cells. The reshape, unpack
and concat operations remain outside this arithmetic region.

| N | Before, ms | After, ms |
| --- | ---: | ---: |
| 256 | 4.710 | 2.087 |
| 1024 | 4.139 | 4.266 |
| 4096 | 7.872 | 7.251 |

The N=4096 median decreases by about 7.9%. Fusion is inactive for the two smaller
FFT sizes, whose stage outputs are below the dense minimum. Their inconsistent
timings, particularly the apparent N=256 speedup, show uncontrolled host noise
and must not be credited to fusion. No improvement is established at N=1024.

Validation includes an ordinary 449-file run with 10,316 passing tests and
focused reruns after adding the dense minimum and non-overlapping planning.
New tests cover dependent outputs, broadcasts, signed zero, NaN, infinities,
overflow, division failure, preserved earlier assignments, retained values,
unproved host objects and observable cancellation.

Evidence: [selected step 3](baselines/2026-10-31-fft-step3.json),
[diagnostics](baselines/2026-10-31-fft-step3-diagnostics.json),
[initial unrestricted control](baselines/2026-10-31-fft-step3-unthresholded.json)
and [overlapping-planning control](baselines/2026-10-31-fft-step3-thresholded-overlap.json).

### Step 4: recycle unpublished region buffers within one loop invocation

Each region now keeps at most two output banks, keyed weakly by the running
loop's control object. A bank can be reused only when its arrays have one
tracked owner, no pending views or aliases, no overlap with any input buffer,
and none of the region's current bindings still publishes them. Boxed,
read-only or otherwise unproved storage is excluded. A new function call or
re-entry into the same parsed loop gets an independent pool. With direct loop
control disabled, recycling is disabled too.

Speculation still writes only unpublished buffers. If arithmetic declines,
the bank is discarded and ordinary statement evaluation preserves existing
values and error order. Successful outputs get fresh array wrappers, exact
real-domain evidence and the ordinary binding/mutation checks.

At N=4096 the diagnostic records 36 reused buffers, or 73,728 cells (589,824
bytes of Float64 backing storage) per FFT call. This measures allocation traffic
avoided for the fused arithmetic outputs, not peak or retained process memory.

| N | Before, ms | After, ms | Before CPU ms | After CPU ms |
| --- | ---: | ---: | ---: | ---: |
| 256 | 3.109 | 3.159 | 5.440 | 5.413 |
| 1024 | 6.707 | 6.918 | 11.371 | 10.692 |
| 4096 | 10.016 | 9.325 | 16.247 | 13.800 |

The N=4096 wall median decreases by 6.9%. Pooling is inactive at the two smaller
FFT sizes; their differences cannot establish a benefit. CPU measurements
include the process's user and system time across V8 helper threads and can
exceed elapsed wall time. The harness records both metrics from this step on.
All series have wide ranges under uncontrolled host load.

The final ordinary interpreter run passed 448 files and 10,320 tests, with one
failure in a newly added test fixture: its final `C` read was outside the
variable's lexical block. The fixture now declares its outputs before the
loop; all 17 tests in that file pass on rerun. Together these runs verify all
449 ordinary files and 10,321 tests against the final production code. No
production change was needed for that fixture error. The 15 copy-storage tests
were also rerun after strengthening the block-copy snapshot cases to use
actual Float64 storage in both compilation modes. Classic demo tests,
TypeScript build, semantic boundaries and application-form checks also pass.
The exhaustive audits remain excluded.

Evidence: [step 4 timing](baselines/2026-10-31-fft-step4.json) and
[diagnostics](baselines/2026-10-31-fft-step4-diagnostics.json).

### Combined control against the state before all four steps

This is a separate paired series against `e7d3706a`, not a multiplication of
the individual step ratios.

| N | Before, ms | Final, ms | Reusable fft.js, ms |
| --- | ---: | ---: | ---: |
| 256 | 3.827 | 3.635 | 0.001089 |
| 1024 | 6.234 | 5.777 | 0.004293 |
| 4096 | 11.451 | 8.925 | 0.020758 |

At N=4096 the observed wall median falls by 22.1%, and CPU time falls from
15.846 to 12.553 ms (20.8%). Wall ranges still overlap widely: baseline
9.27–29.24 ms, final 7.34–25.67 ms. These numbers are workload-specific
measurements under noisy host load, not a universal performance guarantee.
At this checkpoint, reshape, axis unpack and concat boundaries still prevented
compiling the entire FFT stage as one structural kernel.

Evidence: [combined comparison](baselines/2026-10-31-fft-improvements-total.json).

## Whole-stage numeric function compilation

The next change compiles a pure numerical function as a single array loop.
The demo now puts one unchanged set of butterfly equations in `fftStage`.
The compiler follows ordinary parameter and local bindings; it does not match
the helper's name or recognize an FFT algorithm. A renamed helper and an
unrelated reshape/broadcast/concat pipeline exercise the same compiler.

Supported reshapes contribute flat indexing, axis unpack contributes block
offsets, and indexed roots contribute gather addressing. Arithmetic nodes
share scalar intermediates. Compatible concatenated outputs share one loop;
only the two final real arrays are allocated for an FFT stage. The function
does not publish intermediate bindings or speculative buffers.

Eligibility is deliberately narrow: pure assignments and a final array or
flat tuple of arrays, completed tracked real inputs, safe integer metadata,
and supported layouts. The compiler preserves local rank/kind contracts,
checks gather bounds and finite arithmetic, and uses exact scalar integer
division/remainders. Dead or metadata-only array computations cannot silently
skip an ordinary binding error. Unsupported cases, observable interruptions,
and failed guards replay the ordinary function. Inputs and retained results
are not reused as scratch storage.

### Isolated stage

Each input and the roots are prepared outside timing. The stage width is N/4.
All three modes allocate two output buffers; Rank call/return validation is
included. Ordinary Rank bindings complete all cells; converting the results
to host arrays for comparison happens outside timing. The JS control uses the
same DIF equations in a direct typed loop. These are five serial fresh-process
samples per size and mode, with alternating mode order.

| N | Rank control, ms | Compiled stage, ms | Direct JS stage, ms |
| --- | ---: | ---: | ---: |
| 256 | 0.16661 | 0.02458 | 0.000698 |
| 1024 | 0.34258 | 0.02744 | 0.002303 |
| 4096 | 0.42675 | 0.04829 | 0.008000 |

At N=4096 the stage wall median is 8.84 times faster than the same helper
with numeric function compilation disabled, and 6.04 times slower than direct
JS. This comparison includes Rank's function interface and guards, beyond
the generated arithmetic loop. It does not measure peak or retained memory.

Evidence: [isolated stages](baselines/2026-10-31-fft-whole-stage-isolated.json).

### Complete FFT and remaining gap

The final paired series compares the original inline demo and interpreter at
`b8759f7f` with the new build. `Function control` runs the new helper source
with numeric function compilation disabled, so extracting a function alone
cannot account for the improvement. Each mode has five serial fresh-process
samples. The source hash is recorded per worker because the original and new
demo have different structure. This series was run after the final exact
scalar division/remainder correction, separately from the isolated stage
series and CPU profiling. The candidate was measured as an uncommitted
worktree based on `b8759f7f`; the raw report's `commit` field records that base.

| N | Original, ms | Function control, ms | Compiled, ms | Hand JS, ms | fft.js reuse, ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 256 | 2.500 | 3.084 | 0.723 | 0.03395 | 0.000943 |
| 1024 | 5.283 | 5.938 | 1.506 | 0.13280 | 0.004441 |
| 4096 | 8.759 | 10.917 | 2.168 | 0.49795 | 0.020375 |

At N=4096 this is 4.04 times faster than the previous implementation and
5.04 times faster than the same helper without the new pass. CPU medians
fall from 13.256 to 3.851 ms against the original (70.9%). The remaining wall
gap is 4.35 times against handwritten JS using the same DIF algorithm.
Ranges remain wide: original 8.33–17.57 ms, compiled 1.89–4.83 ms. Absolute
timings should not be treated as stable across host loads.

The specialized fft.js 4.0.4 real transform remains about 106 times faster
in its reusable-plan mode. That mode retains its plan, roots and output
buffer; the Rank demo and handwritten control rebuild roots, permutation
and outputs per call. It is a useful optimized implementation target, but
this change does not close that gap or establish that fft.js is the fastest
possible JavaScript implementation.

Diagnostics record all 12 stages compiled, with no warm code generation,
no selected-view materializations and no older tensor kernels. Element-type
scans fall to 6 / 18,432 cells per call. The previous step recorded
80 / 268,288 cells. The emitted stage allocates two Float64 buffers rather
than materializing the intermediate array expressions; this is an allocation
count observation, not a process-memory measurement.

In a separate N=4096 CPU profile, `compactBinary` in the integer array kernel
accounts for 25.3% self time. In this demo those integer array operations
build the bit-reversal permutation, making general integer array fusion the
next concrete target. Binding/type-contract frames account for 10.6%
inclusive time, GC 5.5%, reshape 0.42% and concat copying 0.13%. Inclusive
categories overlap. The numeric function entry, including its recursive
shape/domain preflight and execution, accounts for 19.0% inclusive time;
reusing prepared shape metadata is another possible improvement. These are
profile observations, not predicted speedups from future changes.

The ordinary interpreter suite passed 450 files / 10,348 tests. After the
final scalar integer correction, all 28 numeric function tests pass, including
the added large negative-divisor remainder regression. The TypeScript build,
semantic boundaries, application-form checks and all seven classic demo
files pass. Exhaustive audits were not run.

Evidence: [full timings](baselines/2026-10-31-fft-whole-stage.json),
[diagnostics and generated stages](baselines/2026-10-31-fft-whole-stage-diagnostics.json),
[CPU profile summary](baselines/2026-10-31-fft-whole-stage-profile.json).

## Numeric loops with rebound entry arrays

The next step enables the existing numeric vector backend for loops that
read an entry array and then rebind its name to a fresh computed array.
Previously, any overlap between `arrayDefinitions` and `arrayInputs` declined
the numeric backend. Such loops used the exact publishing backend, which
materialized separate array operations.

Entry values, numeric cells and multidimensional shape registers are now
initialized even for names that will be rebound. The input buffers remain
read-only; subsequent arithmetic allocates private vector outputs. Existing
overflow guards discard speculation before the exact backend replays it.
No new arithmetic lowering or FFT-specific matching is introduced.

The extension excludes regions with aliases inside the loop, indexed cell
stores, callees or mixed BigInt scalar registers. External aliases remain
valid snapshots because the borrowed inputs are never written. Observable
demand budgets keep ordinary publication boundaries: existing array binding
contracts can poll again while a completed speculative result is published.
The previous safeguards for inspection and custom host callbacks remain.

The FFT demo source is unchanged from `bfafd968`. Its permutation loop now
uses one fused pass for `Order * 2 + Index mod 2` and another for `Index // 2`.
That is two vector passes per iteration instead of four separate integer
array kernels; it does not fuse both assignments into a single pass.

### Paired measurements

The baseline is the separately built interpreter at `bfafd968`, with the same
FFT source and input. The candidate was measured as an uncommitted worktree
based on that commit; the raw report's `commit` field records the base.
Five fresh processes per size/mode run serially, alternating mode order.
Tests and profiling were not running during timing.

| N | Before, ms | After, ms | Before CPU ms | After CPU ms | Hand JS, ms | fft.js reuse, ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 256 | 0.7447 | 0.5950 | 1.3373 | 1.0222 | 0.02717 | 0.000877 |
| 1024 | 1.4434 | 1.0085 | 2.6618 | 1.8121 | 0.10478 | 0.003423 |
| 4096 | 1.7141 | 1.6095 | 2.7681 | 2.6712 | 0.42216 | 0.016470 |

Wall medians decrease by 20.1%, 30.1% and 6.1%, respectively. This step is a
modest improvement at N=4096, not another large jump. Its first-size call
median increases from 13.87 to 15.09 ms, including code generation and other
first-size work. Warm ranges overlap substantially: before 1.66–4.62 ms,
after 1.55–4.61 ms.

Because that largest-size result is noisy, a separate confirmation repeats
only N=4096 in nine fresh-process pairs, alternating baseline/candidate order.
It measures 1.6415 to 1.5318 ms (6.7% lower); CPU medians are 2.7583 to
2.4808 ms (10.1% lower). Its ranges also overlap: before 1.58–3.23 ms,
after 1.45–3.41 ms. Both series support a small improvement under this load;
neither establishes a universal speedup.

In the first series Rank is still 3.81 times slower than the handwritten
same-algorithm JS control at N=4096, and about 98 times slower than the
specialized reusable fft.js plan. The different preparation and allocation
contracts described above still apply; ratios from separate historical
series should not be multiplied into a claimed total speedup.

Warm diagnostics record one numeric loop, no overflow replay, 12 compiled
FFT stages and no new generated code. Element-type scans stay at
6 / 18,432 cells. A separate CPU profile records no samples in the former
`compactBinary` hotspot; the numeric-loop entry and its descendants now
account for 26.7% inclusive time. Thus the remaining permutation work and
guards still matter. Binding/type-contract frames account for 12.3%
inclusive time and GC 3.9%. Categories overlap, and profiling is separate
from performance timing.

All 450 ordinary interpreter files / 10,362 tests pass on the final version,
including the updated entry-value admission test and 13 added vector tests.
The cases cover aliases outside the loop, conservative fallback for internal
aliases and cell stores, conditional multidimensional inputs, empty loops,
real nonfinite results, overflow replay, errors after completed bindings,
and observable demand budgets. TypeScript build, semantic boundaries,
application-form checks and all seven classic demo files pass. Exhaustive
audits remain excluded.

Evidence: [five-sample timings](baselines/2026-11-01-fft-integer-rebinding.json),
[nine-pair confirmation](baselines/2026-11-01-fft-integer-rebinding-confirmation.json),
[diagnostics and generated loops](baselines/2026-11-01-fft-integer-rebinding-diagnostics.json),
[CPU profile summary](baselines/2026-11-01-fft-integer-rebinding-profile.json).
The confirmation uses the existing `fft.mjs --worker=compiled --size=4096`
with `--checkout` alternating between the two builds, nine times each.

## Checks on other demos before integration into main

The integration candidate includes main at `f9863585` (private integer queue
and buffer helpers) as well as the FFT changes. A separate clean checkout of
that main commit was generated and built with its own workspace package links.
The measured candidate is `de179b28`; only the benchmark harness and evidence
were uncommitted. All demo sources and inputs are identical between versions.
In particular, both interpreters execute the current FFT helper source.

The additional review found a correctness defect in the new tensor-region
and structural-function parsers: compound assignments could be interpreted
as simple assignments. Both parsers now require `=`. Compound updates retain
the existing evaluator/compiler path. Eight new tests exercise `+=`, `-=`,
`*=` and `/=` in these contexts; seven initially reproduced the defect before
the admission checks were corrected. This was fixed before integration.

Final correctness checks on the combined production code pass:

- 453 ordinary interpreter files / 10,409 tests.
- All 55 Deep-ML test files and all seven classic test files.
- TypeScript build, semantic boundaries and application-form checks.

The slow exhaustive audits remain excluded.

### Broader performance comparison

`fft-demo-regression.mjs` runs seven existing numerical scenarios at the
largest scale of `numerical-demos.mjs`, three existing array-stage fixtures,
and FFT. Each version has five serial fresh-process samples, alternating
order within each pair. Numerical demo workers use owned snapshot inputs,
two warm calls and three measured calls; a process contributes its warm
median. Array fixtures time a complete 12-round parse/execute. FFT uses its
existing 300 ms warmup and target 150 ms timing batch. These timing contracts
must only be compared within a row. Every worker checks the existing oracle;
tests and CPU profiling are not run concurrently with timing.

| Workload | Main, ms | Candidate, ms |
| --- | ---: | ---: |
| Euler 6, N=200000 | 12.629 | 12.603 |
| Matrix-vector, 512x512 | 33.331 | 35.909 |
| Row means, 512x512 | 24.599 | 24.388 |
| Column means, 512x512 | 25.587 | 27.110 |
| Matrix multiplication, 64x64 | 272.046 | 247.040 |
| Gradient descent, 2048x8, 20 steps | 7.431 | 7.449 |
| K-means, 2048x2 | 122.303 | 112.559 |
| Integer matrix fixture, 12 rounds | 99.214 | 98.847 |
| Real matrix fixture, 12 rounds | 120.480 | 124.182 |
| Real broadcast fixture, 12 rounds | 151.133 | 151.652 |
| FFT, 4096 points | 11.604 | 1.972 |

The initial non-FFT shifts are small or noisy enough to require confirmation.
Four separate nine-pair series repeat the apparent improvements and possible
regressions with the same workers:

| Workload | Main, ms | Candidate, ms |
| --- | ---: | ---: |
| Matrix-vector | 31.472 | 31.868 |
| Column means | 27.449 | 24.585 |
| Matrix multiplication | 239.645 | 239.494 |
| K-means | 108.620 | 109.354 |

The initial 8–9% matmul/k-means improvements do not repeat. Matvec's apparent
7.7% regression shrinks to 1.3%; column mean reverses direction. Ranges
overlap widely (for example confirmed matmul is 226.5–467.2 ms before and
236.9–480.4 ms after). These runs do not establish a general speedup on the
other existing demos, or a large reproducible regression. The real-matrix
fixture's first series is 3.1% slower and includes startup/compilation; it is
not evidence that all array programs improve.

FFT does show a clear improvement in this series: 5.88 times faster, with
nonoverlapping ranges, 10.05–24.67 ms before and 1.52–5.18 ms after. This
compares compiler versions on the same source, rather than multiplying
ratios from earlier experiments.

Warm diagnostics explain why the non-FFT effects are limited. Matmul uses
4,096 existing tensor kernels and no new numeric functions in both builds;
k-means uses 8,192 tensor kernels, no numeric loops/functions, and the same
16,390 type scans / 45,060 scanned cells in both builds. Full numerical
outputs from diagnostic runs were checked for exact agreement. The new passes
are general mechanisms for eligible array pipelines, structural pure helpers
and entry-array rebinding, rather than a universal acceleration of numerical
code. Unsupported reductions, calls and control flow keep existing paths.

Evidence: [broad series](baselines/2026-11-01-fft-demo-regression.json),
[matvec confirmation](baselines/2026-11-01-fft-demo-confirm-matvec.json),
[column confirmation](baselines/2026-11-01-fft-demo-confirm-column.json),
[matmul confirmation](baselines/2026-11-01-fft-demo-confirm-matmul.json),
[k-means confirmation](baselines/2026-11-01-fft-demo-confirm-kmeans.json),
[warm diagnostic counts](baselines/2026-11-01-fft-demo-diagnostics.json).

Reproduce with an independently built baseline:

```sh
node benchmarks/fft-demo-regression.mjs \
  --baseline=/path/to/main-checkout --samples=5 \
  --output=/tmp/fft-demo-regression.json
node benchmarks/fft-demo-regression.mjs \
  --baseline=/path/to/main-checkout --samples=9 \
  --only=matmul --output=/tmp/fft-demo-matmul.json
```

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
node benchmarks/fft-stage.mjs --samples=5 \
  --output=/tmp/fft-stage-timings.json
```

For a before/after comparison, build an unchanged checkout separately and pass
its root with `--baseline=/path/to/baseline`. Select
`--modes=baseline,compiled,reference,fftjs-reuse` to reproduce the comparison
series. `--checkout` selects the candidate build; it defaults to this checkout.
Use `--baseline-source=/path/to/original/fft.ra` when the original demo source
also changed. Add `function-control` to the modes to run the current source
with numeric function compilation disabled while retaining other compiler
passes.

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
