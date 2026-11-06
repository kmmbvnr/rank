# Euler 420: array prefixes and compiled gather reductions

The default `N=10000000` still returns **145159332**. The source keeps the
coprime trace-ratio/divisor-count algorithm and array operations, with one loop
in the divisor-count helper and one at the entry point. There are no nested
Rank loops.

## Source changes

- Bound each row's q range geometrically before computing gcd; derive p/q
  from selected linear indices instead of storing full coordinate grids.
- Store one parity prefix per trace, without the unused parity/zero cells.
- Find the usable prefix in each sorted pair table with `upperindex` rather
  than decrementing counters in nested loops.
- Return zero for N=0,1,2, matching independent positive-matrix enumeration.

## General compiler changes

The Number loop compiler now recognizes rank-one native integer `scan +`,
with an optional integer seed, as a fresh private array. It preserves the
seed cell and accumulation order, uses the existing buffer pool, and replays
exactly when a prefix leaves the safe-integer range. Rebinding the `scan`
syntax name invalidates entry; observable interrupt/budget execution retains
the ordinary path. Other operators, axes, callback scans and real/mixed kinds
keep their existing paths.

Function plans now support gathering a completed rank-one parameter/local by
rank-one integer indices and consuming the result with `sum`. Integer index
recipes, including explicit deferred names, stream into the Number consumer.
The exact backend completes selectors and uses native selection to preserve
bounds-validation order. An invalid speculative address replays that backend.
Captured arrays remain in the binding/snapshot proof. Ordinary eager bindings
and unused deferred recipes retain their different demand/error behavior.

The four minimal probes in `euler420-compiler-probe.mjs` now all compile their
surrounding loop. The gather helper also executes as a Number function.

## Measurements

Node 24.15.0, fresh processes, diagnostics enabled, three alternating samples.
The frozen baseline runtime is `51ef33ba`; source variants and raw diagnostics
are retained in [the result JSON](baselines/2026-11-06-euler420-followup.json).
Host load was not controlled; compare the samples, not just the best run.
Peak RSS is a process peak, not allocation volume.

| Full N=10^7, compiled | Original median | Final median | Original peak RSS | Final peak RSS |
| --- | ---: | ---: | ---: | ---: |
| Mac | 2.154 s | 1.301 s | 730.0–739.2 MiB | 460.9–462.2 MiB |
| Intel | 7.576 s | 3.526 s | 578.6–579.9 MiB | 464.2–464.6 MiB |

Same **final Rank source**, changing only the interpreter/compiler runtime:

| Compiler contribution | Baseline median | Updated median |
| --- | ---: | ---: |
| Mac | 1.902 s | 1.359 s |
| Intel | 5.734 s | 3.544 s |

Full reference execution also improves: isolated single probes were
4.014 → 2.613 s / 836.3 → 722.5 MiB on Mac and
12.190 → 7.952 s / 677.0 → 646.9 MiB on Intel. These are single observations,
not medians. Every measured run returned the full expected answer.

An ordinary helper with deferred index recipes has essentially the same
compiled Intel time (3.529 s median, versus 3.526 s for the final direct form
in that batch) and uses about 452–455 MiB. It is substantially
slower in reference execution: a Mac probe took 10.520 s. The final demo uses
the direct array expression so the uncompiled engine also benefits; the
compiler capability and helper prototype remain covered separately. The first
comparison batch also showed host noise, especially on Mac.

The earlier direct JS control remains much faster and smaller (0.224 s Mac,
0.316 s Intel, about 97 MiB). It generates only valid row-bounded pairs,
sorts encoded keys and reuses a fused prefix buffer. This is not an equivalent
generic Rank execution: the final Rank program still constructs a rectangular
mask and materializes/sorts pair arrays. Those costs remain follow-up work;
this change does not claim native-JS parity.

## Verification

- 452 targeted interpreter tests passed on Mac, including integer prefixes,
  empty/seeded scans, overflow replay, snapshots/aliases, syntax rebinding,
  budgets, gather validation, unused plans and existing function/vector suites.
- 67 targeted tests passed on Intel, including the full default answer.
- Independent positive-root matrix enumeration checks 18 small bounds on all
  three modes (default, Number disabled, compilation disabled), plus the 1000
  and 100000 checkpoints and the full compiled answer.
- Scoped type and differential audits passed for both the default source and
  its fixture: four selected audit cases. The default is restored to normal
  audit execution; the obsolete 42-second exclusion is removed.
- After rebasing onto the concurrent packed-choose/Euler 729 changes, another
  131 integration tests passed. The integrated full-answer smoke run returned
  145159332 in 1.610 s / 508.7 MiB while the test worker was also running.
- Interpreter TypeScript build and execution-exclusion policy checks passed.
  No exhaustive corpus or full workspace suite was run.

## Reproduction

Build the interpreter, preserve a separate baseline `out` tree with its
compatible dependencies, then run:

```sh
RANK420_BASELINE=file:///absolute/baseline/packages/interpreter/out/index.js \
  node benchmarks/experiments/euler420-followup-pairs.mjs
RANK420_BASELINE=file:///absolute/baseline/packages/interpreter/out/index.js \
  node benchmarks/experiments/euler420-compiler-pairs.mjs
node benchmarks/experiments/euler420-compiler-probe.mjs
```

The [historical investigation](euler420-investigation.md) retains the
algorithm variants, independent oracle and direct-JS comparison. Its reported
compiler refusals describe the baseline, before this change.
