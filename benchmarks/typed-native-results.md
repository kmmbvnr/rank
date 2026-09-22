# Type-specialized builtin calls

Measured on 2026-09-22 with Node v24.15.0. This compares the same whole-loop
compiler with `typedNativeCalls: false` (generic) and the default typed kernels.
Both modes use the same algorithms, byte storage and host-effect contracts.

```sh
npx tsc -b tsconfig.build.json
# Run this command three times, sequentially:
node benchmarks/native-loop.mjs --typed
node benchmarks/aoc-chess.mjs --typed
```

## General workloads

Each case/mode runs in a fresh process, warms up with 10,000 iterations, then
measures five runs of 1,000,000 iterations. Three sequential process repetitions
give the three medians below. The ratio uses the median of those three medians.
No tests or builds ran alongside measurements. Each result is checked against
an independent JavaScript oracle; both modes must execute compiled loops.

| Workload | Generic medians (ms) | Typed medians (ms) | Speed ratio |
| --- | --- | --- | ---: |
| String formatting and prefix filtering | 120.59, 119.51, 119.01 | 101.98, 102.60, 106.38 | 1.16x |
| UTF-8 encoding, byte prefix filtering and indexing | 336.21, 332.93, 349.51 | 304.19, 304.48, 306.07 | 1.10x |
| Resident byte prefix check and integer accumulation | 55.12, 55.47, 56.27 | 36.95, 36.39, 36.29 | 1.52x |
| Unicode character conversion and lowercasing | 144.20, 140.71, 139.95 | 127.74, 127.49, 127.72 | 1.10x |
| Portable MD5 and byte filtering | 1719.72, 1717.64, 1727.88 | 1681.97, 1691.85, 1695.05 | 1.02x |

The resident-byte case checks a fixed in-memory header; it does not measure disk
I/O or end-to-end file parsing. The UTF-8 case includes buffer allocation. These
ratios describe the complete benchmark loops, not isolated builtin calls or all
Rank programs.

## Complete AoC searches

The AoC harness imports the unchanged Rank source and runs the official `abc`
input with the trusted Node backend. Three fresh-process runs per part and mode
run sequentially without warm-up. Every password and compiled-loop count is
checked. Timing includes first compilation but excludes startup/module loading.

| Part | Generic samples (s) | Typed samples (s) | Generic median | Typed median |
| --- | --- | --- | ---: | ---: |
| 1 | 6.3314, 6.2682, 6.1989 | 6.4295, 5.9663, 5.7964 | 6.2682 s | 5.9663 s |
| 2 | 9.9051, 10.3431, 10.4235 | 9.5795, 10.3982, 9.6982 | 10.3431 s | 9.6982 s |

The sum of medians is 16.6113 s versus 15.6645 s, about 5.7% less time. This is
not a separately timed combined CLI run. Samples overlap; this smaller change
should not be read as a guaranteed speedup on other machines or inputs. Both
passwords remain `18f47a30` and `05ace8e3`.

## Scope

The internal registration mechanism uses complete argument signatures and exact
builtin identities. Current kernels cover `bytes`, `startswith`, `lower` and
`md5`. Other functions can register kernels after their semantics are checked;
registration does not bypass the compiler's effect allowlist. Interactive hosts
retain the checked native wrapper, including pause/cancellation boundaries.

No AoC source or search algorithm was changed. Domain checks, array broadcasting
in ordinary calls, and fallbacks for incompatible or rebound functions remain.
