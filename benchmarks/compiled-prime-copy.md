# Compiled bounded prime copies

The Number loop backend now lowers finite `primes ... copy` expressions into
fresh private integer arrays. It uses the same normalized bounds and prime
iterator as ordinary execution, preserving inclusive/exclusive clauses and
bound-expression evaluation order. This also permits fresh-array function
regions containing these constructors and vector writes to compile together.

Ordinary `=` still completes its array before the next statement. The new
path rechecks both builtin bindings at entry and preserves aliases between
iterations. Prime values are checked before entering Number storage; wide
cases retain exact behavior through fallback. Demand budgets, inspection and
observable host polling keep their ordinary execution paths. Unused deferred
bindings retain their existing semantics. No Rank syntax or builtin was added.

The control loop constructs small bounded prime arrays 10,000 times and sums
them. Bounds change each iteration. An independent trial-division calculation
checks the result 9080500 outside the timed region. Timings include parsing,
construction and summation; RSS is captured before running the oracle. Three
alternating before/after pairs use fresh Node v24.15.0 processes on each host.
The isolated baseline is `363afd97` (runtime identical to `52683ca7`); after
adds only this constructor support.

| Host | Before, ms | After, ms | Before RSS, MiB | After RSS, MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac / arm64 | 233.29 | 111.56 | 309.58 | 203.67 |
| Intel / x64 | 932.18 | 332.89 | 288.54 | 188.48 |

These are medians of all three samples, not best runs. The 12 raw records,
source hashes, runtime diagnostics and before-run Intel vmstat samples are in
`baselines/2026-11-07-compiled-prime-copy.json`. Before has zero Number loops;
after executes one complete Number region. Reproduce with:

```sh
node benchmarks/compiled-prime-copy.mjs
```

Set `RANK_BENCH_RUNTIME` to a control runtime's `out/index.js` file URL.

Validation: isolated build and 509 focused tests in 13 files on both hosts.
The 18 new cases cover all bound inclusivities, reversed clause order, empty
and changing arrays, aliases, values above Int32, unsafe Number bounds,
shadowed builtins after a prior compiled call, dormant deferred values and
unused branches, wide totals, fresh-array function regions, scoped demands
and observable polling. Exhaustive audits were not run.

During this investigation, 11 older bitwise diagnostics assertions were
reproduced on the clean baseline and repaired separately in `363afd97`.
They expected Int32 fallback although signed 53-bit band/bor/bxor already
matched both reference engines. Mathematical/alias checks remain intact, and
the genuinely unsafe `MAX_SAFE_INTEGER bxor -1` result still requires replay.
The updated 191-test file passes on Mac and Intel without this new feature.

Euler 445's production source and issue row are unchanged. A multiple-based
sieve prototype now compiles its fresh-array fill region and passes the full
golden answer, but its default timing and peak-memory tradeoffs are not yet
acceptable as a replacement. These control-loop gains do not claim to solve
that remaining algorithm choice.
