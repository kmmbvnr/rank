# Dense array write regression

The dense-write comparison reproduced the regression on `d46baaa` against
`e9daeb4`. Three alternating samples on Apple M5 / Node 24.15.0 gave these
median milliseconds before the fix:

| Case | e9daeb4 | d46baaa |
| --- | ---: | ---: |
| Vector write, 1 million | 766 | 1345 |
| Two-axis write, 1 million | 886 | 1410 |
| Compound write, 1 million | 806 | 1339 |
| Dense read, 1 million | 306 | 282 |
| Dice, N = 1 million | 1313 | 1868 |
| Grid Paths, 1000 by 1000 | 2001 | 3147 |
| Book Shop, 100 books / budget 10000 | 1669 | 2184 |
| Edit Distance, two different 1000-character strings | 1816 | 2528 |

The demos are the candidate checkout's sources on both runtimes. Book Shop
uses unit prices and page counts. These are deterministic regression inputs,
not a claim that every CSES maximum input fits the timeout.

## Cause and change

`evaluateAddressItem` used to wrap every selector in a generator, even when
`evaluateTask` had already completed. The hybrid `mapExecution` therefore
entered its suspended branch on every write. This explains a scheduling cost;
these timings alone do not establish a V8 inline-cache or allocation diagnosis.

The fix returns the selector's existing evaluation directly. Signed selectors
use the existing `mapResult` helper. Completed selectors stay synchronous;
Rank calls still suspend and resume through the execution stack. Assignment,
shape checks, evaluation order and atomic slice replacement are unchanged.
No separate scalar-write implementation or global scheduler rollback is added.

## Results after the fix

Five alternating samples against `e9daeb4`, repeated after the initial trial:

| Case | e9daeb4 | Fixed | Fixed / baseline |
| --- | ---: | ---: | ---: |
| Vector write | 752 | 596 | 0.793 |
| Two-axis write | 900 | 602 | 0.670 |
| Compound write | 832 | 653 | 0.786 |
| Dense read | 306 | 290 | 0.945 |
| Dice | 1391 | 1145 | 0.823 |
| Grid Paths | 2092 | 1675 | 0.801 |
| Book Shop | 1694 | 1448 | 0.855 |
| Edit Distance | 1879 | 1784 | 0.949 |

All relative gates passed. Small differences such as the Edit Distance result
are less conclusive than the write improvements. Both sides used independent
dependencies and built outputs. The candidate revision in the report is its
base `d46baaa`; `dirty: true` includes the fix delivered with this document.
[Raw samples and source/input hashes](../../benchmarks/baselines/2026-09-11-dense-writes.json).

Bounded-sum was checked separately against clean `d46baaa`, five alternating
cold CLI runs at N = 200000: median 630 ms before and 624 ms after. No slowdown
was observed. All seven judge-scale cases passed, including the new grid case.
[Control samples](../../benchmarks/baselines/2026-09-11-dense-write-controls.json).

The full JS suite passed (44 parser tests and 480 interpreter tests), as did
all 209 demo test files. The runtime change is confined to one method.

Tests check completed selector evaluations, signed and all-axis selectors,
compound writes, errors before RHS evaluation, and deep recursive selectors
with observable effects. Existing collection and tensor tests cover the shared
assignment implementation.

## Repeatable coverage

```sh
npm run build
node benchmarks/runtime.mjs
node benchmarks/dense-writes.mjs --baseline=/path/to/built/e9daeb4 --samples=5
node benchmarks/judge-scale.mjs
```

Install dependencies independently in each worktree. A shared `node_modules`
can make the CLI load another checkout's interpreter through workspace links.

`runtime.mjs` includes vector writes, two-axis writes, compound writes, and a
dense-read control at one million iterations. `dense-writes.mjs` alternates
candidate and baseline order and records every sample. Its relative gate is
1.25 for each microbenchmark and each of the four DP demos. It checks outputs
against independent JS integer calculations or constructed known answers.
`judge-scale.mjs` also checks an open 1000-by-1000 Grid Paths board at default
size. The default 30-second timeout is a catastrophic-regression check, not
evidence of unchanged speed. Run the relative gate before merging scheduler
or addressing changes, and keep the bounded-sum control in the judge suite.
