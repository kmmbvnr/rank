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

## General compiler follow-up: prepared numeric functions

### Step 1: cache the full preparation

The compiler previously cached generated code but rebuilt the entire bound
node graph, shape arithmetic, local contracts and scalar-slot mapping before
every lookup. It now retains a bounded prepared specialization selected from
the current input shapes, scalar kinds and scalar values. Negative real zero
has its own key. Every call still validates current storage, metadata and
native operations, reads fresh input cells, and allocates fresh outputs.
No input arrays or output buffers are retained by these plans. Unsupported
inputs and arithmetic failures retain ordinary replay.

This changes the compiler only. The FFT source is unchanged: sine/cosine
tables and frequency ordering are still computed inside each FFT call.
The baseline is an independently built clean `31f2acaa` checkout; the
candidate was measured as uncommitted changes based on the same commit.

Five serial fresh-process samples per mode, alternating order, give:

| FFT N | Before, ms | After, ms |
| --- | ---: | ---: |
| 256 | 0.526 | 0.383 |
| 1024 | 0.869 | 0.732 |
| 4096 | 1.780 | 1.380 |

The N=4096 first-series wall median decreases 22.5%, but host load causes
large outliers, including a 12.43 ms baseline at N=256. A separate nine-pair
N=4096 confirmation measures 1.504 to 1.350 ms (10.2% lower); CPU medians
fall from 2.480 to 1.997 ms (19.5%). Confirmation ranges still overlap:
before 1.37–3.55 ms, after 1.27–3.04 ms. The confirmation supports a more
modest gain than the initial largest-size median.

Three independent pure array helpers use the same compiler, without any
FFT operations or name matching. They force the complete host output within
timing and check every value against independent JS expressions:

| Helper, 4096 input cells | Before, ms | After, ms |
| --- | ---: | ---: |
| Reshape + affine transform | 0.10962 | 0.06336 |
| Strided finite differences | 0.03747 | 0.03291 |
| Paired-channel mean/spread | 0.05778 | 0.05432 |

Finite differences improve 12.2%, with first-series process ranges
0.03627–0.03960 ms before and 0.03212–0.03598 ms after. The affine result
has very wide ranges (0.0559–0.3024 before, 0.0581–0.1220 after), so its
large median change is not a reliable standalone speedup claim.

Existing demo controls remain unchanged in the stable series: matrix-vector
30.864 to 30.715 ms; gradient descent's nine-pair confirmation 7.126 to
7.115 ms. The first gradient series was noisy and appeared 14.2% slower
(12.275 to 14.017 ms); the confirmation does not reproduce that regression.
Programs that do not use eligible numerical helpers are not expected to
benefit from this preparation cache.

Warm FFT diagnostics record 12 prepared-plan hits, zero preparations and
12 executed numerical functions; no new code is generated. The cache remains
bounded to 32 variants, and eviction/rebuilding, new input values, shape/type
changes, signed zero, builtin guards and post-warm arithmetic failure have
dedicated tests. All 453 ordinary interpreter files / 10,415 tests, 55
Deep-ML files, seven classic files, TypeScript build, semantic boundaries
and application-form checks pass. Exhaustive audits remain excluded.

Evidence: [FFT series](baselines/2026-11-01-numeric-prepared-step1-fft.json),
[FFT confirmation](baselines/2026-11-01-numeric-prepared-step1-fft-confirm.json),
[general helpers](baselines/2026-11-01-numeric-prepared-step1-helpers.json),
[matvec control](baselines/2026-11-01-numeric-prepared-step1-matvec.json),
[gradient first series](baselines/2026-11-01-numeric-prepared-step1-gradient.json),
[gradient confirmation](baselines/2026-11-01-numeric-prepared-step1-gradient-confirm.json),
[warm/cold diagnostics](baselines/2026-11-01-numeric-prepared-step1-diagnostics.json).

```sh
node benchmarks/numeric-function-plans.mjs \
  --baseline=/path/to/baseline --samples=5 \
  --output=/tmp/numeric-function-plans.json
```

### Step 2: integer-bound guard pruning rejected

The next experiment used already prepared safe integer intervals to omit
per-cell `Number.isSafeInteger` checks for virtual ranges/index arithmetic.
Real arithmetic guards and integer-zero normalization remained. The baseline
is a fixed build of step 1 (`fa9e1915`), and sources are unchanged.

| FFT N | Step 1, ms | Experimental pruning, ms |
| --- | ---: | ---: |
| 256 | 0.37860 | 0.36976 |
| 1024 | 0.71298 | 0.70901 |
| 4096 | 1.35135 | 1.34006 |

At N=4096 the 0.8% wall difference is within the overlapping process ranges
(1.320–1.455 ms before, 1.310–1.440 ms after); CPU medians are essentially
unchanged, 2.022 to 2.025 ms. The indexed helper initially appears 4.0% faster
in five pairs, but a nine-pair confirmation reverses direction: 0.03127 to
0.03164 ms, with CPU 0.05205 to 0.05239 ms. Affine and paired-channel helpers,
whose emitted arithmetic did not benefit from integer-bound pruning, also
show small shifts. There is no reproducible speed improvement here.

The guard-pruning change was therefore removed from production code. Its
[experimental patch](experiments/numeric-index-proof.patch) is retained only
to reproduce the negative result; it applies to the step-1 code generator.
Raw step-2 timings and diagnostics describe that rejected candidate, not
the final retained implementation.

The boundary tests exposed an independent existing eligibility defect:
ordinary unary +/- reject inline sequences, whereas a named range binding
has already completed into an array. The numeric compiler previously treated
both as virtual arrays. It now conservatively declines unary expressions
containing an inline range through arithmetic, preserving the ordinary error.
The syntax check is bounded, and named-array unary arithmetic remains supported.
This correctness fix, safe-integer boundary cases and signed-zero regressions
are retained; runtime integer guards remain as in step 1.

The experimental version passed 453 ordinary files / 10,423 tests. After
removing guard pruning and its code-generator-only test, the final retained
version passes all 453 ordinary files / 10,422 tests, including 45 numerical
function tests. All 55 Deep-ML files and seven classic files pass again;
TypeScript build, semantic boundaries and application-form checks pass.
Exhaustive audits were not run. No end-to-end speedup is attributed to this
second step; its retained production change is the unary-sequence repair.

Evidence: [FFT experiment](baselines/2026-11-01-numeric-prepared-step2-fft.json),
[helper experiment](baselines/2026-11-01-numeric-prepared-step2-helpers.json),
[indexed confirmation](baselines/2026-11-01-numeric-prepared-step2-indexed-confirm.json),
[rejected-candidate diagnostics](baselines/2026-11-01-numeric-prepared-step2-diagnostics.json).
Timing again uses serial fresh processes with alternating order and no
concurrent tests/profiling. Ratios from the two steps are not multiplied.

### Step 3: private array registers across pure helper calls

The baseline is a fixed build of `cfcefda9`, after steps 1 and 2. The FFT
source is unchanged: every invocation still computes its coefficients and
permutation. This step adds a generic conditional-loop plan, using the
existing numerical helper compiler through a private buffer interface.

An eligible loop calls pure global helpers, assigns an array or unpacks a
flat tuple of arrays, and updates safe integer control variables. Array
ranks must remain fixed, and scalar control must prove a finite schedule of
at most 1024 iterations independently of array results. Existing input
storage is borrowed read-only; helper outputs remain private until the loop
succeeds. A failed guard replays the original loop with untouched bindings.
Captures, effects, memoization, explicit call ranks, generators, finally,
inspection hooks, cancellation and demand budgets retain the ordinary path.

The first two passes retain public return-contract observations: the first
can consume inputs with unresolved element declarations; by the second,
loop-written arrays are real with fixed ranks. Later shapes/scalar values do
not change the argument specialization. Final bindings and return values
are wrapped and published once. Numeric output buffers are still freshly
allocated for every call; buffer recycling is not part of this step.

Five alternating pairs in fresh processes, including all output forcing:

| FFT N | Before, ms | Private calls, ms | Less time | JS in-place, ms |
| --- | ---: | ---: | ---: | ---: |
| 256 | 0.35811 | 0.20549 | 42.6% | 0.02412 |
| 1024 | 0.68093 | 0.46178 | 32.2% | 0.09621 |
| 4096 | 1.30343 | 1.01823 | 21.9% | 0.38910 |

At N=4096, process ranges do not overlap: 1.295–1.307 ms before and
0.987–1.026 ms after. CPU medians improve from 1.933 to 1.336 ms. The
remaining gap against this handwritten JS implementation is about 2.62x;
this step alone is a 1.28x speedup, not a threefold gain.

A second five-pair run on the final build confirms the result: 1.30105 to
1.00930 ms at N=4096, with JS at 0.38785 ms (about 2.60x gap). At N=256 and
1024 it measures 0.36149 to 0.20650 and 0.68282 to 0.46333 ms.

Unhooked runtime diagnostics show one private call loop and twelve helper
calls. A warm call has twelve prepared-plan hits and zero preparations.
The benchmark's `--diagnostics` mode installs compilation hooks and therefore
retains the ordinary loop path; those hook-based runs must not be used to
count this new optimization.

Independent helpers repeat 16 calls over 4096 real elements. Their inputs
and full independent JS oracles are prepared outside timing:

| Helper | Before, ms | Private calls, ms |
| --- | ---: | ---: |
| Repeated affine transform | 0.27574 | 0.12312 |
| Repeated pair transform | 0.27580 | 0.12465 |
| Standalone affine control | 0.04922 | 0.04952 |
| Standalone indexed control | 0.03080 | 0.03099 |
| Standalone pair control | 0.04926 | 0.04940 |

The caller-loop examples improve about 2.2x; standalone controls change by
less than 1%. These controls also cover the refactored ordinary helper
input path. No FFT-specific operation, coefficient cache or source rewrite
is involved.

The unchanged matrix/vector demo measures 29.233 to 29.212 ms; gradient
descent measures 6.968 to 7.012 ms with overlapping process ranges. Neither
control shows a material change.

Verification: all 453 existing ordinary interpreter files / 10,422 tests
pass, and all 29 new caller-loop cases pass. The ordinary run exposed an
incorrect expectation in the new memo fixture (array memo keys are rejected);
that expectation was corrected and its full 29-case file rerun successfully.
Tests compare complete results, retained aliases and located errors against
uncompiled and number-loop-disabled execution, including post-progress
failures, changing shapes, signed zero, negative floor division, effects,
captures, hooks, cancellation, demand budgets and the unchanged 4096-point
FFT. All 55 Deep-ML files and seven classic files pass; TypeScript build,
semantic boundaries and application-form checks pass. Exhaustive audits
remain excluded, as required by AGENTS.md.

Evidence: [FFT series](baselines/2026-11-01-numeric-call-loop-fft.json),
[FFT confirmation](baselines/2026-11-01-numeric-call-loop-fft-confirm.json),
[general helpers and standalone controls](baselines/2026-11-01-numeric-call-loop-helpers.json),
[matrix/vector control](baselines/2026-11-01-numeric-call-loop-matvec.json),
[gradient control](baselines/2026-11-01-numeric-call-loop-gradient.json),
[unhooked diagnostics](baselines/2026-11-01-numeric-call-loop-diagnostics.json),
[CPU summary](baselines/2026-11-01-numeric-call-loop-cpu.json).

A separate 2.5-second CPU sample places roughly 45% of inclusive time in the
existing numerical array loop used for output permutation, versus about 14%
in the new helper-call loop. Output boxing takes about 7%; garbage collection
about 3%. These instrumented proportions locate follow-up work, not predicted
speedups, and categories can overlap. Generic integer array-loop execution
is now a more promising large target than another helper-boundary change.

### Step 4a: repair wide signed array division

Boundary tests for the next loop experiment exposed an existing ordinary
kernel bug, also reproduced on `4b0d6077`: `(array -9007199254740991) // 3`
can throw a fractional-to-BigInt RangeError. Computing `(a - remainder) / b`
can round the subtraction outside the safe integer range even when the
operands and mathematical quotient fit. The stored integer kernel now
checks that intermediate and declines to the exact BigInt backend.

Six divisor cases check nine numerators, both signs, boxed and Int64 storage,
and vector/matrix shapes against an independent BigInt oracle. Together
with the loop boundary checks, 112 focused tests pass. This is a correctness
repair; no speed improvement is attributed to it.

The first five-pair FFT control was noisy (1.046 to 1.112 ms, process maxima
above 2 ms). A separate nine-pair confirmation measures 1.00786 to 1.01080 ms,
with overlapping ranges of 0.981–1.023 and 0.992–1.051 ms. FFT source and
coefficients remain unchanged. The cell-reuse experiment was removed from
the measured build, so this control isolates the division repair.

Evidence: [initial control](baselines/2026-11-01-wide-array-division-fix-fft.json),
[nine-pair confirmation](baselines/2026-11-01-wide-array-division-fix-fft-confirm.json).

### Step 4b: reuse pointwise leaf loads

The confirmed baseline is `fbea7e4b`, including the separate division repair.
The numerical loop compiler now freezes each original array leaf in a local
per-cell temporary. Division/remainder expansion reuses that value instead
of repeating the load, Number conversion and safe-integer check. Repeated
references to the same leaf in one pointwise frame share the temporary.
The temporary executes afresh for every cell and iteration; no input values
are cached across assignments or calls. Integer overflow guards remain, and
allocation/publication, division algorithms and FFT source are unchanged.

An initial five-pair run against `4b0d6077` and a nine-pair run against the
repaired baseline both contain severe wall-time outliers. For example,
N=1024 before/after medians in the latter are 0.828/0.465 ms, but baseline
individual processes range from 0.475 to 5.197 ms. No small-size percentage
is attributed to that noisy comparison.

A focused confirmation at N=4096 uses five alternating fresh-process pairs,
at least 1000 ms warmup, and three batches of at least 500 ms per process.
Every worker reports its median batch, and all batches remain in the raw
report. Both implementations recompute coefficients and output ordering
on every call, and full outputs are forced and checked.

| FFT N=4096 | Median, ms | CPU median, ms |
| --- | ---: | ---: |
| Before leaf reuse | 0.97994 | 1.24237 |
| Leaf reuse | 0.82613 | 1.09608 |
| Handwritten JS in-place | 0.42650 | 0.42729 |

That is 15.7% less wall time (1.19x), with 11.8% less CPU time. Three of five
paired worker medians improve; two candidate processes are slower, at 1.152
and 1.819 ms. The separate nine-pair short-batch series improves in seven
pairs and has medians of 1.11166 to 0.89651 ms. No outliers were discarded. The JS gap in this same series is about 1.94x. This is evidence
for a roughly 15–20% improvement on this FFT workload, not a threefold gain
or a claim that every array program becomes faster.

```sh
node benchmarks/fft.mjs --baseline=/path/to/baseline \
  --sizes=4096 --samples=5 --warmup-ms=1000 \
  --batch-ms=500 --batches=3 \
  --modes=baseline,compiled,js-inplace
node benchmarks/integer-vector-loops.mjs \
  --baseline=/path/to/baseline --samples=5
```

The general whole-loop benchmark parses once, prepares Int32 inputs and an
independent full BigInt oracle outside timing, then resets input bindings and
runs twelve array iterations with full result publication/forcing. Every
worker asserts that the numerical loop backend really executed.

| Whole-loop case, 4096 output cells | Before, ms | Leaf reuse, ms |
| --- | ---: | ---: |
| Repeated remainders | 0.45327 | 0.36730 |
| Quotient and remainder | 0.41785 | 0.39556 |
| Affine numerator / scalar divisor | 0.33383 | 0.33901 |
| Two-dimensional broadcasting | 0.59756 | 0.59447 |

The repeated-remainder case improves 19.0%, with nonoverlapping process
ranges (0.446–0.460 versus 0.355–0.368 ms) and CPU 0.549 to 0.457 ms.
The quotient series contains large outliers; the affine and broadcast
controls have overlapping ranges and do not establish a general gain.
The affine division already uses a scalar arithmetic temporary for its
numerator. These controls show that fewer generated leaf expressions do
not by themselves establish an end-to-end gain.

The nine-pair affine confirmation reverses the small initial difference:
0.33812 to 0.32476 ms wall, but CPU is 0.42082 to 0.42571 ms, with wide
and overlapping process ranges. There is no reproducible affine regression
or speed improvement.

Real matrix and real broadcast controls measure 111.020 to 110.585 ms and
121.932 to 121.128 ms respectively, both with overlapping process ranges.
There is no measurable regression or improvement in these two controls.

Verification: all 454 ordinary interpreter files / 10,464 tests pass,
including the new repeated-operand cases at safe integer boundaries,
negative divisors, empty/multidimensional broadcasting, overflow replay,
retained aliases and located errors after completed stages. All 55 Deep-ML
files and seven classic files pass, along with the TypeScript build,
semantic boundaries and application-form checks. Exhaustive audits remain
excluded as required by AGENTS.md.

A separate instrumented CPU sample now places about 35% of inclusive time
in the numerical array loop, 16% in the helper-call loop and 8% in output
boxing. These proportions locate remaining work; they are not timing
speedups or forecasts, and inclusive categories can overlap.

Evidence: [pre-repair preliminary FFT series](baselines/2026-11-01-vector-cell-cse-fft.json),
[nine-pair short-batch FFT series](baselines/2026-11-01-vector-cell-cse-fft-confirm.json),
[focused long-batch confirmation](baselines/2026-11-01-vector-cell-cse-fft-long.json),
[general integer loops](baselines/2026-11-01-vector-cell-cse-integers.json),
[affine confirmation](baselines/2026-11-01-vector-cell-cse-affine-confirm.json),
[real matrix control](baselines/2026-11-01-vector-cell-cse-real-matrix.json),
[real broadcast control](baselines/2026-11-01-vector-cell-cse-real-broadcast.json),
[CPU summary](baselines/2026-11-01-vector-cell-cse-cpu.json).

### Pre-merge audit against main

The complete branch at `dd870052` was compared with an independently built
current main, `31f2acaa`. This measures all five commits together rather than
multiplying ratios from separate experiments. Five alternating pairs of
fresh processes run seven unchanged numerical demo scenarios and three array
controls plus FFT; every worker validates complete outputs independently.

| Scenario | Main, ms | Candidate, ms |
| --- | ---: | ---: |
| Euler 6 | 12.444 | 12.450 |
| Matrix × vector, 512 × 512 | 29.681 | 29.552 |
| Row means, 512 × 512, nine-pair confirmation | 23.590 | 23.509 |
| Column means, 512 × 512 | 24.011 | 23.887 |
| Matrix × matrix, 64 × 64 | 232.225 | 232.274 |
| Gradient descent, 2048 samples | 7.091 | 7.165 |
| K-means, 2048 points | 101.770 | 101.506 |
| Integer matrix stages | 91.490 | 91.282 |
| Real matrix stages, nine-pair confirmation | 110.328 | 111.002 |
| Real broadcast stages | 123.432 | 124.082 |
| FFT, 4096 | 1.42037 | 0.85576 |

The first row-mean series suggested a 10% gain but had large overlapping
ranges; nine fresh pairs reduce that difference to 0.3%. The initial real
matrix series suggested a 2.4% regression; its nine-pair confirmation is
0.6% slower with overlapping ranges. No material change is established for
the ten non-FFT controls. FFT improves about 1.66x (39.8% less time) in this
whole-branch comparison, with nonoverlapping process ranges.

There is also measured non-FFT benefit in the independent numerical helper
workloads, again compared directly with main in five fresh-process pairs:

| Pure helper scenario | Main, ms | Candidate, ms |
| --- | ---: | ---: |
| Standalone affine | 0.05092 | 0.04944 |
| Standalone indexed differences | 0.03654 | 0.03366 |
| Standalone paired-channel transform | 0.05467 | 0.04912 |
| Sixteen affine helper calls in a loop | 0.31366 | 0.12389 |
| Sixteen paired-channel calls in a loop | 0.35153 | 0.12567 |

The two caller-loop cases improve 2.53x and 2.80x; their process ranges do
not overlap. Warm diagnostics record one private loop, sixteen helper calls
and sixteen prepared-plan hits in each. These are controlled helper
benchmarks, not claims about unchanged Deep-ML demo performance. The
separate integer-remainder workload in step 4b also benefits outside FFT.

A further, untimed diagnostic call on each of the seven numerical demo
scenarios records zero prepared numerical helper hits and zero private
helper-call loops. Their existing native/tensor execution paths do the
work: matrix multiplication, reductions, indexed writes and a captured
k-means helper are outside the new pure-callee protocol. This explains the
limited coverage rather than treating unchanged timings as an acceleration.

The retained mechanisms are general: bounded preparation caches depend on
input contracts; private buffers cross eligible pure helper calls; pointwise
leaf reuse applies to supported numerical array expressions; the wide signed
division repair restores exact semantics. None recognizes FFT names, sizes
or coefficient values. The rejected integer-guard experiment remains only
an archived patch. Existing faster dense integer kernels retain admission.

Further coverage could include range-controlled caller loops, scalar and
array operations mixed with helper calls, safe captures, and additional
numeric IR operations such as reductions/matmul. These are possible separate
extensions, not implemented behavior or prerequisites for merging this
verified subset. Profiles of the intended next workload should determine
which extension earns its cost; expanding the outer loop form alone would
not accelerate a body dominated by unsupported matmul/reductions.

The compiler/runtime source is identical to the version that passed all 454
ordinary interpreter files / 10,464 tests, 55 Deep-ML files and seven classic
files. The audit adds optional worker-only diagnostics to the benchmark,
without changing demo sources or timed execution when diagnostics are off.
Exhaustive audits remain excluded.

Evidence: [all demo/control timings](baselines/2026-11-01-numeric-merge-demo-audit.json),
[row confirmation](baselines/2026-11-01-numeric-merge-row-confirm.json),
[real matrix confirmation](baselines/2026-11-01-numeric-merge-real-matrix-confirm.json),
[general helpers](baselines/2026-11-01-numeric-merge-helper-audit.json),
[untimed demo diagnostics](baselines/2026-11-01-numeric-merge-demo-diagnostics.json).

Example diagnostic invocation (an additional checked call after timing,
without compilation hooks):

```sh
node benchmarks/numerical-demos.mjs --worker=gradient \
  --scale=2 --samples=3 --storage=snapshot \
  --diagnostics=true
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

## Step 6a: retain unary output kind evidence

This independent experiment starts at main `7e04577a`; it does not include
`perf/vector-stores`. Unary numeric kernels already visit every output cell.
Count infinities during that pass and pass the existing `typedArray` uniform
kind hint when all cells have one physical kind. NaN remains `real`, not
`numeric-limit`. Mixed results and execution under a demand budget retain
ordinary discovery. Existing storage writers maintain or invalidate the hint.
No FFT source, coefficients or permutation change.

FFT-4096 exact kind scanning falls from 18,432 to 14,336 cells per warm call
without compiler hooks. Five alternating fresh process pairs, 1 s warmup and
three 500 ms batches, give **0.825 -> 0.792 ms** (4.0% less time). Baseline
contains a 1.621 ms outlier; first-size calls **12.01 -> 12.29 ms** do not
improve. This is a small preliminary timing gain, not a large FFT speedup.

General producer checks include function contracts, allocation, copying and
full host-array forcing, with input and an independent Math oracle outside
timing. The same 4,096-cell scan disappears for `cos` and `sqrt`; both improve
in all five pairs. Pooled medians are 0.211 -> 0.099 ms and
0.094 -> 0.069 ms, but cosine has large process-to-process variation, so its
2.14x pooled ratio should not be treated as a stable gain. Gather and copy
controls differ by about 1.5% and 1.3%. The untouched real conversion control
regresses in the initial series (0.123 -> 0.228 ms); all raw batches are kept,
with a separate confirmation series rather than attributing it to this change.

Build and 107 focused tests pass: unary kernels, physical kind evidence,
numeric functions and private call loops. Tests cover NaN, signed infinities,
negative zero, mixed results, coercion, mutation and budgeted execution.

Evidence: [FFT](baselines/2026-11-01-buffer-facts-unary-fft.json),
[general producers and controls](baselines/2026-11-01-buffer-facts-unary-general.json).

The nine-pair real-conversion confirmation gives **0.1261 -> 0.1253 ms**
(0.6% less time), with slow processes on both sides. The initial large
regression does not reproduce; no conversion improvement is claimed here.
[Control confirmation](baselines/2026-11-01-buffer-facts-unary-real-confirm.json).

## Step 6b: retain real conversion evidence

Apply the same existing uniform-kind hint while `realArray` writes its
Float64 output. Count actual stored infinities; conversions of text and
BigInt still reject nonfinite conversion, and existing numeric NaN/infinities
retain their values. Mixed results and budgeted execution retain discovery.
This step is compared against step 6a (`f32f8a7d`), not against main.

Build and 86 focused tests pass, including 12 new cases covering conversion
kinds, mutation, invalid/overflowing inputs, empty shapes, host readers and
budgeted validation. The five-pair FFT timing is **0.895 -> 1.101 ms**; both
versions range from about 0.79 to 1.7 ms. No FFT timing improvement is claimed
from this series; raw negative evidence is retained.

Evidence: [incremental FFT timings](baselines/2026-11-01-buffer-facts-real-fft.json).

The targeted conversion pipeline improves **0.1238 -> 0.0988 ms** (20.1%
less time) over seven alternating process pairs; scanning falls from 4,096
to zero cells. Warm FFT exact-kind scanning falls again, from 14,336 to
10,240 cells; its private call loop remains enabled. This establishes
less repeated work and a general conversion benefit, not FFT timing progress.
Use `fft.mjs --worker=compiled --storage-diagnostics` to collect counters
without the compiler hooks that disable the private call loop.
[Conversion timing and counters](baselines/2026-11-01-buffer-facts-real-general.json),
[FFT counters without hooks](baselines/2026-11-01-buffer-facts-real-diagnostics.json).

## Step 6c: preserve known kinds through selection copies

Contiguous typed rows and eager irregular typed gathers reuse a uniform
physical source kind only when that evidence is already available. The new
`knownStoredScalarKind` query (refined in step 6d) does not discover unknown source
kinds; a tiny selection must not scan its larger source. Mixed sources keep
ordinary output discovery. Budgeted execution, inspection and host polling
retain the previous path. Source and selection writes retain independent,
tracked kind evidence; semantic declarations are never used as proof.

Compared with step 6b (`d686ff9b`), FFT-4096 scanning falls from **10,240 to
2,048** cells, with the private call loop still enabled. Seven-pair FFT
timing is **0.809 -> 0.820 ms**; no timing improvement is established.
The tuple-returning gather fixture exercises eager selectors (the earlier
`gather ... copy` fixture uses tensor fusion and already avoids the scan).
It eliminates a 4,096-cell scan, but initial timings are negative:
**0.0895 -> 0.1098 ms**. Candidate processes split between roughly 0.062 and
0.12 ms, so a separate confirmation is retained. These scan reductions
are correctness/performance-mechanism evidence, not proof of faster FFT.

Build, 95 existing focused selection/storage tests and eight new selection
kind tests pass. Cases include NaN/infinities, duplicates, row shape,
independent copies, writes, unknown/mixed sources, host readers and budgets.

Evidence: [FFT timing](baselines/2026-11-01-buffer-facts-selection-fft.json),
[FFT counters](baselines/2026-11-01-buffer-facts-selection-diagnostics.json),
[general selection timing and counters](baselines/2026-11-01-buffer-facts-selection-general.json).

The nine-pair selection confirmation reverses the wall-time result:
**0.0904 -> 0.0736 ms** (18.6% less time), while process CPU medians are
**0.1096 -> 0.1222 ms**. Both full series remain available; a stable selection
speedup is not established. The deterministic result is removing the scan.
[Selection confirmation](baselines/2026-11-01-buffer-facts-selection-general-confirm.json).

## Combined buffer-evidence result

Nine alternating fresh process sets compare main `7e04577a`, step 6c
`9ffb921a`, and handwritten per-call in-place JS. Each uses at least 1 s
warmup and three target 500 ms batches, validates all output components,
and includes coefficient/permutation computation. FFT source is identical.

| FFT-4096 | Warm wall median | Process CPU median | First-size median |
| --- | ---: | ---: | ---: |
| Main | 0.8548 ms | 1.1404 ms | 13.410 ms |
| Buffer evidence | 0.7720 ms | 1.0980 ms | 12.448 ms |
| JS in-place | 0.4708 ms | 0.4716 ms | 1.851 ms |

The combined candidate uses **9.7% less warm wall time** (1.107x), and
3.7% less process CPU time. Exact-kind scans drop **18,432 -> 2,048 cells**
(88.9%). It is 1.64x slower than this handwritten JS implementation; this
is not a claim against every optimized JS FFT library. Both Rank series
contain slow processes (up to 1.90/1.68 ms), and incremental series did not
establish gains for every individual step. Do not multiply their ratios.
The useful general result is retaining physical evidence across unary
functions, explicit conversions and typed selection copies; no FFT-specific
cache, pattern or arithmetic shortcut was added.

[Combined FFT measurements](baselines/2026-11-01-buffer-facts-final-fft.json).

The broad step-6c audit covers seven unchanged numerical demo scenarios,
three array-stage fixtures and FFT. Large initial slowdowns do not reproduce
on separate nine-pair confirmations: real matrix **119.90 -> 117.86 ms**,
k-means **106.88 -> 104.04 ms**. Row means remain slightly slower
(**26.22 -> 27.45 ms**, 4.7%); this is investigated in step 6d. Other initial
medians include matvec **31.63 -> 31.84**, column means **30.73 -> 28.73**,
matmul **242.06 -> 240.88**, gradient **7.66 -> 7.44**, integer matrix
**101.57 -> 103.60**, real broadcast **148.19 -> 152.64 ms**. These are
short demo timings with a different contract from the warmed FFT batches.

[Broad audit](baselines/2026-11-01-buffer-facts-final-demo-audit.json),
[row confirmation](baselines/2026-11-01-buffer-facts-final-row-confirm.json),
[real matrix confirmation](baselines/2026-11-01-buffer-facts-final-real-matrix-confirm.json),
[k-means confirmation](baselines/2026-11-01-buffer-facts-final-kmeans-confirm.json).

## Step 6d: separate the known-only kind query

Restore the hot `storedScalarKinds` API and implementation to main's
behavior. Export a separate `knownStoredScalarKind` helper for uniform
physical evidence; it never scans and returns one kind directly, without
allocating/sorting an array of kinds. The selection behavior and scan count
are unchanged. This avoids imposing a new optional mode on all existing
contract/storage queries. It does not establish the cause of the earlier
row variation.

Against step 6c, nine-pair row means give **25.72 -> 25.32 ms** (1.6% less
wall time), with overlapping ranges; this is not a significant new speedup.
Build and 20 focused selection/storage tests pass.
[Incremental row measurements](baselines/2026-11-01-buffer-facts-known-kind-row.json).

The five-pair selection comparison gives **0.0797 -> 0.0682 ms** wall and
**0.1074 -> 0.0853 ms** process CPU medians, again with overlapping,
variable process ranges. [Incremental selection measurements](baselines/2026-11-01-buffer-facts-known-kind-selection.json).

## Final refined candidate

The final implementation (`e90a19a8`) repeats the combined result over seven
fresh process sets: main **0.8377 ms**, candidate **0.7585 ms**, per-call
in-place JS **0.4640 ms**. This is **9.5% less wall time / 1.104x speedup**
over main, with Rank still **1.635x** slower than this JS implementation.
Process CPU medians are **1.1235 -> 1.0388 ms** (7.5% less). First-size calls
are **12.149 -> 11.969 ms**; the warm result should not be read as a large
cold-start improvement. No-hooks counters still show **one exact-kind scan /
2,048 cells**, 12 numeric function executions and one private call loop.
The two combined series agree on roughly 10% less warm time; individual
step timings and general selection timings remain much less stable.

[Final refined FFT comparison](baselines/2026-11-01-buffer-facts-refined-fft.json),
[final no-hooks counters](baselines/2026-11-01-buffer-facts-refined-diagnostics.json).

The final nine-pair row-mean check against main gives **29.30 -> 25.82 ms**,
with both versions having slow runs around 53 ms. The earlier row slowdown
does not reproduce consistently; no universal demo speedup is claimed.
[Refined row check](baselines/2026-11-01-buffer-facts-refined-row.json).

Final checks: incremental TypeScript project build, semantic boundaries
(65 owners, 11 script tests), application forms, all 55 Deep-ML demo files
and all seven classic demo files pass. The ordinary interpreter suite is
run through its package script, excluding `types`, `differential` and
`nurikabe`; exhaustive audits are not run. Timings precede these checks,
with no tests/profiles running concurrently with the timed workers.

Final ordinary interpreter result: **456 files / 10,490 tests passed**
(191.79 s), through `node scripts/test.mjs --exclude test/types.test.ts
--exclude test/differential.test.ts --exclude test/nurikabe.test.ts`.
The FFT demo source has no diff against main. Production changes are five
files, 39 added and 11 removed lines; each implementation step has its own
commit, followed by this final validation record.

## Merge audit: effects beyond FFT

Rebuilt main `7e04577a` (including Langium generation) and the final branch
`18413f5c`; production source is unchanged from the full 456-file / 10,490-test
validation above. This audit adds measurements and documentation only.
All workers run serially in fresh processes, alternating baseline/candidate
order per pair, with independent output oracles and full output forcing.
No tests or profiles run concurrently with timing.

Seven process pairs cover the unchanged numerical demos and matrix fixtures:

| Task | Main, ms | Candidate, ms | Time change |
| --- | ---: | ---: | ---: |
| euler | 12.4640 | 12.4880 | +0.2% |
| matvec | 29.5179 | 29.6378 | +0.4% |
| row | 23.7747 | 24.4826 | +3.0% |
| column | 24.0870 | 24.1196 | +0.1% |
| matmul | 237.3570 | 236.3220 | -0.4% |
| gradient | 7.6598 | 7.5280 | -1.7% |
| kmeans | 105.7270 | 105.8768 | +0.1% |
| integer-matrix | 96.7317 | 95.5005 | -1.3% |
| real-matrix | 119.1087 | 117.5288 | -1.3% |
| real-broadcast | 130.1825 | 130.9739 | +0.6% |
| fft | 0.8890 | 0.7838 | -11.8% |

Nine controls differ by less than 2%. Row means have a +3.0% pooled median
but a -0.6% median within-pair change; the earlier large slowdown is not
reproduced. FFT again improves, by 11.8% in this shorter timing contract.
These are workload-specific results, not evidence of faster arbitrary code.

Five process pairs cover 4,096-cell producer/copy pipelines, with at least
1 s warmup and three target 300 ms batches per process:

| Pipeline | Main, ms | Candidate, ms | Time change |
| --- | ---: | ---: | ---: |
| cosine | 0.1170 | 0.0915 | -21.8% |
| squareRoot | 0.0931 | 0.0684 | -26.5% |
| real | 0.1213 | 0.0952 | -21.5% |
| gather | 0.0875 | 0.0884 | +1.1% |
| tupleGather | 0.0865 | 0.0611 | -29.3% |
| copy | 0.0470 | 0.0468 | -0.5% |

`cosine`, `squareRoot`, `real` and `tupleGather` each eliminate a 4,096-cell
exact-kind scan. Their wall-time reductions range from 21.5% to 29.3%.
The already-fused gather and plain copy already scan zero cells and remain
close to baseline. Earlier noisy/negative series are retained above.

No further FFT-specific or operation-specific optimization was added. The
existing physical-kind hint is retained by completed unary numeric kernels,
real conversion, and typed row/gather copies with already known uniform
source kinds. Unknown/mixed sources keep discovery; lazy/host readers are
not forced to prove a kind. This is general runtime evidence propagation,
with the existing mutation and observation rules retained.

The measured general benefits, unchanged-source correctness validation and
absence of a reproduced substantial demo slowdown support merging this
branch into main. Exhaustive audits were not run.

[Full demo audit](baselines/2026-11-01-buffer-facts-merge-demos.json),
[producer pipelines and counters](baselines/2026-11-01-buffer-facts-merge-producers.json).

## FFT-first follow-up: guarded Int32 interval kernels

Start at main `2a43b3bd`. FFT is the optimization target; other programs are
regression/generality controls. Fresh CPU sampling without compiler hooks
puts the integer vector loop at about 37% of self samples, numeric stages
near 11%, and final typed-buffer conversion near 9%. Generated code is
captured with Debugger.getScriptSource only after sampling, preserving the
private call loop during the profile. Profiles are diagnostic, not timings.

### Step 1: eliminate proven integer cell checks

An Int32 buffer plus matching valid broadcast geometry proves every leaf
load is an exact integer. Exact BigInt interval arithmetic propagates
bounds through +, -, *, floor division and modulo. Only ranges entirely
inside safe Number remove intermediate safe checks; only ranges entirely
inside Int32 write directly without per-cell widening checks. Other paths
retain the previous guards and arbitrary-precision replay. Buffer kinds
are checked per stage, so a widened next iteration uses the generic path.
No input-value scan, FFT source recognition, coefficient or order cache.

The first seven fresh-process sets give FFT-4096 **0.8649 -> 0.7445 ms**
(13.9% less wall time), with process CPU **1.2168 -> 1.0730 ms**. Nine-pair
confirmation gives **0.9828 -> 0.8255 ms** (16.0% less wall time), CPU
**1.3229 -> 1.1767 ms**. Absolute times vary substantially; slow processes
are retained. Both series use >=1 s warmup and three target 500 ms batches.
JS per-call in-place is 0.4195 ms in the first series; no twiddles are cached.
The post-change profile shifts integer-loop self samples toward 28%.

A final metadata-admission check also requires valid nonnegative dimensions
and an exact shape/buffer length match, without reading cells. Its five-pair
series has a severely shifted baseline median **2.088 -> 0.822 ms**, with
baseline workers spanning 0.837-2.504 ms. This is not evidence of an
additional 2.5x improvement; use the independent confirmations and final
combined comparison rather than multiplying or selecting their ratios.

Build and 341 focused tests pass, including new exact BigInt oracles at
Int32 endpoints, signed division/remainders, widening, overflow, retained
aliases and malformed buffer geometry. A small integer-vector control set
also improves (remainder, quotient, affine and broadcast); those gains do
not determine whether this FFT-focused change is retained.

Evidence: [before profile](baselines/2026-11-01-fft-priority-profile-before.json),
[post-change profile](baselines/2026-11-01-fft-priority-profile-int32.json),
[first FFT series](baselines/2026-11-01-fft-priority-int32.json),
[FFT confirmation](baselines/2026-11-01-fft-priority-int32-confirm.json),
[metadata-guard series](baselines/2026-11-01-fft-priority-int32-geometry.json),
[integer controls](baselines/2026-11-01-fft-priority-int32-controls.json).

### Step 2: power-of-two division/remainder on proven Int32 values

Only a proven Int32 dividend and a fixed positive power-of-two divisor up
to 2^31 qualify. Signed right shift implements floor division; a mask gives
the nonnegative modulo for negative dividends too. Wider intermediate
values, divisors above 2^31 and unknown bounds retain guarded arithmetic.
This is a scalar lowering rule, not recognition of the FFT permutation.

Seven fresh-process pairs against step 1 (`5820950e`), >=1.5 s warmup and
three target 750 ms batches, give FFT-4096 **0.7913 -> 0.7266 ms** (8.2%
less wall time), process CPU **1.1571 -> 1.0716 ms** (7.4% less). Ranges
still overlap because of slow processes. First-size **12.259 -> 11.186 ms**
is retained but not presented as an established cold-start improvement.

Build and 345 focused tests pass. Exact BigInt oracles cover negative
Int32 endpoints, intermediate widening, overflow, aliases, modulo/division
at 2^31, and the non-eligible 2^32 cases. No change to the FFT source.

[Incremental FFT timings](baselines/2026-11-01-fft-priority-shifts.json).


### Rejected step 3: copy completed real buffers directly

In the rejected experiment, public `.items` conversion uses an indexed copy for native Float64 buffers
of at least 1,024 cells, instead of Array.from's iterator path. Small arrays,
subclasses, custom iterators, own length overrides and detached buffers
retain the previous behavior. Publication, tracked writes, validity masks
and ownership are unchanged. The FFT source is unchanged.

Incremental whole-FFT measurements against step 2 are mixed: the first
seven-pair series is slower (1.2692 -> 1.5342 ms), while a second, longer
seven-pair series is faster (0.8738 -> 0.7086 ms). Process CPU in the latter
falls 1.2135 -> 1.1615 ms (4.3%). The large wall-time drift prevents a claim
of a stable 19% FFT gain from this step.

A separate component check confirms the mechanism, not the FFT speedup.
Three fresh processes alternate seven within-process pairs, publishing and
fully converting the same readonly 8,192-cell input. Median CPU per copy is
0.2222 -> 0.0427, 0.2147 -> 0.0407 and 0.2750 -> 0.0419 ms. This includes
ownership publication; it does not measure full FFT or count allocations.
Reproduce with `node benchmarks/real-buffer-materialization.mjs
--baseline=/path/to/built/b4b9da00 --checkout=/path/to/built/f76b2cc7`. Raw FFT series, including the negative
one, are retained. Build and 126 storage/readonly tests pass, including
subarray offsets, signed zero, nonfinite reals, mutations, custom iteration,
subclass length observations and detached-buffer errors.

[First FFT series](baselines/2026-11-01-fft-priority-boxing.json),
[FFT confirmation](baselines/2026-11-01-fft-priority-boxing-confirm.json),
[Component checks](baselines/2026-11-01-fft-priority-boxing-component.json).

### Three-step experiment, not selected for main

All three changes, unchanged FFT source, against `2a43b3bd` and handwritten
JS with fused in-place butterflies. Both implementations compute roots and
permutation per call; full output materialization is included. Seven fresh
process sets per size, alternating order, >=2 s warmup and three measured
batches of >=1 s each. No test/build workers were active when this rerun
started; own measurements remain serial. Slow workers are retained.

| FFT size | Previous main, ms | New Rank, ms | JS in-place, ms | Rank time reduction | Rank / JS |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1,024 | 0.4430 | 0.3827 | 0.1433 | 13.6% | 2.67x |
| 4,096 | 1.0988 | 0.7290 | 0.4970 | 33.7% | 1.47x |
| 16,384 | 3.9113 | 2.4341 | 1.9653 | 37.8% | 1.24x |

Process CPU decreases 9.5%, 23.3% and 27.8% respectively. These totals
are measured directly; incremental percentages above are not multiplied.
Individual worker times still vary substantially: at 4,096, baseline is
0.847-2.439 ms and candidate 0.557-2.817 ms. The table describes medians
in this series, not a universal multiplier or a cold-start guarantee.

The earlier combined run was found to overlap an independent Euler-305
Vitest audit (110% CPU at inspection). Its raw report is retained and
explicitly qualified; it is excluded from the final speedup claim. No
external processes were stopped. Correctness testing completed before the
clean rerun.

Build, 460 ordinary interpreter files / 10,537 tests, all 55 Deep-ML and
seven classic demo test files, 11 semantic-source script tests, 65 semantic
owners and application-form checks pass. Types/differential/Nurikabe audits
were not run.

[Combined timings](baselines/2026-11-01-fft-priority-final-clean.json),
[Contaminated exploratory series](baselines/2026-11-01-fft-priority-final.json),
[Verification](baselines/2026-11-01-fft-priority-verification.json).


### Admission decision

Only steps 1 and 2 are selected for main. The completed-real-buffer copy
experiment remains at `f76b2cc7` on `perf/fft-priority`, outside the main
integration branch. No production runtime change or dedicated copy test
from that experiment is included. Raw reports and its component harness
are retained for reproducibility, not as an enabled optimization.

A final incremental check against step 2 gives FFT-4096 0.8505 -> 0.8768 ms
and CPU 1.2114 -> 1.4316 ms: no reproduced benefit at the primary size.
FFT-16384 improves 3.3382 -> 2.3156 ms, but the inconsistent size-dependent
whole-FFT evidence does not justify including this optional runtime path
now. The three-step table above describes an experiment, not the final
main version. The selected two-step version is measured separately below.

The first short control series showed large apparent regressions in
quotient and broadcast. Longer checks (five fresh-process pairs, >=2 s
warmup, three >=750 ms batches) do not reproduce those large regressions:
quotient 0.3459 -> 0.3530 ms (2.1% slower wall, 4.7% CPU; ranges overlap),
broadcast 1.1899 -> 0.6783 ms (ranges remain broad). Short remainder and
affine controls improve 0.5199 -> 0.4212 and 0.3646 -> 0.3092 ms. No
blanket claim of an improvement for every program is made. These controls
still include the optional copy experiment; final controls use the exact
selected compiler version.

[Copy admission check](baselines/2026-11-01-fft-priority-boxing-admission.json),
[Initial controls, including negatives](baselines/2026-11-01-fft-priority-final-controls.json),
[Quotient confirmation](baselines/2026-11-01-fft-priority-controls-quotient-confirm.json),
[Broadcast confirmation](baselines/2026-11-01-fft-priority-controls-broadcast-confirm.json).


### Final selected version: two compiler changes only

The main integration branch excludes `f76b2cc7` and its runtime copy path.
Its compiler changes are exactly `5820950e` and `b4b9da00`. Main's separate
Euler-023 array rewrite is merged for integration; the timing baseline stays
at `2a43b3bd`, whose compiler/runtime are otherwise unchanged by that demo.

The JS control is strengthened. `js-inplace` above retained repeated
whole-array passes to construct the permutation and callback-based gathers.
It was not the strongest ordinary JS implementation. New `js-direct` uses
the same DIF butterflies, computes fresh sine/cosine tables each call, and
advances reversed indices while gathering both channels in one pass. It
uses no coefficient/order cache and is checked against the direct DFT too.
Consequently, earlier claims of being within roughly 1.5x of efficient JS
must not be reused: they describe the weaker control only.

Five fresh-process sets per size, alternating order, >=1.5 s warmup, three
>=750 ms measured batches, complete results and per-call preparation:

| FFT size | Previous main, ms | Selected Rank, ms | Stronger JS, ms | Rank time reduction | Rank / JS |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1,024 | 0.5319 | 0.3852 | 0.0256 | 27.6% | 15.03x |
| 4,096 | 0.8452 | 0.6987 | 0.0889 | 17.3% | 7.86x |
| 16,384 | 4.0343 | 3.7862 | 0.5370 | 6.1% | 7.05x |

At the primary 4,096 size, process CPU falls 1.1730 -> 1.0418 ms (11.2%).
Worker wall-time ranges still overlap: baseline 0.745-1.028 ms, selected
0.611-1.482 ms. At 16,384, CPU rises 5.9514 -> 6.1868 ms (+4.0%) despite
the 6.1% lower wall median. That size is inconclusive; do not present it as
an established gain. Slow workers are retained, not filtered out. No claim
of a universal factor, 3x improvement or proximity to JS is justified.

A fresh CPU profile puts integer vector code at 20.7% of self samples,
numeric function kernels at 14.2%, public typed-buffer conversion at 11.1%
and GC at 4.3%. These are sampling shares, not independent speedup factors.
The next substantial work is eliminating array passes and private output
allocations across regions, plus reducing wrapper/preparation work across
a numeric function. The stronger JS control illustrates why merely lowering
individual checks cannot close the remaining gap. No FFT recognizer or
precomputed coefficient/permutation mechanism has been introduced.

Selected-version validation: build passes; the ordinary suite passes 458
files / 10,528 tests and finds one stale assertion in the remaining file.
Main's independently rewritten Euler-023 demo no longer executes the three
collection loops that assertion was intended to test. Preserve its original
program in a dedicated fixture rather than weaken the compiler counter
assertion. After this test-only repair, all 17 tests in that file pass on
repeat. The three tests of the actual new Euler-023 demo also pass. No
production demo or compiler change is made for that integration repair.
A clean entire-suite rerun after the fixture-only repair was not repeated.

All 55 Deep-ML and seven classic demo files pass on the selected build,
as do the semantic boundary checks (11 script tests, 65 owners) and
application-form checks. Exhaustive audits remain excluded.

[Selected-version FFT timings](baselines/2026-11-01-fft-priority-selected.json),
[Selected CPU profile](baselines/2026-11-01-fft-priority-selected-profile.json).


Selected-version integer controls use five fresh-process pairs, >=1.5 s
warmup, and three >=500 ms batches. Medians: remainder 0.4961 -> 0.2884 ms,
quotient 0.8027 -> 0.4213, affine 0.6530 -> 0.3736; broadcast is slower
0.8888 -> 1.0342 ms (+16.4% wall, +8.9% CPU). Large overlapping worker
ranges persist. Do not hide that negative result or call this universally
regression-free.

A supplemental broadcast experiment alternates eleven 250 ms block pairs
within one process, with two independent runtimes, complete output forcing
and a BigInt oracle. Three fresh processes give wall medians 0.5832 ->
0.5202, 1.4277 -> 1.0644, and 1.1066 -> 1.2480 ms. CPU changes -13.8%,
-17.9% and +2.6%. These shared-heap checks also do not establish a consistent
broadcast regression or a portable gain; use the independent Linux host
measurements below as an additional admission check.

[Selected integer controls](baselines/2026-11-01-fft-priority-selected-controls.json),
[Paired broadcast checks](baselines/2026-11-01-fft-priority-selected-paired-controls.json),
[Selected verification](baselines/2026-11-01-fft-priority-selected-verification.json).


### Independent Linux host: root@jack.lan

Intel i7-10750H, 12 threads, Linux x64, Node v24.15.0 matching the local
Apple M5's Node release. System Node v20.19.2 is not replaced: the official
Node archive is SHA256-verified and unpacked under an isolated temporary
tools directory. Both compiled snapshots, their module dependencies and
the benchmark source are staged separately. The runner checks 2,795 file
hashes before each phase. Dependency installation finishes before timing.
No CPU governor, process priorities or unrelated processes are changed.

Baseline `2a43b3bd`, selected compiler `90eeb4ec` (same two production
changes as above). Five fresh-process sets at each size, alternating order,
>=1.5 s warmup and three >=750 ms batches. All preparation and output forcing
included. No coefficient/permutation cache in either JS control.

| FFT size | Baseline, ms | Selected Rank, ms | Strong JS, ms | Rank time reduction | Rank / strong JS |
| --- | ---: | ---: | ---: | ---: | ---: |
| 4,096 | 2.4591 | 1.6334 | 0.1922 | 33.6% | 8.50x |
| 16,384 | 9.5683 | 5.8376 | 0.8743 | 39.0% | 6.68x |

The FFT ranges do not overlap: at 4,096 baseline 2.377-2.548 versus selected
1.577-1.895 ms; at 16,384 baseline 9.382-9.811 versus selected 5.632-6.162.
Process CPU falls 31.3% and 27.6% respectively. This supports a real gain on
this host; it does not justify replacing the noisier M5 observations with
one universal multiplier. The weaker JS control is 0.9196 and 4.3155 ms,
showing why it understated the gap to efficient scalar JS.

General integer controls, five fresh pairs, >=1.5 s warmup and three
>=500 ms batches, all retain independent BigInt output oracles:

| Control | Baseline, ms | Selected, ms | Time reduction |
| --- | ---: | ---: | ---: |
| remainder | 1.3099 | 0.8765 | 33.1% |
| quotient | 1.1441 | 0.8370 | 26.8% |
| affine | 0.9232 | 0.7421 | 19.6% |
| broadcast | 1.8755 | 1.4755 | 21.3% |

All four controls have non-overlapping old/new worker ranges on this host.
Broadcast CPU falls 22.2%; the large local apparent regression is not
reproduced on Linux. Keep the local negative and contradictory paired data
above, rather than infer that every workload benefits on every CPU.

A separate post-timing CPU sample puts integer vector code at 15.0%, numeric
function kernels at 14.7%, public conversion at 9.4% and GC at 4.5% of self
samples. The remainder is distributed across runtime preparation, checks,
array routing and other frames. Sampling percentages are diagnostic, not
measured gains. The optional real-buffer copy remains excluded from main.

[Linux FFT](baselines/2026-11-01-fft-priority-jack-fft.json),
[Linux controls](baselines/2026-11-01-fft-priority-jack-controls.json),
[Host and dependency metadata](baselines/2026-11-01-fft-priority-jack-metadata.json),
[Linux CPU profile summary](baselines/2026-11-01-fft-priority-jack-profile.json).


### Final integration against the updated main

Main advanced independently to `9b53e58c` (record signatures / Euler-305).
Merge it into the selected branch as `1aece5d2`, build both the new main
baseline and integration checkout, and rerun the primary FFT on jack.lan.
The optional runtime-copy experiment is not an ancestor of this branch.

Five fresh-process sets, >=1.5 s warmup, three >=750 ms batches:
FFT-4096 **2.5087 -> 1.6560 ms** (34.0% less time, 1.515x throughput).
Process CPU **3.3667 -> 2.2713 ms** (32.5% less). Worker ranges again do
not overlap: main 2.394-2.970 ms, integration 1.610-1.717 ms. Strong JS is
**0.1946 ms**, leaving an **8.51x** gap. No root/permutation cache is used.
These are the final delivery numbers against the actual updated main.

After integration, both builds pass, as do 11 focused files / 446 tests,
all 55 Deep-ML and seven classic demo test files, semantic boundaries and
application forms. No fresh exhaustive audits or entire ordinary-suite
rerun is claimed after merging the independently tested record changes.
Earlier full-suite and test-fixture repair results are recorded above.

Temporary checkout paths in reports identify the historical run locations;
use the captured revision hashes and manifests to reproduce them, since
the isolated baseline checkout was later advanced to the new main.

[Final integration timings](baselines/2026-11-01-fft-priority-jack-integration.json),
[Integration verification and host snapshots](baselines/2026-11-01-fft-priority-integration-verification.json).
