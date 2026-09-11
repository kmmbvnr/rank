# Judge-scale performance checks

Run the size gate separately from unit tests:

```sh
npm run bench:judge
```

This builds the checkout and runs six cases at N = 200,000. Each case has its own
Node CLI process and a 30-second wall-time limit. A timeout kills that child
process. Wrong answers, runtime failures and timeouts make the command exit with
status 1. Progress goes to stderr; stdout is a JSON report with metadata and times.

| Case | Input pattern | Main cost exercised |
| --- | --- | --- |
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
