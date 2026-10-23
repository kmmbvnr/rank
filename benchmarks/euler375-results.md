# Euler 375: compact reads and mixed scalar registers

The default program uses Period=6,308,948 and Limit=2,000,000,000. Its algorithm
and source are unchanged. The exact answer is 7435327983715286168.

The baseline is main at b697ae45. Three fresh Node v24.15.0 processes per stage
ran sequentially on Apple M5. The harness executes generation, previous-smaller
distances and the final answer as three source segments in one interpreter.
Times include parsing. Diagnostics ran separately. An initial series overlapping
the build was discarded.

| Stage | Generate | Previous | Answer | Total |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 0.634 s | 0.695 s | 14.579 s | 15.934 s |
| Direct compact scalar reader | 0.649 s | 0.693 s | 5.533 s | 6.880 s |
| Reader + mixed scalar registers | 0.656 s | 0.700 s | 2.504 s | 3.948 s |

Each column is its own median, so phase medians need not sum to the total median.
Direct reads improve total time by 2.32x; mixed registers add another 1.74x, for
4.04x overall. The final answer phase improves by 5.82x. These are execution
speed measurements, separate from the existing compact-storage memory benefit.
Peak whole-process RSS in the final three samples was 408–466 MiB, versus
555–559 MiB in the baseline; these figures include temporary numeric buffers and
the runtime, not just retained array storage.

The baseline answer loop overflows its private Number attempt and repeats the
whole loop with BigInt control and indexed access. The first change bypasses
the Int32 items proxy in prepared exact scalar readers, while following storage
widening. The second retries eligible regions with BigInt scalar results and
checked Number control and cell stores. Backward dependency analysis keeps wide
values out of numeric conditions and cell writes, including dependencies across
iterations. Unsupported expressions retain exact replay.

Separate final diagnostics show one mixed attempt in the answer phase, following
one overflowing Number attempt; one region publishes successfully and typed
unpacks remain zero. The unchanged CLI invocation also returned the same answer
in 4.03 s wall time (one smoke run, including process startup).

Verification:

- `npm run build` passed; Vite reported its chunk-size warning.
- Five focused interpreter files passed 421 tests: `integer32-storage`,
  `packed-integers`, `euler375`, `number-loop` and `integer-loop`.
- New checks cover signed wide products/division/remainder, scalar dependency
  chains, bounds errors, loop-carried numeric requirements, COW, error and
  cancellation publication, finally execution and readers after storage changes.
- Small periodic Euler inputs match exhaustive subsequence enumeration under
  default compilation, exact-loop compilation and the reference interpreter.
  Larger packed-array and wide-answer cases are also checked.
- Every full-size timing sample asserts the unchanged answer. Full `npm test`
  and corpus-wide checks were not run.

Reproduce after building:

```sh
node benchmarks/euler375.mjs --samples=3
node benchmarks/euler375.mjs --samples=1 --diagnostics=true
node packages/cli/bin/cli.js demos/euler/375_subseqmin.ra
```

Use `--checkout=/path/to/built/checkout` to measure another revision with the same
harness. Raw stage measurements are in
[`baselines/2026-10-23-euler375.json`](baselines/2026-10-23-euler375.json).
