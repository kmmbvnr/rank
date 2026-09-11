# Judge-scale performance checks

Run the size gate separately from unit tests:

```sh
npm run bench:judge
```

This builds the checkout and runs eight cases at N = 200,000. Each case has its own
Node CLI process and a 30-second wall-time limit. A timeout kills that child
process. Wrong answers, runtime failures and timeouts make the command exit with
status 1. Progress goes to stderr; stdout is a JSON report with metadata and times.

| Case | Input pattern | Main cost exercised |
| --- | --- | --- |
| Grid Paths | Open square grid up to 1,000 by 1,000 | Dense dynamic-programming writes |
| Static Range Minimum Queries | Descending values; every query spans the array | Segment construction, queries and full output |
| Restaurant Customers | Disjoint intervals | Returning a growing queue of records; sorting events |
| Room Allocation | All stays overlap | Growing priority queue of record payloads; full allocation output |
| Playlist | Repeated half-length block | Index updates and lookups |
| Reading Books | Repeated lengths 1 through 97 | Numeric reductions |
| Maximum Subarray Sum II | All ones; lengths 10 through 1,000 | Prefix scan and sliding ordered multiset |
| Sum pipeline | Repeated signed values | Literal `A sum print` pipeline |

Expected outputs are derived from the generated input patterns independently of
Rank. The harness compares the complete output, including every allocated room.
These are selected regression workloads, not a coverage claim for all CSES inputs.
The normal demo tests remain necessary.

## Options

After building, call the script directly:

```sh
node benchmarks/judge-scale.mjs --size=1000
node benchmarks/judge-scale.mjs --only=restaurant --timeout-ms=10000
node benchmarks/judge-scale.mjs --checkout=/path/to/built/baseline
node benchmarks/container-resources.mjs
node benchmarks/container-resources.mjs /path/to/built/baseline/packages/interpreter/out/index.js
```

`--size` accepts 1 through 200,000. `--timeout-ms` adjusts the per-case budget for
the machine. The checkout option changes the runtime, while the harness always
uses its own version of the demo sources. Build both checkouts before comparisons.
Recorded source revisions do not prove compiled output is current.

Judge-scale times include process startup, parsing, input and output. They are
cold end-to-end checks with a coarse timeout, not microbenchmark speed claims.
Run them without concurrent test or benchmark jobs. The container microbenchmark
parses once, warms up twice at N = 100, and measures three fresh containers at each
of N = 5,000, 10,000 and 20,000. It checks returned sizes after each invocation.

## Resource-scan fast path

Runtime-created queue/deque/stack/heap, index/set/counter and record values have
resource summaries. A proven file-free result skips both ownership discovery and
function-return escape scanning. Numeric updates and composition of proven
file-free containers do not require a content walk.

Summaries are conservative. Inserting a file or an unknown value invalidates older
proofs through a shared mutation epoch. This includes summaries of parents that
hold an alias to the changed container, even across interpreter instances. Public
Map writes go through the same tracking hook. Cycles require no parent links or
recursive invalidation. Existing file discovery and cleanup remain the fallback.

This is deliberately not a global “no registered files” shortcut: host functions,
imports and lazy values can introduce files not yet known to the caller. Ordinary
mutable arrays and untracked host containers are uncertain. Invalidated summaries
are not rebuilt, even after deletion or file closure; unrelated older containers
may therefore lose the fast path too. Newly constructed containers start with a
fresh summary. Narrower invalidation and recertification are possible later work.

JS tests check zero iteration of resource-free containers, not elapsed time. They
also cover nested aliases, cyclic parents, public Map mutation, imported files and
lazy file discovery. Existing file lifetime and generator tests still apply.

## Measured baseline

Measured on 2026-09-11, Apple M5, macOS arm64, Node 24.15.0. The baseline runtime
was `9f57f7d`; the candidate was `d4ed1c5`. Both were built before measurement.
No assistant-launched tests or benchmarks ran concurrently; unrelated machine
activity was not controlled.

Container microbenchmark medians, milliseconds (three samples):

| Workload | N | Before | After |
| --- | ---: | ---: | ---: |
| Return growing set | 5,000 | 156.9 | 12.8 |
| Return growing set | 10,000 | 584.2 | 24.4 |
| Return growing set | 20,000 | 2260.3 | 41.6 |
| Heap enqueue | 5,000 | 189.3 | 2.5 |
| Heap enqueue | 10,000 | 742.5 | 3.4 |
| Heap enqueue | 20,000 | 2958.4 | 6.1 |

The baseline approaches four times the cost when N doubles. The candidate no
longer shows that quadratic growth on these numeric workloads.

Two complete judge-scale runs at N = 200,000, seconds:

| Case | Run 1 | Run 2 |
| --- | ---: | ---: |
| Restaurant | 2.818 | 2.823 |
| Rooms | 1.855 | 1.875 |
| Playlist | 0.771 | 0.776 |
| Books | 0.182 | 0.183 |
| Bounded sum | 1.010 | 1.017 |
| Sum pipeline | 0.179 | 0.177 |

All complete answers matched. The original runtime's restaurant process exceeded
the 30-second budget and was killed; its eventual completion time was not measured.
The original `A sum print` also failed the answer gate because it was misidentified
as a Fenwick operation. The fix checks the receiver type before selecting Fenwick
syntax and retains normal sum dispatch for other receivers. A forced one-millisecond
timeout verified the harness failure path separately.

The scalar benchmark pair stayed close for ordinary counted loops and calls:
summation 8.0 → 7.9 ms, calls 15.2 → 15.0 ms, and indexed reads 13.5 → 13.5 ms.
Tail recursion was slower in this pair (22.3 → 24.3 ms; accumulator variant
25.5 → 27.5 ms). A single pair does not establish whether this 8–9% difference is
stable. Memo workloads were slightly faster; cached calls rounded to 0.1 ms in both
versions. No blanket scalar speedup or zero-regression claim is made.

[Raw results](../../benchmarks/baselines/2026-09-11-container-resources.json) retain
all microbenchmark samples, scalar output, both judge-scale runs and failure-gate
checks. These local times are evidence for this change, not universal time limits.
The final verification passed 395 JS tests and the tests in 134 demo files.
