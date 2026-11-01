# Euler 318 — nines investigation

Investigated on 2026-11-01 at `68546f1b`. The initial research below used isolated compiled-JavaScript experiments
under `/tmp/rank318-runtime`, without modifying production sources. The final
implementation and verification are recorded in the delivery section below.
At selection time, issue #447 listed 318 next after completed 315/316.

## Findings

The current compiled default **fails**, rather than merely running slowly:

```
RangeError: The number 0.41421356237309515 cannot be converted to a BigInt
```

`log` has no scalar inline lowering in `integer-loop-expressions.ts`.
The exact loop compiler accepts it as a branch callout. Before evaluating
that expression, `callout()` spills every assigned Number register using
`BigInt(register)`, including real locals such as `Beta`. Number-loop
compilation cannot accept callouts, so the exact backend is reached.
The existing `small sum` fixture fails for the same reason; reference passes.
The spill code dates to `5ed9e503f`, according to `git blame`.

This is a general correctness defect, independent of logarithms:

```rank
use numbers
for I in 1 to 1
  if I equal 1
    X = 0.5
    Y = (tuple X) len
  end
end
```

Reference returns `1`; compiled execution attempts `BigInt(0.5)` and fails.
A conservative prototype that refuses branch callouts with assigned real
locals avoids the crash, but falls back for the whole 318 loop: a diagnostic
Mac control took 736 ms, with no compiled loop. This is a correctness-only
fallback experiment, not a speed fix or a final proposed design.

A second isolated prototype adds a guarded scalar inline entry for `log`,
using the ordinary positive-finite input domain and `Math.log(Number(x))`.
The unchanged program then compiles as one Number loop, with no overflows,
callouts or compiler rejections. It also runs correctly in exact-loop mode.
This bypasses the defective callout here; it does **not** repair that general
path. Both fixes are needed for delivery.

## Measurements

Five fresh processes per row, rotating order, serial on each host. Node
24.15.0 on Apple M5 and Intel `root@jack.lan`. Imports excluded; parsing,
analysis, compilation and execution included. RSS is process peak, not live
DP storage. Other work on the machines was not suspended. All answers below
are `709313889`. Reference rows use the same isolated runtime, with compilation
explicitly disabled (the inline-log change therefore does not execute).

| Source / engine | Mac median | Intel median | Mac / Intel RSS |
| --- | ---: | ---: | ---: |
| Original, reference | 732.4 ms | 2073.9 ms | 178 / 165 MiB |
| Original + inline log, Number | 34.6 ms | 84.5 ms | 174 / 159 MiB |
| Original + inline log, exact | 64.0 ms | 145.0 ms | 175 / 160 MiB |
| Early break, reference | 120.2 ms | 333.7 ms | 178 / 165 MiB |
| Early break + inline log, Number | 31.3 ms | 77.7 ms | 173 / 158 MiB |
| Integer upper bound, reference | 124.2 ms | 352.3 ms | 179 / 165 MiB |
| Integer upper bound + inline log, Number | 38.3 ms | 92.2 ms | 174 / 159 MiB |
| Rationalized beta + inline log, Number | 39.0 ms | 95.5 ms | 175 / 160 MiB |

Do not describe the 21–25x reference/compiled difference as a before/after
compiled speedup: production compiled execution currently crashes. The
small timing difference between the two fastest sources includes compiler
startup; it is not evidence of a universal backend preference.

## Algorithm

The original enumerates **1,010,025** `(p,q)` candidates for `p+q <= 2011`.
Only **41,987** satisfy `sqrt(q)-sqrt(p) < 1`. For fixed `p`, beta increases
with `q`, so the inner loop can stop at its first failing candidate. The
experiment inserts an early `break` before the existing test/body; delivery
can express the same control flow more compactly with an `else break`.
It preserves the original arithmetic and significantly improves reference
execution, about 6.1x / 6.2x, without building arrays or caches.

An alternative caps `q` at
`min(Top-P, P+1+isqrt(4*P))`, keeping the original beta test. It examines
42,018 pairs, but computing the exact bound and the extra source/compilation
cost make it slower than early break in this benchmark. Parentheses around
the complete `isqrt` application matter in Rank.

Rationalizing beta as `(q-p)/(sqrt(q)+sqrt(p))` avoids cancellation, but
adds work and was slower. The independent high-precision calculation found
no ceiling ambiguity for the default input; do not change this expression
just for presumed numerical accuracy.

## Verification and delivery scope

* A 60-decimal-digit Python Decimal oracle uses the independent integer
  eligibility condition `(q-p-1)^2 < 4*p`, rationalized beta and decimal
  logarithms. It returns `709313889`; the closest required exponent to an
  integer is about `0.0000270898` away. Its eligible count is 41,987.
* Each host passed **936** comparisons: 13 limits, six digit-count targets,
  four source variants, three execution engines. The small-input oracle
  uses integer eligibility and rationalized logarithms. Limits include empty
  ranges, squares and triangular boundaries; digit counts include zero.
* Both existing fixture test cases pass compiled/reference in the inline-log
  prototype on both hosts. Baseline compiled fixture has one failure.
* TypeScript build was already current and passed. No ordinary full suite or
  exhaustive audit was run for this research-only JS-output prototype.

Recommended implementation: repair callout spilling by actual scalar kind
and review result typing/conversion; add guarded scalar `log` lowering; add
real-local/branch-callout regressions and domain/rebinding tests; use early
termination in the demo. Keep callbacks, binding identity, errors and exact
fallback observable. Recheck the default execution-budget exclusion after
implementation. Do not mark 318 done until those repairs and focused suites
pass. The initial research did not update the issue, commit or push. See final delivery below.

## Reproduction and artifacts

The historical prototype commands require a built checkout at `68546f1b`;
pass that checkout to `euler318-prototype.py --root` when running elsewhere.
After the final implementation, run the delivery series directly without
building a historical prototype.

```sh
node node_modules/typescript/bin/tsc -b tsconfig.build.json
python3 benchmarks/experiments/euler318-prototype.py /tmp/new-rank318
RANK_ROOT=/tmp/new-rank318 node benchmarks/euler318-investigation.mjs compiled 2011 original
RANK_ROOT=/tmp/new-rank318 node benchmarks/experiments/euler318-series.mjs
RANK_ROOT=/tmp/new-rank318 node benchmarks/experiments/euler318-verify.mjs
RANK_ROOT=/tmp/new-rank318 node benchmarks/experiments/euler318-fixture.mjs
python3 benchmarks/experiments/euler318-oracle.py
```

`--kind safe-fallback` builds the conservative correctness control instead.
The prototype script requires a new directory and only edits its copy of
built JS. Raw measurements, decimal oracle and verification records are in
`benchmarks/baselines/2026-11-01-euler318-{mac,intel,oracle,verification}.json`.


## Final implementation and delivery

The compiler now publishes exact-loop registers directly at branch callouts:
integers are already BigInts and real values must remain Numbers. It also
preserves a known scalar callout result without truncating a Number. Unknown
scalar result kinds decline compilation, and catalogue names used to infer
the result receive builtin identity/implementation entry guards. Number loops
still prohibit interpreter callouts; private speculative work is not exposed.

Scalar `log` now lowers directly for integer/real inputs in both exact and
Number loops, retaining the positive-finite domain and builtin guard. The demo
adds only `else / break` when beta first fails: no cache or array materialization
is introduced, and the original beta/rate arithmetic and parameters stay intact.

Five fresh-process medians on the final built interpreter, with original source
frozen in `experiments/euler318-original.ra`:

| Source / engine | Mac | Intel | Mac / Intel RSS |
| --- | ---: | ---: | ---: |
| Original, reference | 750.5 ms | 2013.4 ms | 176.0 / 164.1 MiB |
| Production, reference | **113.9 ms** | **316.7 ms** | 176.4 / 164.5 MiB |
| Original, compiled after compiler repair | 34.2 ms | 84.8 ms | 171.9 / 158.7 MiB |
| Production, compiled | **30.1 ms** | **75.9 ms** | 156.9 / 158.0 MiB |
| Production, exact backend | 33.1 ms | 84.4 ms | 165.5 / 157.8 MiB |

The algorithm change alone improves reference execution 6.6x / 6.4x. The old
compiled runtime crashes, so there is no valid original compiled timing to use
as a speedup denominator. Process peak RSS is broadly unchanged in reference
mode; compiled memory observations vary by source/backend and startup cost.

Final verification:

* **851 unique focused tests on Mac**, 15 files: the original 850-test run plus
  the final 20-case regression file, which adds one test to its initial 19.
* **387 unique focused tests on Intel**, integer-loop, real-loop and the new
  regression file (386 initially plus the additional rebinding regression).
* Real callouts cover finite/fractional values, negative zero, infinity,
  integer/boolean/array locals, a real `mean` result, skipped branches,
  preceding writes, ordinary callout errors and rebound catalogue functions.
* Direct `log` tests cover integer/real inputs, both backends, zero, negative
  zero, negative values, NaN, infinity, huge integers, inactive branches and
  native rebinding.
* Each host passed **1170** independent small-input comparisons (the four
  research variants plus the actual production source, all three engines),
  and both existing fixture cases pass compiled/reference. The independent
  60-digit default oracle remains `709313889`.
* TypeScript build, semantic boundaries (65 owners), and application-form checks
  pass. Exactly four scoped type/differential audit cases for the 318 main and
  fixture pass. No full suite or exhaustive audit was started.

The full demo is removed from `demo-execution-exclusions.json`: both main and
fixture now participate in ordinary corpus audits, with no deadline changes.
Delivery measurements and verification logs are preserved in
`baselines/2026-11-01-euler318-delivery-{mac,intel,verification}.json`.
Use `RANK318_DELIVERY=1` with the series runner to repeat the final comparison.
