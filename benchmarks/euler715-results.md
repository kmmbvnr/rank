# Euler 715: private modular sieve passes

Issue [#523](https://github.com/kmmbvnr/rank/issues/523) was superseded by
[#534](https://github.com/kmmbvnr/rank/issues/534). Both refer to the default
`demos/euler/715_sextupletnorms.ra` input, `Limit = 10 ** 12`, and answer
`883188017`. The earlier issue requested a run below 60 seconds.

## Profile

The original `10 ** 8` input profile had `ownedArray` as the largest named
self-time consumer (116 of 1085 samples); `mapStoredInt32Binary` accounted for
95 samples and garbage collection for 65. Other hot paths included `gather`,
`chooseStoredIntegers`, and Boolean/integer array kernels. The full baseline spent 49.44 seconds in
the Lucy sieves and 54.69 seconds in the small-prime recurrence. This points
to repeated array materialization and scans, rather than prime generation.
The reduced-input sample counts are retained in `profile-before-summary.json`;
they are diagnostic evidence, not a full-input time allocation.

## Changes

The Lucy prime-sum tables and the descending prime/exponent recurrence are
unchanged. Runtime work came first:

- Compile Boolean-to-integer scalar calls and private Boolean vector stages.
  Publish Boolean results as packed Boolean cells, preserving their shape.
- Retain fresh vector RHS results from indexed assignments without exposing
  borrowed views or reusing buffers held by an earlier loop result.
- Register guarded native scalar operations in the entry work proof. Count
  bounded, distinct prefix/tail passes instead of only a few boundary entries.
- Read only native, immutable integer entry cells, disjoint from destination
  buffers, when proving indexed loop bounds. Checked powers stay within the
  exact safe-integer domain. Copy caps and precision limits are unchanged.
- Use direct Int32 gather stores after representation and index checks; retain
  widening and exact replay for other representations. Copy Float64 snapshots
  directly rather than traversing an iterable with a conversion callback.

The demo uses `powmod` for prime cubes and reduces modular products before
subtracting them. This avoids unnecessary wide intermediates without changing
any stored residue. Finally, adjacent arithmetic expressions were combined to
remove complete passes over temporary arrays. No sieve replacement, custom
opcode, approximate arithmetic, or problem-specific compiler rule was added.

## Reproduction

Build each checkout separately, with workspace package links pointing to its
own `packages/*`, then run a fresh Node process per sample:

```sh
npm run langium:generate
node node_modules/typescript/bin/tsc -b tsconfig.build.json
node benchmarks/euler715.mjs 1000000000000
```

`RANK_ROOT` selects another built runtime. `RANK_SOURCE` selects another demo.
The harness asserts the full answer and records wall time, peak process RSS,
and completed-stage times without splitting execution. `DIAGNOSTICS=1`,
`PROFILE=path`, and `SAVE_CODE=path` are optional diagnostic modes; timings
collected with these modes are not the final timing samples.

Baseline: commit `2ff9e3c6`, original demo, one full sample on each host.
Final: three fresh processes per host, Node v24.15.0, compiled execution.
Mac is arm64; Intel is x64 on `jack.lan`. No other test or benchmark was run
concurrently on the measured host for the final samples. There is only one
baseline sample, so this is not a statistical estimate of baseline variance.
Raw JSONL results are in `benchmarks/results/euler715/`. The `jit-*` files
are intermediate exploratory runs, not the final timing series.

| Host | Baseline, s | Final median, s | Final range, s | Speedup | Baseline RSS, MiB | Final median RSS, MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Mac arm64 | 112.45 | 54.37 | 53.88–58.08 | 2.07x | 3187 | 922 |
| Intel x64 | 315.71 | 133.31 | 129.13–133.31 | 2.37x | 2670 | 693 |

All six final runs returned `883188017`. All three Mac runs met the original
60-second goal; Intel improved 2.37x but remains above 60 seconds. Median
peak RSS fell by 71% on the Mac and 74% on Intel. The speedups compare each
final median against that host's single measured baseline, not the 175-second
time in the issue.

Euler 705 was also rerun as a collateral control (one process per version
and host). These single samples check for a large regression, not small
performance differences. See the `control-*` JSONL files.

| Euler 705 control | Before, s | After, s | Before RSS, MiB | After RSS, MiB |
| --- | ---: | ---: | ---: | ---: |
| mac | 2.624 | 2.597 | 703 | 703 |
| intel | 7.538 | 7.564 | 686 | 685 |

## Verification

Validation: 734 focused interpreter checks, 23 focused language checks, the
TypeScript build, and the separately selected full-input Euler 715 test passed.
The full-input test took 65.83 seconds with diagnostics enabled on the Mac;
the final timing series uses diagnostics disabled.

The focused interpreter suites cover private vectors, gathers/scatters,
aliases, overflow replay, polling/budgets, native calls, and copy admission.
Euler 715 also has an independent multiplicative-sieve oracle on small inputs,
including prime powers and modulus boundaries, in compiled and interpreted
modes. The full compiled answer is covered by `full-scale-demos.test.ts` with
all three Number passes required and zero overflow replays.

The complete repository suite and exhaustive corpus/type/differential audits
were not run. They remain CI checks. The full Euler 715 test is selected alone
when checking this change locally.
