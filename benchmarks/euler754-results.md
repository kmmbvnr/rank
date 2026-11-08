# Euler 754: compact accumulation, selection and prefix counters

Issue: https://github.com/kmmbvnr/rank/issues/556

The full input remains Limit=100000000 and Prime=1000000007, with answer
`785845900`. The issue's 41-second result reproduced on current Mac main.
Existing modular callback scans already handle all four `scan mulp` passes;
adding another modular scan implementation would not address the remaining
allocation and traversal costs.

## Interpreter changes first

- `.accumulate` snapshots stored Int32/Int64 operands in their packed type,
  instead of allocating one boxed BigInt per update. The existing sequential
  writer still handles duplicate addresses and widens exactly on overflow.
  The RHS snapshot is complete before any destination mutation.
- `choose` over a packed boolean mask and compact integer branches produces
  Int32 output directly. Each selected branch validates its scalar contract
  on first use; unread branches remain unread. Other shapes, broadcasting,
  wide values and opaque readers retain the general path.
- Contiguous `scan +` builds Int32 prefixes directly, avoiding a Float64
  temporary, a width scan and a narrowing copy. An overflow discards private
  output and uses the existing exact path. Bounded demand skips speculation;
  cancellation and observable-host-polling guards remain in place.

The remaining Rank changes preserve the formula and sieve algorithm:
`Sign Spot *= 0 - 1 .accumulate` replaces an allocated vector of identical
minus-one weights, and Chunk falls from 4194304 to 1048576. No problem-specific
language primitive or special-case compiler recognition was added.

## Measurement method

Node 24.15.0 on Apple M5 arm64 and Intel i7-10750H x64. Each sample uses a fresh
process, includes parsing, and excludes module imports. CPU time and peak
process RSS are recorded separately. There is one full original baseline per
host and three final samples; baseline variance was not measured. Other host
activity and frequency are not controlled. Diagnostic profiles are separate
from the full timing series. No samples are discarded.

The baseline runtime is `19e4c44d`; the original demo is frozen in
`fixtures/euler754-original.ra`. Intel's baseline build has identical runtime
sources from `7d85ffb7` (subsequent commits changed demos/publishing only).
Raw measurements and intermediate experiments are in `results/euler754/`.

Reproduce after building each revision:

```sh
EXPECTED=785845900 node benchmarks/euler754.mjs 100000000 1048576
RANK_SOURCE=benchmarks/fixtures/euler754-original.ra \
  EXPECTED=785845900 node benchmarks/euler754.mjs 100000000 4194304
```

Use the original runtime for the original baseline. `RANK_ROOT` selects another
built checkout; `DIAGNOSTICS=1` and `PROFILE=path.cpuprofile` enable separate
instrumentation. A fourth argument `reference` disables compilation.

## Full-input results

| Host | Original seconds | Final seconds | Median speedup | Original peak MiB | Final median peak MiB |
| --- | ---: | --- | ---: | ---: | ---: |
| Mac | 41.80 | 23.81 / 23.50 / 24.24 | 1.76x | 2107.06 | 668.03 |
| Intel | 88.80 | 51.87 / 51.88 / 51.42 | 1.71x | 1913.18 | 665.35 |

These are the combined interpreter and demo improvements. Intermediate runs
are not pooled with the final series: reducing Chunk alone to 262144 gave
40.97 s / 412.77 MiB on Mac; packed accumulation and choice at that same chunk
gave 32.49 s / 428.86 MiB. Scalar sign weights and Chunk=1048576 gave
25.33 / 25.53 / 26.56 s on Mac before the compact prefix optimization.
Thus smaller chunks primarily saved memory; interpreter and source changes
both contributed to speed. On Intel the latter intermediate stage took
53.72 / 53.72 / 54.16 s.

## Correctness and scope

A direct coprime-product oracle covers small inputs, several chunk boundaries
and both execution modes. Focused tests cover packed RHS snapshots, duplicate
writes, Int32/Int64 overflow, unselected branches, views, broadcasting, bitmap
tails, prefix overflow and cancellation. Full default answers match on both
hosts. All 263 focused tests passed on each host. TypeScript build, the
65-owner semantic-boundary check, application-form checks and five exclusion
policy tests passed. Full suites and exhaustive audits were not run.

The full demo remains excluded from corpus audits because it still takes tens
of seconds. The under-30-second issue target is met on Mac; it is not met on
this Intel host. The measurements do not establish a universal 30-second bound.

Runtime changes: `d10f00da`. Demo and oracle changes: `9da396aa`.
