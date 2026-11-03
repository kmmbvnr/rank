# Euler 354: stored array arguments in loop calls

The default answer remains **58065134**. The Rank program and its
number-theoretic algorithm are unchanged. The repair lets the enclosing
search compile when a helper takes a completed array whose semantic type
is unresolved.

## Cause and repair

The solution enumerates prime-exponent patterns 24,2; 14,4; and 4,4,2. A
prefix table counts the remaining factors, and quotient blocks avoid
visiting individual distances. Algorithm replacement is unnecessary here.

At the default limit, `Good` has 1,834,734 entries. After its scan, its
semantic type is unresolved, although trusted storage proves all cells
are integers. Small fixtures have a concrete semantic type, hiding the
full-input compiler gap.

Loop call lowering previously required a semantic array proof. It now
uses the same checked stored-domain proof as scalar entry specialization,
through `compiledStoredArgumentType`. This is an execution proof and does
not change array declarations or semantic return-contract keys. Existing
runtime array guards, native identity checks and exact arithmetic remain
in force. Missing, mixed, host and lazy storage retain ordinary execution.

A failed call also no longer treats a known scalar head as an array
selection. Previously this could register scalar `T` as an array and
misreport the rejection as `loop:unstable-bindings`.

The unchanged full search now has four compiled loop regions instead of
one. Its 208,968 helper calls retain their compiled execution. `N` and the
large powers remain exact integers; forcing them into Number mode would
be incorrect.

## Controlled final measurements

Node 24.15.0, three fresh serial processes per version and host, alternating
order. Parsing and compilation are included; imports are excluded.
Background load is uncontrolled. RSS is the peak for the whole process.
The control restores the old array-call admission and removes the new
scalar-head guard in an otherwise identical isolated final build.

| Host, compiled default | Before | After | Speedup | Median peak RSS |
| --- | ---: | ---: | ---: | ---: |
| Mac arm64 | 5.379 s | 1.079 s | 4.99x | 593.5 → 443.0 MiB |
| Intel x64 | 18.526 s | 2.593 s | 7.14x | 577.3 → 435.9 MiB |

Every sample returns 58065134. Raw final timings, control description,
source hash and diagnostics are in
`baselines/2026-11-03-euler354-final.json`.

The original research reference median on Mac was 6.680 s. No reference
speedup is claimed: this change concerns compilation. Both final engines
were checked against the full answer on both hosts. An earlier phase run
attributed 0.487 s to sieve/prefix preparation, 0.008 s to the first two
exponent patterns and 4.822 s to the final search.

The initial research snapshot retained unrelated pending runtime edits;
its raw data are separate in
`baselines/2026-11-03-euler354-investigation.json`. Final measurements use
an isolated checkout based on 6763c766 with only this repair.

## Rejected source alternatives

Capturing `Good` inside unary `g` and manually inlining its loop also
produce the full answer. The frozen experiments are
`experiments/euler354-capture.ra` and `experiments/euler354-inline.ra`.
Capture takes 1.109 s compiled in the initial Mac series, but gives little
reference improvement and inconsistent peak memory. The compiler repair
retains the explicit array parameter and avoids either source rewrite.

## Verification

- 439 targeted interpreter tests pass, including 12 new regressions for
  unresolved boxed/Int32/Int64 arrays, scan output, caller writes and
  aliases, bounds and partial results, missing/mixed domains, host/lazy
  readers, native replacement, host mutation between cached executions,
  semantic type preservation and ordered effects of an unsupported call.
- The 12 new regressions also pass on Intel.
- The existing fixture passes in both engines. Limits 0, 1, 100000,
  1000000, 10000000 and 500000000000 match their golden answers in both
  engines on Mac and Intel: 14 checks per host including the fixture.
- TypeScript build, test typecheck, application-form and semantic-boundary
  checks pass. No exhaustive corpus audit was run.
- Demo sources, golden assertions, execution exclusions and budgets are
  unchanged.

Reproduce after building:

```sh
node benchmarks/euler354-investigation.mjs 500000000000 compiled
node benchmarks/euler354-investigation.mjs 500000000000 reference
node benchmarks/euler354-verify.mjs
```

`RUNTIME=file:///absolute/path/to/interpreter/out/index.js` selects an
isolated runtime. `DIAG=1`, `PROFILE=/tmp/profile.cpuprofile`,
`KERNELS=/tmp/kernels.js` and `PHASES=1` enable separate diagnostic runs.
