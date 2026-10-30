# Euler 263 investigation

Investigated 2026-10-30 on macOS arm64 / Node v24.15.0, starting at `7e38ad6a`.
Other sessions advanced main with unrelated demo changes during the investigation;
no interpreter/language source commits intervened. The initial experiments below
are preserved separately from the final compiler implementation at the end.
The shipping demo is unchanged.

Euler 263 is the lowest-numbered unfinished problem in the current issue inventory.
Earlier 023/030/044/054 entries occur in completed-work comparison tables and are
already done. Its historical 30.6 s reference / 34.4 s compiled observation is
not a current isolated baseline. The existing wheel and prime-membership work is
documented separately in `engineers-dream-results.md`.

## Current measurements

Full defaults: Count=4, Start=210, Limit=100000000000. Every completed full run
returns Found=4 and Answer=2039506520.

| Source | Mode | Median | Range |
| --- | --- | ---: | ---: |
| Original | compiled | 6.431 s | 6.307–6.483 s |
| Original | reference | 6.605 s | 6.599–6.701 s |
| Scalar practical / range prototype | compiled | 2.502 s | 2.471–2.509 s |
| Scalar practical / range prototype | reference | 7.024 s | 7.015–7.027 s |
| Prototype with practical checks before primes | compiled | 4.539 s | 4.513–4.617 s |

Three fresh sequential processes per case. Original compiled/reference runs
alternate; the two compiled prototype variants alternate in a later series;
prototype reference runs form a separate series. These are not interleaved
before/after medians. Timing includes parsing and execution, excludes module
imports, and enables diagnostics. No own tests/builds overlap these timed samples;
external host activity is uncontrolled. The local compiled ratio is 2.57x;
prototype reference is 6.4% slower. This does not establish a portable threshold
or a memory improvement. CPU-profile runs are separate diagnostic observations.
Raw samples and counters: `baselines/2026-10-30-euler263-investigation.json`.

## Cause

The algorithm already reduces the search to residues 20 and 820 modulo 840.
Up to the fourth result, N=1146521020, that is about 2.73 million candidate
numbers. The prime-offset tests short-circuit; practical-number checks are rare.
There is no dense array proportional to the default Limit.

Current main does not compile the outer search successfully. Function proof
rejects `N factors unique` in `practical`, and the inline array in the loop of
`practical_neighbours`. The latter function needs both an iterable proof and
support for calling its helper. The whole-program original profile attributes
26.0% of self samples to PrimeSieve.prepare; expression/loop/binding dispatch
and repeatedly resolving compiler capabilities also contribute. Enabling
compilation alone consequently has little effect on the original.

A temporary diagnostic build also explains the misleading outer
`loop:unstable-bindings` rejection: after the unsupported boolean helper call,
speculative array-selection lowering registers the scalar induction variable
N as a boolean array. The later stability check sees that N is assigned in the
loop and rejects. This is diagnostic/state pollution during an unsuccessful
lowering attempt, not evidence that this program mutates an array named N.
Removing that rejection alone does not provide a valid helper compilation.

## Experiments

The retained prototype implements the same practical-number criterion by
removing prime powers in a scalar loop, tracking their divisor-sum product, and
rejecting once the next possible factor exceeds Sigma+1. If P*P > Left, the
remaining tail is prime. Only positive inputs were validated; the original
factors operation's errors for nonpositive values must be retained if this is
shipped as a replacement helper.

The neighbour helper uses `for D in -8 to 8 by 4` instead of an inline array.
This removes both helper-proof barriers, allowing the search to use compiled
execution. The main search uses exact arithmetic; the diagnostics' Number-loop
entries also include small setup loops and do not mean the whole search is a
Number kernel. No Number overflow is recorded.

Single exploratory controls distinguish the barriers:

- Scalar factor removal alone, retaining the literal-array neighbour loop:
  6.161 s; the neighbour helper still rejects.
- Range alone, retaining `factors unique`: 6.660 s; the practical helper still
  rejects.
- Scalar factor removal plus five unrolled neighbour calls: 2.485 s.
- Scalar factor removal plus the compact range: 2.485 s on the first observation;
  repeated median 2.502 s. Prefer the range over unrolling.
- Hoisting the offsets to a captured array still fails the scalar proof and
  takes 6.132 s in one observation.
- Moving practical checks before primality is slower. Retain the prime-first
  order; do not infer relative filter costs from the reference engine.

In the faster prototype profile, PrimeSieve.prepare rises to 54.7% of self
samples. Another 9.7% is declareIterationTypes on array iterators reached from
the compiled exact loop. These percentages describe self samples, not exclusive
end-to-end phase timings. Remaining candidates include reducing iteration
binding overhead in compiled loops and, separately, a candidate-specific sieve.
The latter is an algorithm redesign, not a demonstrated runtime fix.

## Initial recommendation

Prioritize general compiler support for finite integer iterator stages
(`factors` followed by `unique`) consumed by a function's loop, and inline
integer-array iteration. Reuse their ordinary iterators/native identities and
preserve early termination, captures, domain errors, rebinding and demand timing.
This would retain the existing compact demo and its native factorization in
reference mode. At that point the compiler-only speedup had not been implemented or measured;
the final implementation and measurements are below.

A smaller alternative is the retained scalar/range demo, with the 6.4% reference
regression explicitly acknowledged. Changing only the range does not solve it.
Diagnostic rollback after a failed speculative application lowering is a
separate compiler repair; deleting the stability guard is not a valid fix.
No admission threshold, audit exclusion, deadline or full-size assertion was
changed. No broad suite or exhaustive corpus audit was run for this investigation.

## Verification and reproduction

Both original and prototype pass all five existing fixture blocks in both
engines. Independently, for every N=1..2048, a JavaScript subset-sum bitset over
all divisors checks whether every integer 1..N is representable. Both sources
match that oracle in both engines: 8192 checks. Four large positive integer
checks, including powers beyond Number's safe range, also pass for each source
and engine (16 checks). Full default results pass in every timed run.
The language/interpreter TypeScript build and both harness syntax checks pass.

After building:

```sh
node benchmarks/euler263-investigation.mjs compiled original
node benchmarks/euler263-investigation.mjs reference original
node benchmarks/euler263-investigation.mjs compiled prototype
node benchmarks/euler263-investigation.mjs reference prototype
node benchmarks/euler263-verify.mjs original
node benchmarks/euler263-verify.mjs prototype
```

Each invocation is one fresh sample. Both harnesses accept RUNTIME=/path/to/out/index.js.
The original and prototype sources are retained under `benchmarks/experiments`.
The filter-order variant can be reconstructed by moving the practical_neighbours
condition before the prime tests, removing it from the final `if Ok and ...`.


## Final implementation and delivery verification

The compiler now proves finite `factors`/`divisors` iterator stages, optionally
followed by `unique`, when consumed directly by a function loop. Each stage
calls the original native implementation and the loop consumes its ordinary
iterator. Native bindings, modules and implementation identity are checked at
entry; arbitrary host polling retains ordinary execution. This preserves the
interpreter-owned factorizer, fresh observers, early termination and errors.
The proof also admits scalar literal-array iteration and signed numeric vector
items. Element domains and exact ordinals are retained through `unique`.
Unsupported or escaping sequence values keep ordinary execution.

The original Euler source, algorithm, bounds, wheel, prime-first filter order,
fixtures and golden answer are unchanged. The scalar-factorization prototype is
not shipped. No Number admission threshold or prime-membership policy changed.

Final comparison on the same frozen source, with baseline runtime saved before
this compiler change and candidate built on `6c990f9b` (intervening commits only
change unrelated demos/docs):

| Runtime | Compiled median (range) | Reference median (range) |
| --- | ---: | ---: |
| Baseline | 7.310 s (7.270–7.634) | 7.613 s (7.045–7.808) |
| Updated | 2.912 s (2.648–2.990) | 7.606 s (7.219–7.757) |

Three fresh sequential processes per case; rotate all four runtime/mode cases
between rounds. Imports are excluded; parsing, execution and diagnostics are
included. No own tests/builds overlap these samples, but external host activity
is uncontrolled. Compiled speedup is **2.51x**; reference ranges overlap and no
reference speedup is claimed. The earlier 6.431/2.502-second investigation is a
separate source-prototype series, not part of this runtime comparison. No
peak-memory improvement is claimed.

Final checks:

- Language/interpreter build and interpreter-test TypeScript check pass.
- Seven focused files / **441 tests** pass, including the unchanged full Euler
  263 answer, iterator domains, native identity/binding changes, signed vectors,
  early returns, duplicate factors, ordinals, scope errors and unopened modules.
- Two scoped type/differential files / **four checks** pass for the unchanged
  main and fixture, including all five fixture blocks in both engines.
- The original helper matches the independent subset-sum oracle at N=1..2048
  in both engines (**4096 checks**) and eight additional large-integer checks.
- Semantic script tests: **11 pass**, **65 owners** checked.
- The ordinary interpreter run passed **9487 tests** and initially reported
  two failures. The signed-vector rejection expectation was updated because
  that construct now compiles; its final focused rerun passes. The other is an
  existing `strided-scalar-writes` linear demand-budget test: it expects cell
  1023 to have been written before exhaustion, but the unchanged baseline also
  leaves it zero. This unrelated failure is not fixed or hidden here. Therefore
  the ordinary suite is not claimed fully green. Full exhaustive audits were
  not run.

The final raw samples and verification counts are under `delivery` in the JSON.
Use RUNTIME=/path/to/frozen/out/index.js with the original variant to reproduce
old/new comparisons. The unrelated demand-budget failure can be reproduced on
the baseline by calling writeIntegerSelection on an 8192-cell zero-filled array
under withDemandBudget(1024), with `{offset: 0, stride: 1}` and replacement 7.
