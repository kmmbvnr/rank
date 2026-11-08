# Euler 797: compile the existing prime sieves

Issue: https://github.com/kmmbvnr/rank/issues/564

The unchanged `797_cyclogenic.ra` computes `47722272` at `Limit = 10^7`.
All three prime-by-prime loops now use private numeric buffers. No Rank
algorithm, batching API or `.accumulate` rewrite was needed.

## Compiler changes

A final scatter such as `Zeta Dst = Fresh` returns its right-hand side.
The numeric loop compiler previously accepted a fresh array expression there,
but rejected a named local even when its array was complete and immutable.
It now retains that local result. The existing result-liveness machinery
protects its buffer from reuse; the region's mutation and alias checks reject
sources that could change after escaping. Compound assignments and input
arrays keep their previous admission rules.

This alone did not help Euler 797: copying the large destinations still failed
the loop's cost check. The shared entry-work proof now reads the native length
of an immutable packed integer input in expressions such as `Primes len`.
It can then combine bounded sampled prime values with the existing work proof
and establish that the complete loop amortizes its destination snapshots.
This is only a cost proof; checked integer arithmetic, exact modular products
and overflow replay are unchanged. Unknown storage and rebound inputs remain
conservative.

Budgeted execution declines the newly admitted retained-result path before
any private execution, preserving the existing exact compiled tier's demand
charges and visible writes. The pre-existing difference between compiled array
expression charges and fully interpreted expression charges is not changed.
Observer boundaries continue to use the ordinary execution path.

## Measurements

Node v24.15.0, `--max-old-space-size=8192`, diagnostics enabled, fresh process,
full parse and execution included. RSS is the process high-water mark.

| Full default | Time | Peak RSS | Numeric loops |
| --- | ---: | ---: | ---: |
| Mac arm64, before | 56.12 s | 1629.9 MiB | 0 |
| Mac arm64, after | 5.78 s | 728.8 MiB | 3 |
| Intel i7-10750H x64, after | 13.60 s | 679.6 MiB | 3 |

Both machines meet the issue's 30-second target. The full answer agrees with
the old compiler on Mac and with the optimized compiler on both architectures.
The Intel before-time was not remeasured. These are individual runs, not
statistical distributions; earlier optimized full runs were 5.89 s on Mac and
13.79 s on Intel.

The before run uses the same compiled package with `entry-work-proof.js` and
`number-loop-scatter.js` transpiled from base commit `0738ffde`; the remaining
new plan flag defaults to false and cannot enable the optimization. No profiler
or other task test process ran during the recorded before run.

An initial profiled 1-million-element run spent much of its time in garbage
collection, owned-array creation and array metadata. After both compiler
changes that input fell from 6.33 s / 766.6 MiB (profiled) to
0.76 s / 409.5 MiB (unprofiled). This probe identified the bottleneck; its times
are not a controlled speedup comparison because profiling was only enabled
for the before run.

## Verification

- 373 focused interpreter tests on Mac: scatter results, duplicate destinations,
  local/source aliases, buffer reuse, overflow replay, invalid indices, early
  exits, observers, demand budgets, entry-work proofs and vector arithmetic.
- After integration with the concurrent Euler 495 compiler changes, another
  165 focused tests passed, including both Euler solutions and modular axis
  scans, inferred reshapes and private function returns.
- 90 focused tests on Intel: scatter results, vector entry work and Euler 797.
- An independent exact BigInt oracle constructs cyclotomic factors by division
  over all divisors, then computes the primitive divisor products. It agrees
  with both compilation modes for limits 1, 2, 10, 31, 64 and 100, including
  the published `Q10 = 5598`. Alternate small and wide prime moduli are covered.
- Limit 1000 agrees with the independent oracle and uses all three numeric loops.
- The full default is covered by the targeted `full-scale-demos.test.ts` case,
  with answer `47722272`, three numeric loops and no overflow replay.
- TypeScript build and semantic-boundary checks pass. Exhaustive corpus audits
  and the full repository suite were not run.

The expensive reference run stays excluded from repeated corpus audits;
compiled full-scale coverage is now explicit.

```sh
npx tsc -b tsconfig.build.json
EXPECTED=47722272 node --max-old-space-size=8192 benchmarks/euler797.mjs
npm test --workspace @arrrank/interpreter -- test/euler797.test.ts
npm test --workspace @arrrank/interpreter -- test/full-scale-demos.test.ts -t 797
```

The driver also accepts a positional limit, `COMPILED=0`, `RANK_SOURCE`,
`RANK_INTERPRETER` and `PROFILE=/path/to/profile.cpuprofile`.
