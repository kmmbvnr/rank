# General fusion pipeline investigation

Baseline is main `51362d77`. Demo sources are unchanged. Work is isolated in
`perf/fusion-pipelines`; unrelated prime/Euler changes are excluded.
The harness checks independent JS oracles and forces all output cells.
Timings use alternating fresh processes, >=1 s warmup and three target
300 ms batches, without concurrent tests or profiles.

## Initial audit

Counters record completed typed buffer publications and cells through the
exclusive-ownership `typedArray` API. They are not total allocations or peak
memory: private scratch, boxed results and shared views are excluded.
Inputs are created before the diagnostic scope.

| Case | Compiled tensor runs | Published typed buffers | Published cells |
| --- | ---: | ---: | ---: |
| kmeans | 1024 | 2057 | 6152 |
| convolution | 0 | 0 | 0 |
| softmax | 1 | 2 | 8192 |
| logsoftmax | 0 | 4 | 16384 |
| gradient | 8 | 32 | 4224 |
| distance | 1 | 1 | 4096 |

K-means already combines square/sum; the earlier ordinary difference binding
remains a completion boundary. Conv2D performs 13,068 derived-cell
computations and no tensor kernels: native window addressing is opaque to
the graph lowerer. Softmax retains Exps for two consumers; removing it
blindly would repeat exp. Log-softmax publishes four 4,096-cell buffers.
Gradient descent already runs eight tensor kernels. Start with window
addressing, then inspect the next actual boundary.

[Initial evidence](baselines/2026-11-01-fusion-initial-audit.json).

## Step 1: native window views and shared ranked folds

Unpadded native array windows publish scalar addressing through the existing
trusted view API. The lowerer must still prove the source, so opaque/lazy
readers keep ordinary evaluation. Padded/wrapped-padding windows keep their
previous path. Ranked sum/mean/min/max over natural cell order can prepare
one graph per observation and reuse it across all frames. Replaced native
calls, inspection, host polling, stale guards and reordered axes fall back.
No demo source or arithmetic reduction order changes.

The first probe only added window addressing and prepared one graph for
every window: **3.571 -> 9.773 ms**, a regression. That implementation was
not committed. The final version reuses the graph: Conv2D preparation count
falls from 484 in that probe to two, and derived-cell computations fall
from 13,068 to zero. This removes intermediate scalar-cache work; typed
buffer publications remain zero for this fixture and are not an allocation
metric for its boxed output.

Five alternating fresh process pairs compare against unchanged main:

| Task | Main, ms | Candidate, ms |
| --- | ---: | ---: |
| kmeans | 14.2025 | 14.4344 |
| convolution | 2.9947 | 1.2431 |
| softmax | 0.2996 | 0.2994 |
| logsoftmax | 0.8578 | 0.8634 |
| gradient | 2.1207 | 1.4050 |
| distance | 0.0575 | 0.0533 |
| moving | 60.2716 | 17.9414 |
| rowStats | 0.3364 | 0.3042 |

Conv2D improves 2.41x and moving means 3.36x. Other timing shifts are not
attributed to this change without mechanism evidence or confirmation.
Build and 174 focused tests pass, including 18 new checks for geometry,
mutation, aliases, host demand, replacement, wide/nonfinite values and budgets.

[Negative first probe](baselines/2026-11-01-fusion-window-probe.json),
[final step timings](baselines/2026-11-01-fusion-window-general.json),
[final step counters](baselines/2026-11-01-fusion-window-audit.json).

## Rejected probe: rounding fallback metadata

Registering the array result in `roundValue` as a scalar-map recipe leaves
log-softmax unchanged: zero tensor executions, four published typed buffers,
16,384 published cells and 4,096 derived-cell computations. Intrinsic round
has ranks 0/0, so the ordinary lifted call executes the scalar path; the
array fallback is not the effective graph boundary. This change is removed.
A future general solution belongs at parameterized native scalar lifting,
with argument-validation and observation ordering preserved.

## Step 2: allocation-free native window addresses

The first step still computed each route with an output-coordinate array
and two slices. Capture affine index terms once, then compute only the flat
source offset in a scalar loop. Native-plan capture checks both geometries;
if the live geometry changed, the ordinary coordinate mapper is used.
Ordinary readers and integer-view adapters retain their original mapping.
This improves window routing generally, not a Conv2D-specific loop.

Five fresh alternating pairs compare against step 1 (`7d8260c8`):

| Task | Step 1, ms | Step 2, ms |
| --- | ---: | ---: |
| convolution | 1.1016 | 0.8631 |
| moving | 16.8312 | 9.6265 |
| gradient | 1.2879 | 1.1191 |
| distance | 0.0531 | 0.0528 |
| rowStats | 0.2877 | 0.2864 |

Conv2D improves another 1.28x, moving means another 1.75x. Distance and
row-stat controls are effectively unchanged. Gradient timing changes are
not attributed to window work: its diagnostic pipeline is unchanged.
Do not multiply these ratios by earlier series; use a final comparison.
Build and 97 focused tests pass, including new checks for multidimensional
axis order and stale source geometry. No FFT or demo source is changed.

Evidence: [Conv2D](baselines/2026-11-01-fusion-index-convolution.json),
[moving means](baselines/2026-11-01-fusion-index-moving.json),
[gradient control](baselines/2026-11-01-fusion-index-gradient.json),
[distance control](baselines/2026-11-01-fusion-index-distance.json),
[row-stat control](baselines/2026-11-01-fusion-index-rowStats.json).

## Combined final comparison

Compare final implementation `40460453` with unchanged main `51362d77`.
Five fresh process pairs per pipeline, alternating order, >=1 s warmup,
three target 300 ms batches. Coefficients, demo code and numeric operation
order are unchanged; all output cells are checked against independent JS.
Instrumentation overhead is included in the candidate timings.

| Task | Main, ms | Final, ms | Time change |
| --- | ---: | ---: | ---: |
| kmeans | 12.7576 | 12.8751 | +0.9% |
| convolution | 2.8928 | 0.8523 | -70.5% |
| softmax | 0.2877 | 0.2895 | +0.6% |
| logsoftmax | 0.7395 | 0.7430 | +0.5% |
| gradient | 0.9796 | 0.9898 | +1.0% |
| distance | 0.0511 | 0.0503 | -1.7% |
| moving | 46.5499 | 9.5094 | -79.6% |
| rowStats | 0.2757 | 0.2726 | -1.1% |

The real Deep-ML Conv2D demo (24x24 input, 3x3 kernel, no padding) improves
**3.39x**. The general 4,096-element moving-mean fixture improves **4.90x**.
The other six controls differ by less than 2%; the large earlier gradient
shift does not reproduce. These are matched final measurements, not a
product of ratios from separate runs.

Seven FFT-4096 process pairs, >=1 s warmup and three target 500 ms batches,
give **0.7524 -> 0.7483 ms** (0.5% less wall time, effectively unchanged).
First-size calls **12.025 -> 12.712 ms** do not improve. This optimization
helps window/fold pipelines, not FFT stages already using numeric-function
fusion. No sin/cos values or order vectors are cached.

Counter evidence: Conv2D derived-cell computations **13,068 -> 0**; moving
means **520,448 -> 0**, with two graph preparations per call. Output frame
folds remain separate scalar reductions in natural order. Native routes no
longer allocate coordinate/slice arrays per logical cell. Publication
counters do not measure those JS allocations, total bytes or peak memory.
No memory multiplier is claimed.

### Corpus decisions

- K-means: square/sum is already fused. Its ordinary difference binding
  remains a completion boundary; eliminating it needs pure-region/liveness
  analysis that preserves all mandatory errors, including unused cells.
- Softmax: Exps is shared by the sum and normalization; retaining it avoids
  repeated exp calls. No speculative removal of this multi-consumer value.
- Log-softmax: the rounding probe did not reach intrinsic scalar lifting,
  so it was removed. Parameterized scalar-call plans are a separate boundary.
- Gradient descent: existing eight tensor kernels and publication counts
  are unchanged; no timing improvement is attributed to this work.
- FFT: structural stages are already fused; retained as a regression control.

[Final pipeline timings](baselines/2026-11-01-fusion-final-general.json),
[FFT regression control](baselines/2026-11-01-fusion-final-fft.json).

Final build, semantic-boundary checks (65 owners), application forms and all
55 Deep-ML / seven classic demo test files pass. The ordinary interpreter
suite runs through the package script with types/differential/Nurikabe
excluded. Exhaustive audits are not run. All timing completed before tests.

Final ordinary result: **457 files / 10,511 tests passed**, 140.29 s.
Command: `node scripts/test.mjs --exclude test/types.test.ts --exclude
test/differential.test.ts --exclude test/nurikabe.test.ts` from the
interpreter package. The benchmark comparison remains against the explicit
starting revision `51362d77`; separate prime work in main is outside this
branch and outside these timing comparisons.
