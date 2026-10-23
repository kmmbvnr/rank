# Exact prime counts and Euler 386 (#387)

Apple M5, Node v24.15.0. Three fresh processes per reported median. Initial
comparison base: `731f2942`. Raw samples are in
`baselines/2026-10-23-prime-count.jsonl`. Timings include Rank parsing and
compilation unless noted. The full suite and whole-corpus audits were not run.

## Interpreter changes, measured separately

1. Reuse trusted scalar storage kinds for loop binding contracts. With the
   original Euler program at 100,000, median execution fell from 1,491.4 ms
   to 903.8 ms (1.65x). Both return 357503. The storage regression also
   reproduces one unpack of 9,592 integer cells on the old interpreter and
   none after the change; it runs with compilation both enabled and disabled.
2. Give finite sources an optional exact-length implementation, and implement
   it for `primesieve` with a lazy block-count index. Three successive prefix
   queries at 99,999,998 through 100,000,000 fell from 2,818.4 ms to 2.800 ms
   (about 1,007x), excluding sieve construction. Both checksums are 17284365.
   The first package of queries, including index construction, fell from
   2,852.3 ms to 27.60 ms. Sieve construction remains about 350 ms in this
   fresh-process harness, including parsing and initial runtime compilation.

At 100,000,000, the bitmap occupies 6,250,000 bytes and the optional index
97,660 bytes. A query reads one count and at most 256 bitmap bytes per
endpoint. The index is shared across bounded views, supports cancellation,
and is published only after a successful build. No array with 100 million
Rank integers is constructed. Ordinary `primes` semantics are unchanged.

## Euler program

The program now stores only primes through the integer square root, with a
small-bound guard for the pattern recursion. Its final-factor counts use
`(Sieve to Top) len` and `(Sieve till Low) len`. This retains the exponent-pattern
algorithm and removes the full prime array and its handwritten binary search.

That representation change alone still exceeded a 30-second full-limit
budget. Bounding recursive prime loops with native sorted searches and
using `isqrt` for quadratic roots reduced the 1,000,000 case from 2,372.1 ms
to 2,131.9 ms; the final version measured 2,084.5 ms. All return 4153927.
A further hybrid search/count branch differed by only about 1% and was dropped.

The full 100,000,000 case returned **528755790** in all three final runs:
32,588.0 / 32,590.3 / 33,035.5 ms, median **32.59 s**. The original program
exceeded the assessment's 20-second budget; no full-limit speedup ratio is
claimed. The existing over-30-second corpus exclusion remains appropriate.

An independent C++ oracle factors every integer up to the full limit and
computes the maximum coefficient of the divisor-rank polynomial. It also
returns 528755790, independently of the prime-count index and pattern counting.
Its runtime is not used as an interpreter speed comparison.

## Reproduction and validation

```sh
npm run build
npm test --workspace @arrrank/interpreter -- test/direct-iteration.test.ts test/loop-bindings.test.ts test/dense-prime-sieve.test.ts test/prime-sequence.test.ts test/prime-loops.test.ts test/collection-capabilities.test.ts
node packages/cli/bin/cli.js test demos/euler/386_antichain_test.ra
node benchmarks/prime-count.mjs --queries=3
node benchmarks/prime-count.mjs --case=euler --limit=1000000
node benchmarks/prime-count.mjs --case=euler --timeout=120000
clang++ -std=c++17 -O3 benchmarks/prime-count-oracle.cpp -o /tmp/rank-387-oracle
/tmp/rank-387-oracle 100000000
```

The interpreter tests pass 63/63. The Rank fixture checks eight limits from
1 through 1,000,000. `npm run build` passes, including web/mobile builds and
Capacitor sync. The first build needed the worktree's mobile dependency link
restored before Capacitor could resolve its already-installed packages.

`--original=yes` selects the saved original Euler source with the current
interpreter. `--root=/path/to/built/baseline` selects a separately built baseline
runtime, so engine and program changes can be measured independently.

## Integration with main

While this worktree was being checked, main advanced to `2672a22a` (#386).
The change was rebased onto it without conflicts. The complete build and the
Rank fixture passed again. The expanded interpreter check passed 210/211:
all 63 prime-counting/iteration checks, all 132 number-loop checks, and 15 of
16 array-length-loop checks. The remaining check,
`replays an overflowing length-bounded region without publishing private writes`,
expects one diagnostic `numberLoops` entry but sees two. It also fails on clean
main without #387; its computed result and execution-state comparisons pass.
This pre-existing diagnostic expectation was left unchanged.

After integration, three fresh count-query samples had a median of 2.737 ms
for the same three queries and checksum. A separate full-limit Euler run took
32,540.0 ms and again returned 528755790. These samples are recorded separately
from the measurements that isolate the individual changes above.
