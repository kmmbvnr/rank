# Euler 370: geometric triangles and compiled-loop polling

Results for [#447](https://github.com/kmmbvnr/rank/issues/447). The Rank algorithm
is retained. The compiler now selects a cooperative-polling policy for each
numeric region invocation, without consulting ambient execution state at every
nested-loop iteration.

## Results

Three fresh processes per variant and input, serial on each host, alternating
baseline/production order. Node v24.15.0 on both hosts. Time includes Rank parsing,
compilation, allocation and execution; Node startup/imports are outside the timer.
Peak RSS is process-wide. Each full sample asserts **41791929448408**.

| Host / full Euler 370 | Baseline | Delivered | Peak RSS before / after |
| --- | ---: | ---: | ---: |
| Apple M5, ordinary | 8.629 s | **5.691 s** | 210.3 / 209.6 MiB |
| Apple M5, Atomics cancellation | 10.268 s | **7.371 s** | 210.1 / 212.1 MiB |
| Intel i7-10750H, ordinary | 24.606 s | **16.705 s** | 204.8 / 202.1 MiB |
| Intel i7-10750H, Atomics cancellation | 28.068 s | **19.754 s** | 206.7 / 209.0 MiB |

This is about 28–34% less time, depending on host and polling scope. The extra
compiled polling form adds about 2 MiB to measured peak RSS in the atomic cases;
there is no larger working table or per-iteration object allocation. Ordinary
execution uses slightly less peak memory. These are measurements, not a claim
that the compiler saves memory in every program.

Neighbour controls, compiled default inputs (milliseconds):

| Program | Mac baseline / delivered | Intel baseline / delivered |
| --- | ---: | ---: |
| Euler 023 | 117.9 / 117.8 | 317.3 / 292.9 |
| Euler 365 | 471.3 / 421.9 | 1543.9 / 1442.1 |
| Euler 369 | 173.0 / 174.4 | 480.0 / 448.7 |
| Million nested additions, including cold setup | 84.4 / 86.4 | 214.7 / 204.9 |

No material regression or large RSS increase was observed in these controls.
The small Mac differences on startup-dominated cases are not evidence of a
steady-state speedup or slowdown.

Raw samples:

- `baselines/2026-11-03-euler370-delivery-mac.json`
- `baselines/2026-11-03-euler370-delivery-intel.json`
- `baselines/2026-11-03-euler370-investigation.json` (preliminary research)

The baseline hook disables only the new policy selector, keeping checked loop
polling. Both variants otherwise use the same built runtime. The shared working
copy contained unrelated work; this is not a clean-git before/after comparison.
The intended commit was separately built and tested in an isolated snapshot
without those unrelated changes. Intel runs used a separate temporary directory
on `root@jack.lan` and Node `/opt/rank-bench-node/bin/node`, not its system Node 20.
No Android/WebView performance claim is made.

## What was slow

The issue's “over 30 seconds compiled” note was already stale on the current Mac.
A diagnostic full run before this change took 8.639 seconds and showed three
compiled loops, all Number, with no overflow replay, mixed BigInt loops or
compiler rejections. The sieve and both search branches were already compiled.

[The problem statement](https://projecteuler.net/problem=370) asks for geometric
integer-sided triangles under a perimeter bound. The source represents them as
multiples of `(P*P, P*Q, Q*Q)`, with coprime P,Q and the triangle inequality. Small
rows enumerate Q; large rows group equal perimeter quotients and use signed
square-free divisors to count coprime prefixes.

A handwritten JavaScript translation of the same algorithm records:

- 264,226,264 candidate Q values;
- 496,822,548 prime-divisibility tests;
- 122,836,527 quotient blocks;
- 1,014,000,128 signed-divisor prefix terms.

It takes a median 3.808 seconds / 64.4 MiB on the Mac. That excludes Rank parsing,
checked intermediates, binding/error contracts, cancellation and publication;
it is an algorithm control, not an interchangeable implementation.

Generated Number loops previously called `checkpoint()` at each nested iteration,
even without a cancellation signal or demand budget. The profile assigned about
1.36 seconds of self time to checkpoints. Removing those calls also improves
V8's treatment of the surrounding generated loop, so the complete gain cannot
be attributed only to that self-time figure.

## Delivered compiler change

The normal lowering pipeline emits one of three loop-header checkpoint forms:

- `checked`: existing checkpoints, including exact demand-budget charging;
- `none`: omit loop-header checkpoints when neither signal nor budget is active;
- `batched`: count local work and poll every existing 1024-unit interval for
  opaque cancellation, flushing unfinished work before successful publication.

Alternative plans are lowered/compiled lazily and cached as code, never invocation
values. Selection happens at region entry, not at each iteration. The editor's
transition to turbo remains one-way. Re-selecting policy at a later invocation
also keeps internal budgeted/lazy computations correct; it does not introduce an
editor transition back from turbo.

Inspection and custom host polling retain their original admission/publication
paths. Budgets, counted copy-cost probes, and cancellation-enabled regions with
compiled calls/callouts retain checked polling. Arithmetic/storage/native helper
checkpoints remain. Overflow still discards private mutations and replays exactly;
ordinary errors/cancellation still publish completed stores and scalar bindings.

Batching can shift the first signal poll relative to the ambient counter. Polls
remain at most 1024 generated header checkpoints apart inside a region; a phase
change across region boundaries can defer a signal poll by fewer than another
1024 work units. Cancellation progress is not promised at an identical iteration.
Demand budgets preserve the exact existing path. Short regions flush their work
so repeated small calls cannot starve cancellation.

No production code rewrites generated JavaScript strings. The benchmark-only
baseline hook is an asserted textual switch of the selector for comparison.

## Algorithm controls

Single full-input research runs, all producing the full answer:

| Change | Time |
| --- | ---: |
| Half the cube-root pivot | 12.091 s |
| Original pivot | 8.629 s |
| Double the pivot | 12.912 s |
| Skip even Q when P is even | 8.642 s |

These changes did not justify complicating the Rank program. This is not an
exhaustive proof that no better mathematical algorithm exists.

At Limit=100,000,000 the preliminary production medians were 0.166 seconds
compiled / 0.645 seconds reference, with 182.9 / 332.4 MiB peak RSS. Full reference
was not run. Its corpus-budget exclusion remains; the small fixture stays in the
audits and a dedicated compiled test now checks the full answer. No timeout or
lane was relaxed to obtain a passing result.

## Verification

- TypeScript build passes in the working copy and the isolated intended snapshot.
- 458 focused interpreter tests pass in both copies: numeric loops, arrays,
  slices, read buffers, indexes, modular products, scalar kernels and Euler 370.
- Twelve dedicated polling tests cover warmed invocation scopes, budget bounds,
  short-region cancellation, committed writes/finally, COW snapshots, overflow,
  error precedence, custom polling and inspection.
- A direct pair-enumeration oracle checks 106 limits in both execution engines;
  together with scope/error checks, the manual verifier passes 221 assertions
  under both baseline and production controls on both architectures.
- Dedicated full compiled golden: 41791929448408.
- Semantic boundary checks pass (65 owners). The isolated scoped differential
  compares the Euler 370 fixture in both engines: one selected case, five fixture
  assertions, 55 compiled entries and 15 Number-loop entries.
- Final isolated Intel tests pass all 16 cases, including the full compiled golden
  and all twelve polling-policy cases.
- No full `npm test` or exhaustive corpus audit was started.

Reproduction after the TypeScript build:

```sh
node benchmarks/euler370-investigation.mjs compiled 25000000000000
CONTROL=baseline node benchmarks/euler370-investigation.mjs compiled 25000000000000
POLL=1 node benchmarks/euler370-investigation.mjs compiled 25000000000000
node benchmarks/experiments/euler370-verify.mjs
CONTROL=baseline node benchmarks/experiments/euler370-verify.mjs
node benchmarks/euler370-delivery.mjs
node benchmarks/experiments/euler370-native.mjs
```
