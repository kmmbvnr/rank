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
The initial unbounded prime membership used the existing segmented sieve after two odd
queries land in the same segment. Isolated or distant queries retain the
arithmetic path, arbitrary-precision inputs retain Miller–Rabin, and sequence
bounds still apply before primality. No demo names or constants enter runtime
semantics. Traversal and membership keep separate workspaces.

The later [adaptive membership policy](adaptive-prime-membership-results.md)
varies this warmup with observed locality and reuses an already prepared segment.
It replaces a fixed 32-query experiment that slowed the full Euler 263 search.

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

## Follow-up: practical-number wheel

On the same Node/CPU, two sequential fresh processes using runtime `8731fffa`
measured the old demo at **54.745 s** and the new wheel at **9.663 s** (5.67 times
faster). Both asserted four results and the sum 2039506520. Execution peak RSS
was 441.8 MiB and 276.1 MiB respectively; these individual observations do not
establish retained-memory savings. Static name analysis took 0.173 s and
0.185 s respectively.

The wheel is derived rather than hard-coded. For values above 4, a practical
number congruent to 2 modulo 4 must have factor 3. Five neighbours spaced by 4
cannot all satisfy that condition, so the candidate must be divisible by 4.
A practical neighbour congruent to 4 modulo 8 must have an odd prime factor
no greater than 7. Applying those necessary conditions and the existing
prime-offset screen leaves residues **20 and 820 modulo 840**: two candidates
instead of the old wheel's 24 candidates per 840 integers. The default search
starts at 210, so all practical neighbours are above the small exceptions.

The five demo test blocks pass in both compiled and reference execution,
including an upper bound one below the first result and an inclusive single-
number range at another result. A separate CPU-profiled full wheel search
attributed 3.125 s of self-samples to sieve segment preparation; expression
evaluation, loop dispatch and resolution still contributed.

Raw samples: [before wheel](baselines/2026-10-20-engineers-dream-wheel-before.jsonl),
[after wheel](baselines/2026-10-20-engineers-dream-wheel-after.jsonl).

The default name-facts corpus entry passed through the common npm wrapper in
15.802 s with the wheel, retaining its 300 s deadline.

## Follow-up: builtin membership in compiled loops

The loop compiler previously read variables only, so bare `primes` was mistaken
for an index receiver and rejected at entry (`loop:input-type:primes`). It now
also reads builtin sequences whose catalogue contracts say they are zero-operand,
callback-free, effect-free integer sequences. Current user bindings take
precedence, unopened modules stay unopened, and the existing runtime membership
certificate and binding guards still decide eligibility. Fibonacci plans now
register that same certificate, including their bounded/filtered variants.
There is no builtin-name whitelist.

The new `direct-membership` case in `prime-sequences.mjs` counts the 78,498 primes
below one million with `if N in primes` inside a Rank loop. Three fresh processes
per runtime measured median execution **1.133 s before, 0.454 s after** (2.50 times
faster). Cold-process medians were 1.676 s and 0.956 s. The comparison runtime is
the prior worktree build at `1319f29e`; the unrelated tensor rejection-counter
change in `8731fffa` is not active in these benchmark runs.

```sh
node benchmarks/prime-sequences.mjs --cases=direct-membership --trials=3 --baseline=/path/to/old/packages/interpreter/out/index.js
```

This does **not** establish a further speedup for the full Euler search. With
the same wheel source, three alternating old/candidate pairs produced:

| Trial | Original runtime | Builtin-loop candidate |
|---|---:|---:|
| 1 | 12.274 s | 11.228 s |
| 2 | 12.073 s | 11.787 s |
| 3 | 9.412 s | 13.983 s |
| Median | 12.073 s | 11.787 s |

System load was not controlled, and the spread exceeds the median difference.
An earlier unmatched 9.663 s / 11.549 s pair was insufficient to distinguish a
regression from that variation. The specific entry rejection disappears in a
bounded diagnostic run, but sieve preparation and interpreted work remain.
Execution peak RSS in the alternating pairs ranged from about 276 to 280 MiB
for both runtimes; no retained-memory savings are claimed for this change.

Seven new tests check actual compiled execution for direct `in`/`not in`,
Fibonacci membership, cached-entry shadowing, receiver rebinding, an unopened
module behind a false branch, and the disabled compilation option. Final checks
passed: 560 focused interpreter tests, 64 common name-facts tests, all five demo
test blocks, their compiled/reference differential audit, both demo static
checks, workspace TypeScript build, and the semantic-boundary checks. The full
workspace `npm test` was not run.

With both follow-up changes, the final default name-facts corpus entry passed
in **14.294 s**, still using the original 300 s deadline.
[Final follow-up corpus output](baselines/2026-10-20-engineers-dream-followup-corpus.log).

Raw samples: [Euler pairs](baselines/2026-10-20-engineers-dream-builtins.jsonl),
[direct membership](baselines/2026-10-20-direct-prime-membership.jsonl).

## Verification with current main

Main advanced to `90dc0798` while this work was in progress, adding #348 dense
sum-of-squares blocks and #350 captured scalar reads/loop jumps. The combined
runtime was built and 662 focused interpreter tests passed, including those
features' tests and the membership regressions. All five Euler 263 demo test
blocks passed again. A fresh full-search sample on the combined runtime took
**8.936 s**, with 0.140 s static analysis and 276.6 MiB execution peak RSS;
the answer was again 2039506520. This integration sample includes the other
main changes and does not isolate the builtin-membership optimization.
[Integration sample](baselines/2026-10-20-engineers-dream-integrated.jsonl).

The default name-facts corpus entry also passed on this combined runtime in
**14.536 s**, with the unchanged 300 s deadline.
[Integration corpus output](baselines/2026-10-20-engineers-dream-integrated-corpus.log).
