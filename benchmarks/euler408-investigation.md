# Euler 408 investigation

Historical research on `fbc76219`. Its load hooks require that runtime.
See [euler408-followup.md](euler408-followup.md) for the delivered
implementation, regression coverage and final measurements.

Research base: `fbc7621940c60929cac57d94d9bd56ee955168aa`,
Node 24.15.0, 2026-11-05, Apple M5 arm64 and Intel i7-10750H x64.
Production source and the issue are unchanged. These are research prototypes.

## What is slow

The demo retains a sensible first-forbidden-point recurrence, rather than
counting all grid paths explicitly. At N=10^7 it has **7850 forbidden points**.
The dense point test examines **9,998,244** pairs. The recurrence computes
transitions for every earlier point, including points above the current y,
then masks those impossible transitions after expensive binomial arithmetic.

A diagnostic staged run on Mac attributes 2.950 s to points, 0.192 s to
factorials, 0.179 s to inverse factorials and 9.376 s to the recurrence.
These are separately executed source chunks, not additive timings of the
unsplit benchmark; staging/parse facts and load can affect absolute time.
The staged and whole programs exhibit the same three Number overflows.

The direct compiler defect is **premature checking of the vector product**
in `A * B mod P`. Vector lowering computes a safe Number cell for `A * B`
before its enclosing modulus. A product near 10^18 fails, even though its
residue fits in an Int32. The scalar backend already has an exact bounded
modular multiplier; the vector path does not reach it with scalarized leaves.

The load-hook prototype exposes the original product operands and modulus
together, so existing scalar modular lowering computes each residue directly.
It preserves the existing checked multiplier and exact replay; it does not
round products or raise Number/copy thresholds. The unchanged full original
then runs in 6.997 s / 1438 MiB in one Mac probe, versus 10.265 s / 1665 MiB
in the initial profiled run, with all three Number overflows removed.
These initial samples are exploratory, not the final controlled medians.

A minimal repro is `experiments/euler408-modular-repro.ra`: the correct result
is `2 12`. Current main has two failed Number attempts, the prototype one
successful Number loop with zero overflows.

## Program alternatives

The final candidate keeps array code and one recurrence loop:

1. Modular factorial/inverse tables use existing `scan * with ... mod P`,
   removing two scalar loops and helping reference execution directly.
2. Predecessors are selected by `Y at most Yi` before computing their
   differences/binomial coefficients. Impossible transitions are omitted.
3. A pure `forbidden` function generates Euclidean primitive Pythagorean
   triples, their positive scales, both orientations and sorted packed keys.
   The same 7850 points come from **566** valid primitive triples. A small
   rectangular expansion tests 447,140 scale positions instead of almost
   ten million square-sum roots. Triangular pair unranking needs only 3081
   initial parameter pairs at this input. The function has no loop.
4. The descending range is passed directly into its scan, avoiding a named
   completed range. Reverse already builds completed numeric storage, so
   its additional explicit `copy` is removed. No implicit change to `=`.

The parameterized generator is longer than the original dense-grid expression;
its benefit is explicit: far fewer roots and lower memory. A simpler candidate
that keeps the dense point grid but uses scans/predecessor selection obtains
4.573 s compiled / 10.367 s reference in single Mac probes. The parameterized
version is the preferred performance candidate, subject to normal style cleanup.

## Scratch-buffer experiment

The private pool reuses dead buffers, but exact-size allocations can repeat
when a vector grows by a few cells on each iteration. Rounding capacity in a
research load hook lowers allocation churn without changing logical shape.
The pool experiment rounds only buffers up to 2^20 cells; this is an experimental
allocation policy, **not a new Number admission limit**. It is not ready to ship
without controls on other growing/fixed-size workloads, retained aliases,
publication, empty shapes, errors and cancellation. A production policy should
consider actual growth and retained capacity rather than blindly copying this
experimental cutoff. The logical array remains a view of exactly its requested
length, and pinned/live buffers retain their existing exclusion from reuse.

Two additional range-fold/stream-scan load-hook probes did not materially
improve this default workload; no further benefit is claimed for those ideas.
They were not selected for the candidate.

## Verification and limits

- **78 comparisons on each host**: three Rank sources, 13 bounds from 0 to
  1000, both compilation settings, against an independent full-cell rolling
  grid DP. Both the answers and the complete sorted forbidden point lists match.
- Statement values P(5)=252, P(16)=596994440 and P(1000)=341920854 match.
- Every measured full run retains **299742733**. The manual JS control also
  independently builds/sorts the point set and retains the full answer.
- Twenty-two full controlled runs plus six pool runs check the full golden.
- Only research scripts were added; no runtime fixes, full suite, exhaustive
  audit, Git commit/push or GitHub update was performed.

The modular load hook is an integer-only proof of concept. A production fix
must retain existing real-vector paths and add regression coverage for signed
operands, different/empty broadcast shapes, large/invalid moduli, ordinary
completed bindings, builtin/operator rebinding, error attribution, aliases,
observable budgets and cancellation. The pool experiment needs separate tests
and broader measurements; this investigation does not establish a global win.

## Reproduce

From the repository root, after the normal TypeScript build:

```sh
node --import ./benchmarks/experiments/euler408-modular-prototype.mjs \
  benchmarks/experiments/euler408-verify.mjs
node benchmarks/experiments/euler408-repro.mjs
node --import ./benchmarks/experiments/euler408-modular-prototype.mjs \
  benchmarks/experiments/euler408-repro.mjs
python3 benchmarks/experiments/euler408-series.py
python3 benchmarks/experiments/euler408-pool-series.py
node benchmarks/experiments/euler408-hand.mjs
```

Main series: three fresh sequential compiled processes per variant, alternating
forward/reverse order per round; then one reference sample per source. The pool
series is a later separate three-sample experiment. Parsing/execution are timed
after imports and interpreter construction. Peak RSS covers the whole process.
The Mac is shared with other sessions. No production output files are patched:
the prototype hooks alter module text only in their fresh process.

The manual JS uses the same mathematics and the existing exact modular
multiplier, but omits Rank binding/error/replay/polling contracts and vector
materialization boundaries. It indicates further headroom, not a directly
substitutable implementation.

## Controlled results

Seconds / MiB peak RSS; compiled medians of three fresh processes:

| Variant | Mac M5 | Intel i7-10750H |
| --- | ---: | ---: |
| Original compiled | 10.142 / 1624.4 | 29.305 / 1041.1 |
| Candidate, current compiler | 5.287 / 860.8 | 15.508 / 586.7 |
| Candidate + modular compiler prototype | 1.818 / 778.7 | 4.456 / 538.4 |
| Candidate + compiler + pool prototype | 1.735 / 568.1 | 4.389 / 480.7 |

The main alternating series gives **5.58x Mac / 6.58x Intel** overall
speedup and **52% / 48% lower peak RSS**. Same-candidate compiler controls
give **2.91x / 3.48x**. The later pool series has roughly similar timing and
reduces candidate scratch-run peak RSS by **27% / 11%**. That separate series
does not establish a general pool policy win across other programs.

Single reference samples:

| Source | Mac seconds / MiB | Intel seconds / MiB |
| --- | ---: | ---: |
| Original | 34.458 / 1565.7 | 114.093 / 993.1 |
| Candidate | 5.326 / 713.2 | 15.670 / 495.8 |

Reference benefits from the program/library changes without the compiler
prototype: **6.47x / 7.28x** in these single-sample comparisons. Timing
uncertainty is greater than for the compiled three-sample medians.

Manual JS single controls: **0.498 s / 205.9 MiB Mac**, **1.428 s /
208.3 MiB Intel**. Rank still has execution/materialization overhead; the
manual program does not implement its observable contracts.

[Raw samples, profile summary, reproduction hashes and verification](baselines/2026-11-05-euler408-investigation.json).
