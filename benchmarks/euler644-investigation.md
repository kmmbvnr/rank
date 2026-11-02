# Euler 644 investigation

Initial research at `90a3e4f9`, 2026-11-02. The initial measurements below
precede the delivery changes described next. The manual execution lane
remains unchanged. Worktree: `/tmp/rank644-investigation`. Delivery was integrated onto
`85215006`, including the intervening Euler 343/347 changes, then rebased
onto `2d406976` (the incoming integer-root helper change). Build, the same
274 selected tests and both scoped fixture audits passed again after that
final rebase. Full timing
series began on `90a3e4f9` plus this kernel patch; focused tests and paired
small-window controls were repeated after integration. Dates use UTC;
delivery also spans 2026-11-03 in Asia/Almaty.

The full answer is **20.11208767**. The main remaining cost is the
materialized row-sweep algorithm, with additional overhead from storage
checks, gathers, conversions and separate element-wise operations.
Scalar loop compilation is not the first target for the unchanged source.

## Delivery

The default Rank program keeps the batched matrix sweep. It uses only the
Grundy runs that can affect each second-pass block, materializes the shared
run vectors once, uses a bound derived from the existing Grundy maximum for
the mex bitmap, and replaces zero/one prefix multiplication with minimum.
The maximum search now checks every gap's endpoints and derivative roots,
partitioned at its possible inflection point. It no longer samples 41
positions or prunes candidates by `Top - 0.05`. Input defaults and all
published fixture answers remain unchanged.

Two general interpreter changes also apply to existing Rank programs:

- Stored real/Int32 axis argsort detects monotone natural runs and merges
  them stably. Only strictly descending runs are reversed, preserving ties.
- `scan * axis` on stored Int32 arrays computes checked exact prefixes
  without boxing. Safe wider prefixes use Int64 storage. The first unsafe
  prefix declines before publication, even if a later zero would make the
  final result small. The ordinary path preserves arbitrary-precision
  intermediate results. Seeded, inspection/polling and unsupported-storage
  cases retain their existing behavior.

The scalar Rank experiment was not adopted. Its sampled-maximum version
(`experiments/euler644-linear-sampled.ra`, SHA256 `a8dd39de...`) produced the
full compiled answer in 16.193 seconds and 535 MiB RSS, but its 20..100
reference execution took 17.223 seconds versus 1.899 seconds for the old
matrix source. `euler644-linear.ra` separately demonstrates stationary-point
search with that sweep. It is experimental and has not received full-default
or repeated-module validation. The default therefore preserves bulk native
execution for both engines instead of introducing that reference regression.

### Controlled delivery measurements

The delivery series runs three fresh processes for each engine and each
combination of source and runtime, alternating order. The baseline runtime
control restores the old private row sort and declines the added product
scan kernel via Node module-load hooks. All other runtime code is identical.
No production files are modified by the controls. The window is 20..100;
parsing and compilation are included. Benchmark runs assert known answers.

Mac, Node v24.15.0, medians in seconds:

| Engine | Old source + old kernels | Old source + new kernels | New source + old kernels | New source + new kernels |
| --- | ---: | ---: | ---: | ---: |
| Compiled | 2.212 | 1.782 | 1.635 | 1.619 |
| Reference | 2.166 | 1.707 | 1.465 | 1.436 |

Intel, Node v24.15.0, medians in seconds:

| Engine | Old source + old kernels | Old source + new kernels | New source + old kernels | New source + new kernels |
| --- | ---: | ---: | ---: | ---: |
| Compiled | 4.880 | 3.921 | 3.621 | 3.557 |
| Reference | 4.735 | 3.712 | 3.298 | 3.225 |

On the Mac 128 x 3700 microbenchmark (five warmed samples), the same control
measured product scan 45.458 -> 1.969 ms and argsort of representative cut
rows 9.403 -> 3.277 ms. Arbitrary-key argsort was 12.903 -> 11.740 ms.
These measurements include parsing, materialization and a copy; they are not
isolated native-call timings. The scalar-reference bottleneck remains open.

### Delivery validation

After integration onto `85215006`, nine selected files passed 274 tests,
including the incoming compiled slice-write coverage. The earlier focused
scan/argsort/Euler run passed 144 tests. A second selected run
passed 242 tests, including wide integer fallback and negative axes. These
counts overlap and must not be added. Euler coverage compares nine windows,
including point windows, against the independent sorted-event oracle in
both engines and repeats the statement window in one interpreter instance.
The unchanged Rank fixture passed scoped type and differential audits
(two cases). The fixture's repeated `run` exposed conflicting intermediate
names during implementation; the final names and repeated-run check fix it.
TypeScript build, application-form checks, semantic boundary checks and
three execution-exclusion checks passed. Full suites and exhaustive audits
were not run. The existing full-default exclusion is retained; only its
obsolete 26-minute description is refreshed.

Full default, separate single fresh-process observations:

| Host | Compiled, s | Reference, s | Peak RSS compiled / reference, MiB |
| --- | ---: | ---: | ---: |
| Mac | 158.528 | 192.387 | 4909 / 2400 |
| Intel | 354.093 | 420.597 | 5032 / 1170 |

All full runs assert **20.11208767**, with 89,526 lattice points and 1,842
Grundy runs. The final-source SHA256 is `3809e506060220c5d883c530ddca525a6a82db92e935370d18192da4721b4fe1`.
Mac full captures and Intel reference use that source. The first Intel
compiled capture (`fa66f748...`) predates comment/intermediate-name cleanup;
its numerical calculation is unchanged. Final-source Intel execution is
also covered in both modes by the paired controls. This detail is retained
in the raw hashes rather than silently relabeling the earlier capture.
Full runs are diagnostic single samples; no repeated paired full-input
speedup or memory reduction is claimed. The initial unchanged compiled
observations were 231.269 s on Mac and 513.113 s on Intel.


Reproduce the new controls with `node benchmarks/euler644-delivery-series.mjs`
and the existing kernel harness. Set `CONTROL=baseline` when using the main
harness to restore the old kernels. `original` selects the saved unchanged
source and `final` selects the production file. Raw data are under
`benchmarks/baselines/2026-11-02-euler644/`.

## Existing work

[Issue #480](https://github.com/kmmbvnr/rank/issues/480) is closed.
`cf9db8fe..99651e99` added numeric row argsort, Int32 axis scans,
real min/max broadcasting, numeric axis sums, mixed integer/real kernels
and irregular gathers. Its published full execution was about 299 seconds;
the original estimate was 26 minutes. At the start of research, the manual execution exclusion still
said 26 minutes. Those are historical observations, not current controls.

## Scale and remaining work

The full input uses 89,526 lattice points and 1,842 Grundy runs.
The first pass processes 179,050 rows; the second processes 149,006 rows
in 1,165 batches. Each full second-pass batch has 471,552 cut-point cells
and roughly 25 matrix operations. These counts include zero-width boundary
rows handled by the existing program.

Each row concatenates an ascending clipped list of starts with a descending
list of reflected starts. A linear merge can replace the general sort.
The following scans, permutations and masks can also be evaluated during
that sweep, avoiding a matrix for each intermediate statement.

A full CPU profile of the adaptive Rank prototype has these self-sample
shares (not inclusive time): storage-kind checks 9.2%, comparisons 7.6%,
row sort 6.6%, gather and its selector callback about 11.3%, dense maps 5.3%,
integer conversions 4.1%, GC 3.1%. Sorting alone cannot explain the runtime.
The type checker already caches known kinds; this profile does not prove
that it scans an unchanged buffer repeatedly. Fresh intermediate storage
and conversion paths need separate instrumentation before changing guards.

## Rank-only prototypes

`scan-min` changes `Bm scan * axis 1` to `Bm scan min axis 1`.
`Bm` contains only zero and one: both prefix operations produce one until
the first zero, then zero. Summation therefore returns the same mex.
The minimum scan uses the existing Int32 kernel; integer multiplication
scan currently uses generic exact-integer traversal.

`adaptive` also sets `Gw = 2 * (Vs max + 1)` inside each first-pass batch.
For nonnegative Grundy values at most M, XOR is below
`2^(floor(log2(M))+1) <= 2*(M+1)`. Thus all reachable XOR values fit and
at least one position in the table is absent. This removes the fixed 1024
bound. It does not remove the expensive cut matrices in either pass.

The original full compiled diagnostic run took 231.269 seconds with
4,673 MiB peak RSS. Adaptive took 217.588 seconds with 4,512 MiB RSS,
including CPU profiling. Other checks overlapped parts of both runs.
These runs establish completion and scale; they do not establish a precise
before/after speedup. The first pass took 95.405 / 87.462 seconds and the
second plus final refinement about 136 / 130 seconds respectively.

The full adaptive reference run completed in 241.876 seconds with 2,377 MiB
peak RSS and the same answer. It is a separate single sample; there is no
full original-reference control in this investigation.

Three serial fresh-process medians for window 20..100 on the Mac:

| Mode | Original, s | Scan min, s | Adaptive, s |
| --- | ---: | ---: | ---: |
| Compiled | 1.935 | 1.608 | 1.561 |
| Reference | 1.899 | 1.540 | 1.526 |

Intel small-window medians, with the same three-sample procedure:

| Mode | Original, s | Scan min, s | Adaptive, s |
| --- | ---: | ---: | ---: |
| Compiled | 4.844 | 3.993 | 3.870 |
| Reference | 4.941 | 3.909 | 3.757 |

The Mac measurements support about 19–20% improvement for the combined
Rank edits on this window. They do not establish a full-input percentage.

Intel i7-10750H / Node v24.15.0 full unchanged compiled execution took
513.113 seconds, 5,100 MiB peak RSS, with the correct answer. The queued
full scan-min follow-up was explicitly stopped, with no answer or timing
claimed; repeated small-window controls were used instead. The remote
runtime at `/tmp/rank514-delivery` matches this revision's interpreter,
language and common sources (`git diff da9619ab HEAD` on those paths is empty).

Peak RSS includes the whole process and does not measure retained matrices.
Heap retention and GC scheduling would need separate memory instrumentation.

## Independent scalar oracle and algorithm prototype

`euler644-oracle-sorted.mjs` computes each legal residual interval directly,
sorts cut events and evaluates Grundy XORs between adjacent events. It
builds no tensor permutations, prefix scans or bitmap-mex matrix.
It independently gets the full answer, 1,842 runs and maximizer
L = 315.12489168102786.

`euler644-oracle.mjs` merges the ascending and reflected lists with two
pointers and advances both Grundy lookups monotonically. The full run took
9.394 seconds and 72.7 MiB RSS on Apple M5 / Node v24.15.0, with other
work present. It gets the same answer, runs and maximizer; maximum Grundy
value is 213. The Intel full linear-merge oracle also agrees: 21.056 seconds,
75.0 MiB peak RSS. This is a JavaScript algorithm prototype, not a Rank speed
claim. A Rank rewrite must be measured in both engines before adoption.

Both oracles replace the original maximum-search heuristic. Within a
lattice gap, write the two measures as `s1*(L-1)+c1` and
`s2*(L-sqrt(2))+c2`. Then

```
2 e'(L) = s1+s2 - c1/(L-1)^2
                   - sqrt(2)*c2/(L-sqrt(2))^2
```

The second derivative has at most one zero for L > sqrt(2).
Split there, bracket derivative roots on the monotone pieces and evaluate
all roots and interval endpoints. This covers all gap maxima without the
41-point sampling, `Top - 0.05` pruning or an assumption of unimodality.
The existing heuristic agrees on the tested windows and full input; no
wrong answer was observed. No proof of its general pruning bound was found.
Floating-point lattice arithmetic and the existing 1e-12 length tolerance
remain shared assumptions; these are numerical checks, not an exact-real proof.

## General sort experiment

`euler644-natural-sort.mjs` is a Node module-load hook replacing only the
private `orderRow` function in memory. It detects ascending and strictly
descending natural runs and merges them stably. Strict descending runs
preserve ties when reversed. It has no Euler-specific shape checks.
Production interpreter files are unchanged. 64 oracle cases cover real and
integer keys, two axes, ascending/descending order, ties, empty axes and
row lengths up to 3,700. On a 128 x 3700 representative two-run cut matrix, the Mac kernel harness
measured 9.880 ms for current argsort and 3.405 ms for natural-run sorting.
The arbitrary-key control was 13.297 / 11.451 ms. Integer product scan was
47.899 ms versus 1.570 ms for minimum scan on a zero/one matrix. These are
five in-process samples after warmup, including materialization and copy.
The unchanged full source was not measured with the natural-sort hook.
More varied random-input performance and edge contracts
must be checked before considering a production change.

## Verification and reproduction

`euler644-verify.mjs` checks seven windows from 2..3 through 20..100:
original, scan-min and adaptive in both engines, 42 executions. The sorted
and linear-merge oracles also agree on all seven windows. All agree
with the independent stationary-point oracle. Published statement windows
2..10 and 10..20 retain 2.61969775 and 5.99374121.

Build the worktree first, then from its root:

```sh
node benchmarks/euler644-investigation.mjs 200 500 compiled original
node benchmarks/euler644-investigation.mjs 200 500 reference adaptive
node benchmarks/euler644-verify.mjs
node benchmarks/euler644-oracle.mjs 200 500
node benchmarks/euler644-series.mjs
node benchmarks/euler644-kernels.mjs
node --import ./benchmarks/euler644-natural-sort.mjs \
  benchmarks/euler644-sort-verify.mjs
```

`PROFILE=/tmp/profile.json` saves a CPU profile. `PROGRESS=1` instruments
first-pass progress. Use fresh processes and a process deadline for full
runs. Full-scale timings here are single samples; small-window series use
three fresh processes per variant/mode. Kernel measurements include
statement parsing, materialization and copying, with one warmup followed
by five samples, so they are not isolated native function timings.

## Remaining work

A general way to run a scalar interval sweep efficiently in reference mode
would make the linear Rank experiment more useful. That needs interpreter
profiling and matching observable behavior, rather than silently enabling
compiled loops when `compilation: false` was requested. Further allocation
and storage-check work may help the retained matrix sweep. No new language
syntax or Euler-specific primitive is introduced by this delivery.
