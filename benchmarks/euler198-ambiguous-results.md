# Euler 198: batched tails and bounded stacks

Implemented on top of `48e9248d`. The demo counts exhausted Stern–Brocot chains
arithmetically and sizes its four stacks from a proven bound. **Number-loop
admission, thresholds and runtime behavior are unchanged**; the only interpreter
edit is a comment documenting the existing measured policy.

## Controlled measurements

macOS arm64, Node v24.15.0. Five serial fresh processes per variant, alternating
forward/reverse order. No builds, tests, diagnostics or oracle jobs overlapped
these timings. The timer includes parsing, compilation and execution, excludes
imports and interpreter construction. Every process checks **52374425**.

| Variant | Median | Range | Speedup |
| --- | ---: | ---: | ---: |
| Original demo | 3960.35 ms | 3898.24–4061.79 | 1.00x |
| Batched tails, original stacks | 504.72 ms | 504.23–528.30 | 7.85x |
| Bounded stacks, original traversal | 536.34 ms | 526.18–545.21 | 7.38x |
| Both, shipped demo | 180.53 ms | 176.92–184.79 | 21.94x |

The default main and the updated full fixture (three blocks) pass in both
compiled and reference engines. These separate validation runs are not timing
samples. Original reference was 47.327 s in the initial investigation.
Whole-process median peak RSS is 172 MiB original versus 174 MiB final; no
process-memory improvement is claimed. Stack capacity itself falls from 100,000
to 7071 cells each at the default input (400,000 to 28,284 total).

## Why the changes are exact

For Farey neighbours, `B*C - A*D = 1`. Following the left child keeps `A` and `B`
fixed and increases `D` by `B`. If `(B + D) * D > Half`, there can be no further
right children along that chain because the product only increases. Remaining
valid denominators form a progression ending at `Half // B`. The midpoint test is:

```
100 * (A*D + B*C) < 2*B*D
50 < D * (B - 100*A)
D > 50 // (B - 100*A)
```

`B - 100*A` is positive under the existing `Low` guard. Count the terms strictly
above this threshold, then leave the inner loop. This cuts visited inner nodes
from 52,374,475 to 1,403,950 (210,671 batched tails in the independent counter).

For stack capacity, pending right branches have strictly increasing positive
`D`: a new pending right branch has the current `D`, and the following left step
increases it by positive `B`. Popping preserves the remaining order, and the
popped branch starts with that same largest `D`. A push requires
`(B+D)*D <= Half`, which implies `D^2 < Half`. Therefore `isqrt(Half)` slots
suffice for pending branches; `isqrt(max(1, Half))` also holds the initial root when
`Half` is zero or negative. This is a bound for all supported nonnegative limits, not a
capacity chosen from the observed default stack height of 7070.

## Existing Number policy is sufficient

The old four 100,000-cell stacks exceeded the 262,144-cell copy-cost cap. The
reduced stacks qualify under the existing adaptive admission. Final diagnostics:
one Number loop/probe, one amortized copy, no overflow and no compiler rejection.
There is no need to change the general policy for Euler 198.

The initial research also tested bypassing the cap and feedback gate in an
isolated runtime copy. That prototype is **not shipped**. The user pointed out
that the policy had already been measured on Mac and Intel; the final code keeps
it and documents the reason beside its constants. See the
[existing Mac/Intel policy report](condition-loop-feedback-results.md), including
short-call controls and remaining heuristic limits.

## Verification

- Main golden `52374425`, plus existing checkpoints `120`, `200000`, `1000000`.
- New fixture block covers negative/zero limits, strict midpoint boundaries, odd limits and 4095.
- 80 independent oracle checks: 20 limits from 0 to 10,000, original/stack-only/
  final compiled source and final reference source. The oracle enumerates coprime
  denominator pairs and solves `B*C - A*D = 1`, rather than walking the tree.
- Both default main and all three fixture blocks pass in both engines.
- 173 existing Number-loop/adaptive-policy tests pass, including short phases,
  copy cap, overflow replay, aliases and error state. No runtime behavior changed.
- Forced type/differential checks cover both Euler 198 files; the historical
  execution-budget exclusion is removed only in the temporary validation copy.
  Repository exclusions and deadlines are unchanged.

## Reproduction

Build the interpreter, then run each timing sample in its own process:

```sh
node benchmarks/euler198-ambiguous.mjs
node benchmarks/euler198-ambiguous.mjs --variant=original
node benchmarks/euler198-ambiguous.mjs --variant=tail
node benchmarks/euler198-ambiguous.mjs --variant=stack
node benchmarks/euler198-ambiguous.mjs --diag --generated
node benchmarks/euler198-ambiguous.mjs --limit=10000 --oracle
node benchmarks/euler198-ambiguous.mjs --fixture --reference
```

`--runtime=/absolute/path/to/out/index.js` selects an isolated build. `original`,
`tail` and `stack` are controls constructed in memory; they do not rewrite demos.
The original control's source hash matches the unmodified demo at `48e9248d`.

[Final raw samples and checks](baselines/2026-10-27-euler198-optimization.json) ·
[Initial investigation, isolated prototype and node counter](baselines/2026-10-27-euler198-investigation.json).
