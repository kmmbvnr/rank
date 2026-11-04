# Euler 275 investigation

Initial investigation: `5f12ccbdee46980e2f2578c028de7257f88f5518`, Node v24.15.0,
macOS arm64. The historical measurements below precede implementation;
shipping changes and their separate validation are described at the end.

Problem 275 was the next unfinished problem selected from issue #447. Its original ordinary fixture covers
orders 6, 10 and 12. Order 15 has a separate manual fixture; the default is 18.
The official problem gives independent checks 6 → 18, 10 → 964 and
15 → 360505: https://projecteuler.net/problem=275.
The full existing implementation returns 15030564.

## Findings

The demo already uses a Redelmeier search: an explicit DFS stack and one shared
frontier, with branch-local marks undone during backtracking. This avoids
copying all partial polyominoes. It enumerates oriented balanced figures and
counts mirror-symmetric figures; Burnside's lemma gives `(CountA + CountS)/2`.

The remaining search is large. A separate instrumented order-15 run visits
11710792 candidates, rejects 8071259 by the existing bounds, and accepts
718474 oriented balanced leaves. Instrumentation is excluded from timings.
The growth in the number of candidates remains exponential.

Compilation works already. Both setup and search use Number loops, with no
Number overflow or exact-mode fallback in the diagnostic runs. There is no
large tensor materialization to eliminate here.

The reference interpreter pays for each expression, statement and array access.
Its original order-12 CPU profile includes name lookup, application classification,
mutable-array writes and statement dispatch. Before this fix it also repeatedly rebuilt all
compiler capabilities even with compilation disabled:

- `Interpreter.compiler` calls `resolveCompilerCapabilities(this.options)`.
- `FastPaths.compiler` has an optional context callback but the interpreter
  does not supply it, so it independently rebuilds the capabilities.

## Prototypes

`early-break` preserves the search and moves the `abs(Ns) <= Mc[Rm]` rejection
before `Pd`/`Occ` writes and min/max work. It also stops the mirror test after
the first missing reflected cell.

`lean` retains both geometric pruning inequalities, turns their failures into
immediate `continue`, and writes `Pd`/`Occ` only after all pruning. It removes
an unused `Fs` write and the repeated `Rm` calculation. This preserves the
search tree and its counting rules; it reduces work per candidate.

`native-cache` snapshots the base/reference capabilities in a research-only
version of the Interpreter class and supplies `compiler: () => this.compiler`
to FastPaths. The getter still selects reference capabilities while inspection
is enabled. The benchmark imports this alternate class from an in-memory module;
it does not patch production files or globally change the imported class.
This is evidence for a general runtime improvement, not a ready production fix:
option/hook mutation and debugger transitions need an explicit cache contract
and regression coverage before shipping.

The earlier `cache` experiment only overrode the public getter. It could not
improve FastPaths because the context callback was absent; it was rejected.

## Measurement

Every timed sample uses a fresh process. Each series rotates case order over
three rounds. Measurements include Rank parsing/execution and exclude imports;
there are no diagnostics, profiles or oracle runs during timed samples.
No own test/build runs overlap. Other machine activity is uncontrolled.
RSS is the process high-water mark, including the runtime.

The raw baseline separates the initial series, the corrected-cache series and
follow-up samples. Three initial `lean` samples are discarded: the prototype
transformation replaced only the first geometric-pruning assignment, so it
searched unnecessary branches. The final prototype preserves both bounds;
these discarded timings are retained only for traceability.

Medians in seconds (three samples per candidate):

| Workload | Original | Early rejection + mirror break | All rejection before writes | With capability cache |
| --- | ---: | ---: | ---: | ---: |
| Full N=18, compiled | 28.898 | 22.175 | 20.772 | Not measured |
| N=12, reference | 4.211 | 3.598 | 3.354 | 3.007 (with all early rejections) |

Capability caching alone takes 3.700 s on the unchanged N=12 demo,
about 12% less time than the matching 4.211-second control. The demo alone
is about 1.39x faster at full N=18 and 1.26x faster in the N=12 reference.
Together the two prototypes are about 1.40x faster in the N=12 reference.
There is no meaningful memory reduction: full compiled RSS stays near
182 MiB, and the reference stays near 369 MiB.

A concurrent session committed `ec7824a6` during the investigation. The built
interpreter/language JavaScript was not rebuilt during any measurements:
its latest module mtime precedes the first series. The baseline records
both Git heads, source hashes, build digest and file times. These measurements
use the existing build; they do not claim to validate that other commit.

The historical 34.9/0.6-second fixture row came from a different environment
and should not be divided by isolated results as a measured speedup.
Full order-18 reference execution was not run; no estimated time is reported
as a measurement.

## Correctness and next implementation

The independent oracle grows all connected sets containing (0,1), with y >= 1,
deduplicates whole sets, then selects zero x-moment and identifies reflections.
It shares neither the DFS machinery nor the pruning bounds with the demo.
All **96** comparisons (orders 1 through 8, six variants, both modes) pass.
All six variants also pass the official order-10 assertion in both modes
(12 additional checks). Order 12 is asserted in each timing; order 15 is
asserted in the diagnostic compiled runs; every full N=18 sample asserts
15030564. The scoped order-15 diagnostics show two Number loops, zero mixed
loops and zero overflows for original, lean and lean+cache.

The initial investigation did not change production source or run the full/audit suite.
Raw results: `baselines/2026-10-30-euler275-investigation.json`.

The implementation retains the compact DFS, applies `lean`, and fixes repeated
capability resolution for all programs. Readonly configuration is captured at
construction, while inspection selects the reference snapshot dynamically. Do not relax numeric admission thresholds or
turn off correctness/audit exclusions to obtain a benchmark win.
This does not remove exponential search; substantially larger orders would
need a different algorithm, such as combining half-sculptures by moment and
connectivity. That algorithm has not been prototyped or measured here.

## Reproduce

```sh
node benchmarks/euler275-investigation.mjs compiled 18 original
node benchmarks/euler275-investigation.mjs compiled 18 lean
node benchmarks/euler275-investigation.mjs reference 12 native-cache
node benchmarks/euler275-investigation.mjs reference 12 lean-native-cache
DIAGNOSTICS=1 node benchmarks/euler275-investigation.mjs compiled 15 instrument
python3 benchmarks/euler275-verify.py
```

`DUMP_SOURCE=1` prints the transformed Rank program without running it.

## Shipping implementation

The production demo now rejects impossible candidates before writing occupied
cells, stops mirror checks on the first mismatch and removes the unused `Fs`
array. All three pruning bounds and the search/counting rules remain intact.

The runtime copies and freezes constructor compiler configuration and resolves
two frozen capability snapshots once. FastPaths receives the same live getter;
inspection selects reference capabilities, including nested inspection, detach,
exception recovery and construction inside a debugger session. Caller mutations
to the original configuration cannot affect parent/child interpreter settings;
callback closure state remains live. This contract is documented in the runtime
execution guide and the readonly constructor API.

Broader validation exposed an existing interruption-test failure in the Number
tensor consumer. It now generates separate ordinary/interruptible kernels and
declines a cached kernel when interruption mode changes. Ordinary kernels avoid
polling; interruptible kernels retain cancellation/budget checks and the existing
`computing tensor` activity description.

Delivery validation:

- TypeScript language/interpreter build passes.
- 20 focused suites: **737/737** tests pass, including compiler configuration,
  loops, cancellation, debugger transitions, tensor consumers and builtin guards.
- Full compiled N=18 test passes: **15030564**, Number loops, zero overflow.
- Scoped type/differential checks: **2 passed** for the ordinary 275 fixture,
  with both original small assertions and the new single-block boundary.
- Shipping independent set-growth oracle: **16/16** comparisons, orders 1–8
  in both modes. The earlier research contains 96 comparisons across prototypes.
- Semantic-boundary check: **11 tests / 65 owners** pass.
- The manual N=15 fixture and full-reference budget exclusion remain intact.
  The delivery diagnostics also assert N=15 → 360505.
- No complete corpus audit or full ordinary suite was run.

Final medians (three fresh serial processes per case, Node v24.15.0 arm64):

| Workload | Original demo + uncached runtime | Original demo + shipping runtime | Shipping demo + runtime |
| --- | ---: | ---: | ---: |
| Full N=18, compiled | 30.576 s | Not measured | **22.342 s** |
| N=12, reference | 4.452 s | 3.879 s | **3.103 s** |

The full compiled improvement is about **1.37x**; the N=12 reference improvement
is about **1.43x**. The general runtime fix alone reduces reference time by
about 13%. Full compiled ranges are 29.677–32.031 s and 22.252–23.050 s;
reference shipping ranges are 3.054–3.478 s. RSS medians are about 184 → 182 MiB
compiled and 371 → 367 MiB reference; these small changes are not a memory-saving
claim. The remaining search is exponential.

No own test/build/oracle work overlapped timing. The controlled uncached
runtime restores only old repeated flag resolution on the same shipping build;
the raw baseline retains the earlier research series separately. A concurrent
`b77b6bf2` source commit landed during delivery without rebuilding JavaScript.
The measured build is based on `ec7824a6` plus this implementation. Module mtimes
predate the entire timed series; the baseline records the build digest, relevant
source hashes, build parent and source head at completion.

Reproduce shipping checks and controlled comparisons:

```sh
node benchmarks/euler275-investigation.mjs compiled 18 shipping
RUNTIME=uncached node benchmarks/euler275-investigation.mjs compiled 18 original
RUNTIME=uncached node benchmarks/euler275-investigation.mjs reference 12 original
VARIANTS=shipping python3 benchmarks/euler275-verify.py
```

On the shipping runtime the historical `native-cache` variants simply use the
production cache. `RUNTIME=uncached` is a research-only alternate Interpreter
class that restores the old per-step capability resolution and missing FastPaths
callback while retaining all other runtime changes. It writes no runtime files.

## 2026-10-31 regression check after the test repairs

The 59.705 / 66.386 s figures came from two broad ordinary-suite runs with four
workers. An isolated source-based Vitest repeat completed in 34.518 s. Those
measurements do not form a controlled before/after comparison. The 120-second
limit introduced for the full 275 golden gives this existing large workload
headroom under parallel host load; the input, answer and algorithm are intact.

Built isolated interpreter snapshots from commits 7749fbf9 (before the 298
COW fix), e3358470 (after COW) and 40adaba7 (test repairs). Language sources and
package-lock are unchanged between these revisions, so those dependencies are
shared. Each snapshot uses its own archived sources and generated JavaScript.
The shipping 275 source is identical across all three. Node v24.15.0, macOS
arm64; no own tests, builds or oracle jobs overlap timed runs. Other host load
is uncontrolled. Each sample is a fresh process and asserts N=18 -> 15030564.

First series, rotating revision order over three rounds:

| Revision | Full N=18 median | Range |
| --- | ---: | ---: |
| 7749fbf9 | 24.496 s | 22.390-27.051 s |
| e3358470 | 23.220 s | 22.401-26.498 s |
| 40adaba7 | 25.227 s | 24.998-30.460 s |

The apparent 8.6% shift versus e3358470 warranted another comparison rather
than dismissing it. The second series alternates e3358470 and 40adaba7 in
reversed pair order, three fresh processes per revision. It includes the same
short CPU calibration before and after each case, outside the measured Rank
execution. This does not normalize or remove host variability.

| Revision | Full N=18 median | Range |
| --- | ---: | ---: |
| e3358470 | 22.899 s | 20.246-23.175 s |
| 40adaba7 | 22.990 s | 22.481-24.677 s |

The difference is now about **0.4%**, within the observed sample variation.
The first series' shift did not reproduce. Current isolated time is also
close to the earlier delivered 22.342-second median. There is no demonstrated
persistent slowdown from the COW or test-repair commits.

Additional checks:
- All three N=15 diagnostics execute exactly two Number loops, zero mixed
  loops and zero overflows. Both generated source SHA-256 hashes agree across
  revisions (6793 and 36972 characters).
- An instrumented full N=18 current run confirms the same two hashes and
  Number-only execution. It completed in 22.239 s, separately from the medians.
- The changed `writeIntegerSelection` path was called **zero** times during
  that full run. The demand-budget fix does not participate in its hot loop.
- No production performance code has been changed as part of this check.

The broad-suite timings are consistent with contention/test-environment
variation, rather than a changed search or a reproducible runtime regression.
These experiments do not identify a specific OS scheduler, thermal or GC cause.

Reproduction:

```
python3 benchmarks/experiments/euler275-build-versions.py
node benchmarks/experiments/euler275-regression.mjs
CALIBRATION=1 node benchmarks/experiments/euler275-regression.mjs followup
node --import ./benchmarks/experiments/euler275-write-probe.mjs \
  benchmarks/experiments/euler275-regression.mjs child 40adaba7 18 true
```

Raw samples and probe results are in the 2026-10-31 euler275 regression,
followup and write-probe baseline JSON files.
