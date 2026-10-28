# Euler 238: finite period pass and compact array packing

The periodic prefix-sum bitset algorithm, full default `Top = 2000000000000000`,
and existing fixture assertion are preserved. The answer is `9922545104535661`.
No compiler/runtime change, compiler-budget increase, lookup answer, or smaller
default input is used.

## Change and correctness

Count generator states while measuring the digit sum of one period, then reuse
that count for the second pass. This visits exactly the same states as the old
conditional loop, but permits the existing finite-range Number backend. The
original conditional loop's mutable array exceeds the 262144-cell copy-cost
cap. That cap is unchanged. Generator squares are below `20300713^2 < 2^53`.

Use 52-bit prefix words. Each word is at most `2^52 - 1`, so filling them still
uses exact safe integers. This reduces the prefix array from 2,526,461 to
1,554,745 words and the padded array from 4,194,304 to 2,097,152 words. The later
wide packing arithmetic retains arbitrary precision.

Select even and odd words directly, instead of reshaping and transposing each
level. Element `i` of the two selections is exactly `Ws[2*i]` and `Ws[2*i+1]`,
as in the former pair matrix. Keep the lazy selections and existing array sum
and shift expression. No explicit inner packing loop is added.

Diagnostics show 20,971,514 -> 8,388,604 computed cells, and 4,194,304 -> 0 typed
cells unpacked. The filling loop now runs in Number mode, with no Number
overflow in the final source. Generic bitwise-array fusion remains a possible
future improvement; this investigation does not establish a correctness bug in
the compiler.

## Comparison

Node 24.15.0, macOS arm64. Runtime rebuilt from parent `324396ef`, after Langium
generation. Each timing is a fresh process; imports are excluded, parsing,
preparation and diagnostics are included. Final samples alternate shipping and
original. Before/after `ps` snapshots record the load. No CPU-heavy Node/Vitest
process was observed at those endpoints for any final sample.

| Full input, compiled | Original | Shipping |
|---|---:|---:|
| Samples, seconds | 9.564 / 9.455 / 9.463 | 4.329 / 4.043 / 4.026 |
| Median, seconds | 9.463 | 4.043 |
| Median peak RSS, MiB | 2431.02 | 2209.67 |

The measured compiled speedup is **2.34x**. Peak RSS falls about 9%; the process
still uses roughly 2 GiB. This is not a claim that halving the packing array
halves process memory, or that the same timings apply on other CPUs.

Reference controls return the same full answer: original 44.284 s, selected
strided-array prototype 43.216 s. The final unchanged fixture also passes in
reference mode (42.937 s). These are single controls, not repeated reference
medians or evidence of a small reference speedup.

Other fresh-runtime experiments separate the effects:

- Finite pass with old 32-bit array packing: about 6.15 s compiled, 45.555 s
  reference control.
- Finite pass with 52-bit reshape/transpose packing: 4.755 / 4.751 s in two
  uncontended compiled samples, 43.709 s reference control.
- Explicit pair packing: 3.614 / 3.676 s in two uncontended compiled samples,
  44.933 s reference control. The selected array expression retains compact
  array code at a small additional cost.

Two earlier comparison samples overlapped new external Vitest workers. They
are retained in the raw data with `contended: true`, and excluded from the
uncontended comparisons above. The previous research turn's unsupervised
timings, including a suspected reference regression under changing load, are
not used for delivery claims. Endpoint snapshots cannot rule out every brief
background task, so raw samples and workload counters are included.

## Verification and reproduction

The independent oracle uses `Uint32Array` words and circular reads rather than
Rank lowering or giant-integer bitsets. It checks the full answer, whole-period
weight, small inputs, and period-boundary inputs. A separate direct substring
enumeration verifies `Top=1000 -> 4742`. The measured period has 2,534,198 states,
18,886,117 decimal digits, digit sum 80,846,691 and total weight 401,102,469.

The final source is checked against all oracle inputs, including `Dw-1`, `Dw`
and `Dw+1`. The original fixture is run in both backends. CLI checks and the
filtered differential/type corpus audits cover both files. Both execution
exclusions are removed; the defaults fit the existing 300-second corpus budget.
No full interpreter suite or Intel benchmark is claimed for this source-only
change. An initial direct Vitest invocation passed all four checks but hit an
`onTaskUpdate` RPC timeout; the final audit uses the project's existing
`type-audit.config.mjs` runner, which drains reports before long synchronous tests.

```sh
npm run langium:generate
npx tsc -b tsconfig.build.json
node benchmarks/euler238-infinitestring.mjs --original
node benchmarks/euler238-infinitestring.mjs
node benchmarks/euler238-infinitestring.mjs --reference
node benchmarks/euler238-infinitestring.mjs --fixture
node benchmarks/euler238-infinitestring.mjs --fixture --reference
node benchmarks/euler238-infinitestring.mjs --Top=1000
node benchmarks/experiments/euler238-oracle.mjs
node node_modules/vitest/vitest.mjs run packages/interpreter/test/differential.test.ts packages/interpreter/test/types.test.ts -t euler/238_ --config packages/interpreter/scripts/type-audit.config.mjs --maxWorkers=1 --minWorkers=1
```

Use `--runtime=/absolute/path/to/interpreter/out/index.js` for an isolated build,
or `--variant=finite-array`, `--variant=finite-array52`, `--variant=finite-pack`
to reproduce the captured alternatives. Sources, hashes, load snapshots,
diagnostics and verification logs are stored in
`baselines/2026-10-28-euler238-investigation.json`.
