# Euler 735: numeric gather sums and disjoint floor-sum intervals

Issue [#540](https://github.com/kmmbvnr/rank/issues/540) requests a several-fold
speedup of `735_divisorsoftwo.ra`, preserving its full answer and profiling
the dominant array operation. Work was done in `perf/issue-540` in a separate
worktree. Baseline `491ccf1b` already includes the recent nightly regression
repairs. Limit stays 1000000000000 and Budget stays 16777216.

The full answer remains **174848216767932**. Work decreases from 1306770001
to 367376292 floor-sum terms. Changes include both the compiler and the Rank
solution; the compiler changes alone do not explain the full speedup.

## Measurements

Three alternating pairs of fresh processes per machine, Node v24.15.0,
profiling and diagnostics disabled. Median execution time includes parsing,
excludes module imports. Peak RSS is the process high-water mark. Each
checkout uses its own compiled interpreter and language package; external
unchanged dependencies may be shared.

| Full default | Baseline time | Final time | Speedup | Median peak RSS before → after |
| --- | ---: | ---: | ---: | ---: |
| Mac arm64 | 46.475 s | 16.135 s | 2.88x | 4864.0 → 2991.6 MiB |
| Intel i7-10750H, Linux x64, CPU 4 affinity | 125.277 s | 33.406 s | 3.75x | 7212.9 → 2593.7 MiB |

All twelve paired runs returned the full answer. Mac CPU-time medians were
55.876 → 18.250 s; Intel CPU-time medians were 125.118 → 33.348 s. Mac RSS
samples vary with GC, but every final paired RSS sample is below every baseline
sample. The final workload still needs several GiB; it is not memory bounded
by Budget alone.

| Machine / version | Time samples, s | Peak RSS samples, MiB |
| --- | --- | --- |
| Mac baseline | 42.564, 46.475, 48.788 | 6701.1, 4864.0, 4403.4 |
| Mac final | 16.740, 16.048, 16.135 | 2410.8, 3346.2, 2991.6 |
| Intel baseline | 122.222, 125.277, 126.322 | 7212.9, 7210.5, 7216.9 |
| Intel final | 33.267, 33.406, 34.136 | 2593.7, 2634.5, 2528.9 |

The initial unpaired Mac baseline was 50.897 s / 3906.4 MiB. Initial and
profiled runs are retained separately and do not enter the table. Raw data:
[`results/euler735`](results/euler735).

## Compiler first

Commit `0e672574` changes the general integer layout consumer:

- A large input previously rejected by the 64-cell wide-sum cost cap can
  qualify when total conversion work is at most one quarter of output cells.
  Repeated gathers amortize the copy; equal-size wide sums retain their cap.
- Uniform native binding checks remain in the first iteration. For consumers
  of at least 64 cells, subsequent iterations omit those already-settled
  checks. Nonuniform checks still run at every visited cell. Empty consumers
  perform no checks; selected consumers start with the first selected cell.
- Checked integer floor division uses a quotient/product correction when
  `abs(a) + abs(b)` fits the safe-integer range. The product is exact there;
  other cases keep the remainder-based fallback. Zero divisors, unsafe loads
  and accumulator overflow replay through the exact consumer.
- Optional diagnostics separately time numeric sum and index-validation work.

A repeated wide-gather/division/sum probe checks its answer independently.
Median time/RSS across three fresh processes:

| Compiler probe | Baseline | Compiler | Peak RSS before → after |
| --- | ---: | ---: | ---: |
| Mac, 1048576 terms | 153.888 ms | 131.871 ms | 183.6 → 155.0 MiB |
| Intel, same probe, CPU 4 | 477.110 ms | 371.586 ms | 169.4 → 138.1 MiB |

These are useful but modest compiler gains. Simply making every intermediate
lazy was slower. The final Rank solution exposes only Index, Divided and Term
as deferred expressions, allowing the final sum to consume one numeric loop
without storing the division and multiplication results.

## Then combine the mathematical work

Commit `e201c384` combines weighted floor-sum prefixes before expanding terms.
For one numerator Y, a prefix ending at k contributes
`weight * sum(floor(Y / d), d=1..k)`. Sort and combine equal (Y,k) events.
On each disjoint interval `(previous k, k]`, the coefficient is the sum of
weights of all prefixes whose endpoints have not expired. Intervals with
zero remaining weight disappear. The scalar corrections from the original
Mobius decomposition remain unchanged.

Endpoints fit in 0..Root, so `Y * (Root + 1) + endpoint` is an injective integer
key. Existing unique/sort, lowerindex, keyed sum, scan and mask operations
build the groups and suffix weights. Integer arithmetic preserves exact keys;
no floating-point encoding or truncation is introduced. The loop divides by
the actual interval start plus its local offset. It still uses the original
bounded chunking scheme and the same Budget.

This reduces the default term count by 71.9%. The whole outer loop still
declines compilation; native tensor consumers perform the heavy arithmetic.
The full diagnostic run records 22 Number tensor consumers, versus zero in
the baseline. Published typed-array cells fall from 12.270 billion to 2.033
billion; these are cumulative cells, not peak bytes.

## Profiles and rejected experiments

Separate full-input CPU profiles attribute 14034 baseline self-time samples
to stored integer arithmetic, 5443 to gather and 3700 to Int32 scan. The final
profile has 1305 samples in stored integer arithmetic; generated consumers
and scans dominate instead. Summaries are `profile-before.json` and
`profile-final.json`. Profile timings are not used as paired timing samples.

Intermediate probes in `results/euler735/rejected` are diagnostic evidence,
not controlled final comparisons:

- Deferring Run as well as the arithmetic prevented the intended native
  frontend from handling that chain. A 10^10-input probe took 9.590 s; that
  form was discarded.
- Interval-bound arithmetic specialization added complexity without a useful
  gain (about 2.14 versus 2.19 s in probes). It is not in the patch.
- Hoisting buffers/limits/scalars did not help (4.32 s versus a preceding
  2.80 s probe) and was removed.
- Combining only identical prefixes left 33.897 million terms at 10^10;
  disjoint intervals reduce that to 16.385 million. Only the latter design
  is retained.

## Regression controls and verification

The original Euler 735 source at Limit=10^10 / Budget=1048576 and the full
Euler 234 source were also measured against the compiler change. Mac controls
were noisy: one original-735 series had medians 3.040 → 4.136 s; a reverse-order
recheck had 5.325 → 4.129 s, with CPU medians 8.057 → 6.894 s. These do not
establish a consistent slowdown or a reliable speedup. Both series are kept.
Mac Euler 234 ranged 231–380 ms before and 224–457 ms after.

Intel CPU-4 medians were 9375.8 → 8954.8 ms for the original small Euler 735,
and 682.7 → 676.5 ms for Euler 234. RSS medians were 707.9 → 710.4 MiB and
176.6 → 176.7 MiB respectively, with overlapping sample ranges. There is no
consistent time regression. Small RSS differences on controls are consistent
with allocator noise and do not establish a fixed memory increase. Full-input RSS savings are
much larger and consistent across every paired sample.

Verification after integrating upstream `0c7d30dd` at `6dad812b`:

- 428 tests across 16 focused files passed, including the updated numeric
  function/rank tests and the full Euler 421 answer from main.
- The full Euler 735 test passed separately, with the full bound and a Number
  tensor assertion. The 68 small-input/budget tests run in both compilation
  modes and compare to direct divisor enumeration, independent of Mobius
  decomposition, prefix grouping and chunk construction. Published checks
  [F(15)=63 and F(1000)=15066](https://projecteuler.net/problem=735) agree.
- New compiler tests cover signed division near safe-integer boundaries,
  uniform/nonuniform validation, selected first cells, raw-input refresh,
  exact overflow fallback and the preserved equal-size wide-sum cap.
- TypeScript build, semantic boundaries (65 owners) and application-form
  checks pass. No exhaustive audit or full npm test was run.

The primary paired data use compiler `0e672574` and Rank source `e201c384`.
After the upstream merge, a separate complete run retained the full answer
and term count in 15.817 s / 2998.0 MiB (`integrated-mac-full.jsonl`).

## Reproduce

Build each checkout and keep its `@arrrank/language` link local to that checkout:

```sh
npm run langium:generate
node node_modules/typescript/bin/tsc -b tsconfig.build.json
node benchmarks/euler735.mjs
RANK_ROOT=/path/to/built/base RANK_SOURCE=/path/to/base/demos/euler/735_divisorsoftwo.ra node benchmarks/euler735.mjs
node benchmarks/experiments/euler735-gather.mjs
node benchmarks/experiments/euler735-control.mjs
DIAGNOSTICS=1 PROFILE=/tmp/euler735.cpuprofile node benchmarks/euler735.mjs
```

On the saved Intel host, use Node 24.15.0 at `/opt/rank-bench-node/bin/node`
and `taskset -c 4`. Alternate baseline/final order; run one process at a time
per machine. Run focused tests from `packages/interpreter` through the audit
config; select `full-scale-demos.test.ts -t 735` for the full-answer test.
