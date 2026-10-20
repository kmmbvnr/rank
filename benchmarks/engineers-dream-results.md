# Euler 263 search (#400)

Measured on 2026-10-20, Node 24.15.0, Apple M5. Baseline: `a7a838e6`.
Runtime refactor: `7a376158`; local membership optimization: `373a6064`.
The final demo and its bounded regressions are in `7aa2d1e1`.

Each row is one fresh process, run sequentially, with default compilation,
`testing: true` and `Count = 4`. Execution includes parsing. Static analysis
is timed separately, including lookup at every assignment/name site (a superset
of the corpus test's settled-name checks). No parallel benchmarks or test
processes were launched by this task during these samples; other system load
was not controlled. These are individual observations, not statistical medians.

| Variant | Execute | Static analysis | Execution peak RSS |
|---|---:|---:|---:|
| Baseline runtime and demo | 113.962 s | 0.072 s | 703.8 MiB |
| Local membership, original demo | 74.111 s | 0.097 s | 724.8 MiB |
| Local membership, simplified demo | 51.686 s | 0.131 s | 418.0 MiB |

Every run returned **2039506520**, with four results. The final execution was
2.20 times faster than the baseline in these samples. Static analysis is tiny
relative to execution; cold caches and run-to-run variation make these
small timings unsuitable for a speed claim.

RSS is the process high-water mark at the end of execution. After final static
analysis the final process peaked at 432.1 MiB. End-of-execution heap usage was
88.9 MiB baseline, 264.2 MiB with local membership, and 72.5 MiB final; garbage
collection timing affects these observations. They do not establish retained
heap savings. Local membership adds one lazily allocated sieve per sequence
observer: a 4 KiB segment and a bounded base-prime table (about 26 KiB at this
search's largest value; the existing global cap remains 2^20 base candidates).

A separate CPU-profiled baseline `Count = 1` run took 18.858 s. The largest
individual self-sample was `probablePrime` (5.508 s); expression evaluation,
loop dispatch, bindings and factorization also contributed. Native/inline work
is attributed by V8, so these samples are not exclusive end-to-end phase costs.

The runtime now shares the Miller–Rabin core after either small-factor screen.
Unbounded prime membership uses the existing segmented sieve after two odd
queries land in the same segment. Isolated or distant queries retain the
arithmetic path, arbitrary-precision inputs retain Miller–Rabin, and sequence
bounds still apply before primality. No demo names or constants enter runtime
semantics. Traversal and membership keep separate workspaces.

In the demo, common prime failures leave the inner loop with `continue`.
Practical-neighbour checks return on the first failure and consume distinct
factors lazily. Extracting every candidate check into a function was slower
(30.89 s for the first result), so only the rare practical checks use a helper
(10.72 s for the first result). `Start` and `Limit` bound the search for fast
regressions in both execution modes, preserving the default search range. The positive search regression
checks a narrow window ending exactly at the first paradise; it takes tens of
milliseconds rather than rerunning the entire search. Existing practical-number
checks remain.

## Independent answer check

The C++ reference uses segmented Eratosthenes, scans all even candidates without
the Rank demo's residue wheel, and checks practical numbers by prime powers and
divisor sums. It found:

```text
paradise 219869980
paradise 312501820
paradise 360613700
paradise 1146521020
sum 2039506520
```

```sh
clang++ -O3 -std=c++17 benchmarks/fixtures/engineers-dream-reference.cpp -o /tmp/engineers-reference
/tmp/engineers-reference
```

## Reproduction

After generating the language sources and building the workspace:

```sh
node benchmarks/engineers-dream.mjs
node benchmarks/engineers-dream.mjs --count=1
node benchmarks/engineers-dream.mjs --source=/path/to/original-demo.ra
npm test --workspace @arrrank/common -- test/name-facts-corpus.test.ts -t 'euler/263_engineersdream.ra' --maxWorkers=1
node packages/cli/bin/cli.js test demos/euler/263_engineersdream_test.ra
```

To repeat the old-runtime baseline, build `a7a838e6` in a separate worktree,
copy `benchmarks/engineers-dream.mjs` there, and run it there. The script asserts
the independently checked sums for counts 0 through 4.

Raw samples: [before](baselines/2026-10-20-engineers-dream-before.jsonl),
[runtime only](baselines/2026-10-20-engineers-dream-locality.jsonl),
[after](baselines/2026-10-20-engineers-dream-after.jsonl).

## Verification

- Language generation and `tsc -b tsconfig.build.json` passed.
- 420 focused interpreter tests passed: prime sequences/membership, general
  membership, numeric operations, cancellation and Number/integer loops.
- 64 common name-facts tests passed through its npm test wrapper.
- All three demo test blocks passed, including the exact inclusive upper
  bound at the first paradise. The compiled/reference differential audit of
  this fixture also passed (three test blocks, one corpus entry).
- The semantic-boundary check passed: ten script tests and 65 owners.
- Both changed demo files passed `rank check`; `git diff --check` passed.

The final default-input name-facts corpus entry passed in **103.333 s**, with
exit code zero, through the npm command above. Its existing **300 s** test
deadline was unchanged. This is a focused run: the other 1,476 corpus entries
were skipped, and the full workspace `npm test` was not run.
[Final corpus output](baselines/2026-10-20-engineers-dream-corpus.log).

An initial direct Vitest command finished the assertions in 87.279 s but exited
with an unhandled `onTaskUpdate` RPC timeout. The repository already has an
audit runner that drains pending reports before synchronous tests; interpreter
tests and local corpus shards use it. The common npm wrapper now uses the same
runner, including the CI invocation. The final corpus run above verifies that
wrapper without changing RPC or test deadlines.
