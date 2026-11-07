# Euler 454: Diophantine reciprocals

The full L = 1000000000000 answer remains **5435004633092**. The original
algorithm is already a Mobius inversion with a cube-root split, rather than
a brute-force search. The issue's historical 40-second estimate is not the
baseline for the speedup claims here. Fresh measurements compare the actual
old source/runtime with the final source/runtime on the same host.

The Rank program now uses at most one loop in each helper and no main loop.
Equal floor quotients are assembled as arrays and mapped through pair_count.
Complete-row counts use a cube-root-sized table instead of a square-root-sized
one. General compiler and native integer-expression changes lower time and
peak memory without crossing ordinary assignment boundaries.

## Counting

Write x = t*u*(u+v), y = t*v*(u+v), with u < v and gcd(u,v) = 1.
Putting a = v and b = u+v gives a < b < 2a:

```
G(N) = sum(floor(N/(a*b)), a < b < 2a)
Answer(L) = sum(mu(d) * G(floor(L/d^2)), d <= isqrt(L/6))
```

The prefix sums of mu combine equal floor quotients. The large quotients for
d <= floor(cuberoot(L)) and the remaining small quotient values form disjoint
lists. Unattained small quotients have zero Mobius weight and are removed.
Each retained quotient calls pair_count through rank 0.

In G, rows a <= C are counted by their difference b-a. The remaining rows
are counted by multiplier t. Small-row and partial-multiplier traversals share
one flat loop. An integer square root gives the exact first partial row,
removing a correction loop. The approximate cube root only chooses a split:
both sides are counted exactly, so no exact cube-root correction is needed.

For complete rows, swap summation order. For each multiplier, let

```
Q = floor(N/t)
End = floor((1 + isqrt(8*Q+1))/4)
```

Rows C+1 through End contribute
(End*(End-1) - C*(C-1))/2. This replaces the old square-root-sized row table
with a cube-root-sized multiplier table. The products are even, so dividing
their exact sum by two is equivalent to dividing each term before summation.
Temporary row arrays stay local to their branch; no dummy root binding or
extra unconditional scalar assignments are needed.

## General runtime changes

The initial compiler fixes were delivered in 7c2af13e:

- Pure numeric vector-reduction functions may execute a private Number
  prefix without requiring an array mutation as evidence of useful work.
- For a plain numeric local return initialized at the function root,
  inaccessible local arrays need no success publication. Errors and
  cancellation retain ordinary publication; reference/array returns retain
  full publication. Warmed demand-budget entry is checked again.
- The vector unary path shares the pure builtin table used for scalar
  Number loops: isqrt, sqrt, abs, floor, ceil, log and acos. Binding identity,
  shapes, integer exactness, domain errors and wide fallback remain guarded.

6874cf94 adds direct compact scalar floor quotients below the proved 2^52
numerator boundary. 5907380e retains already computed numeric buffers,
starts scratch at the first result's width, and preserves the computed
prefix on later widening. Scalar-sized boxed results keep their cheaper
boxed representation. Int32 readers and public items getters share methods.
The literal packing threshold and numeric admission limits are unchanged.
See [short-integer-results.md](short-integer-results.md) for isolated controls.

The final native integer sum path interprets an arithmetic instruction list
in one pass over completed owned integer inputs. It generates no JavaScript,
so it also benefits compilation=false. Only inline +, -, *, and // stages are
joined; named arrays remain materialization boundaries. Source names are
looked up afresh on each execution. Equal-shaped tensors and scalar operands
are supported. Each intermediate must remain a safe integer; division uses
the proved numerator bound. Larger values replay through ordinary exact
arithmetic. The total itself can exceed Number: safe integer chunks are
accumulated exactly into BigInt without rounding.

This path declines deferred/foreign readers, real/missing/mixed cells,
broadcast shape mismatches, externally shared numeric buffers, arbitrary
host polling, inspection and demand budgets. Scalar-only subexpressions are
checked even for empty arrays. Sum identity and its native implementation
are rechecked on warmed expressions; a replaced call getter is not read
before evaluating an erroneous argument.

91572cef separately fixes a pre-existing packed-sum error: arbitrary host
polling could replace public items while sum retained an old buffer. Such
observable scopes now checkpoint before reading the current cell. Ordinary
and Atomics-only scopes retain buffer reductions.

## Verification

- Independent direct equation counts for 30 small bounds on Number, exact
  compiled and reference backends, including empty/cube/square boundaries.
- Independent inner G divisor-pair counts at 25 bounds on all three backends.
- Both imported fixture tests, repeated L=15/1000 and L=10^8 runs, and the
  full golden in compiled and reference benchmark processes on both hosts.
- Native-expression tests cover multidimensional signed floor quotients,
  adjacent quotient boundaries, later unsafe intermediates, totals beyond
  Number, empty scalar errors, ordinary snapshots, warmed reducer replacement,
  foreign getters, shared buffers, demand, opaque polling and cancellation.
- Source/test TypeScript builds on Mac and execution-exclusion checks pass.
  Exhaustive audits were not run. The final focused suite has 1338 tests in
  56 files per host, including integration with the concurrent Euler 752 work.
  The last warmed-input case was also run separately. Intel initially lacked
  the newly integrated 752 benchmark fixture; after synchronizing it, both
  that file's 20 cases and all 22 native-sum cases passed.

A stale slice diagnostic assertion was corrected in 7c2af13e: Euler 452's
explicit return already made that preceding loop result discardable on the
unchanged base. Semantic comparisons in that test remain intact.

## Measurements

The base is 9cd44100 with its old
Euler 454 source; the candidate is dd97758b with the preceding runtime fixes.
Both use Node v24.15.0, fresh processes and identical options. The timer covers
parsing and execution; imports/runtime construction happen before it. Peak
RSS is for the process lifetime. Diagnostics are enabled equally on both sides.

Before/after order alternates across three pairs per host and mode. A process
monitor checks for foreign Node tests/benchmarks before each run and every
second during it. Contaminated samples are rejected. Intel also requires at
least 98% idle and zero swapping before each run. No foreign job is stopped.

| Host / mode | Before ms | After ms | Before RSS MiB | After RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac / compiled | 2301.88 | 2143.23 | 323.62 | 217.77 |
| Mac / reference | 17107.69 | 10332.60 | 1180.06 | 891.30 |
| Intel / compiled | 6290.27 | 5806.72 | 314.91 | 238.39 |
| Intel / reference | 64374.33 | 32663.24 | 555.14 | 535.96 |

Raw samples: [2026-11-07-euler454.json](baselines/2026-11-07-euler454.json).
All samples in this fixed final series are retained. Intel reference candidate
RSS is 535.38, 535.96 and 793.73 MiB: its median improves modestly, but its
highest sample exceeds the baseline range 542.28-574.79 MiB. Do not interpret
the median as a guaranteed memory cap. Mac reference candidate RSS is
882.92-892.59 MiB, versus 1178.14-1448.67 MiB before.

A separate single Mac control with diagnostics disabled was 17019.49 ->
10442.74 ms and 1180.97 -> 881.98 MiB. It confirms that the reference speedup
is present without instrumentation; these samples are not pooled with the
three-pair medians. Set RANK454_DIAGNOSTICS=false to reproduce that mode.

Earlier rejected source/storage variants are
investigation evidence and are not mixed into final medians. In particular,
a deferred Terms expression cut temporary publications but made reference
about five times slower at L=10^10. The final source uses ordinary bindings;
no deferred-binding check was deleted or unused plan computed eagerly.

## Reproduction

After building:

```sh
node benchmarks/euler454.mjs compiled
node benchmarks/euler454.mjs reference
```

For the old source:

```sh
git show 9cd44100:demos/euler/454_diophantinereciprocals.ra \
  > /tmp/euler454-before.ra
RANK454_RUNTIME=/path/to/old/packages/interpreter/out/index.js \
  node benchmarks/euler454.mjs reference 1000000000000 \
  /tmp/euler454-before.ra
```

The full default is returned to the ordinary execution audit; its small
fixture remains covered. Issue 447 is updated after push verification with the per-task result link.
