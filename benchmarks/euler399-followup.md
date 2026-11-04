# Euler 399: named finite stages

Investigation and implementation based on `4bc92508`, 2026-11-04.
The next unfinished numbered workload in issue #447 is Euler 399.

The current solver computes 394,525 prime ranks using 1,604,053 modular
Fibonacci queries, retains 2,059 forbidden moduli and selects index 130,775,524.
The full answer is `1508395636674243,6.5e27330467`.

## Findings

On the current runtime, the original full program takes about 7.5 seconds on
Apple M5, substantially less than the historical October report. A separate
split-phase run measured 7.120 s preparing moduli and 0.179 s selecting and
formatting the index. Its independent SPF/Number oracle verified the complete
ordered modulus list. Selection is no longer the main bottleneck.

The original outer loop executes each prime's rank search through interpreter
boundaries. Replacing `Fs'` with `Fs` permits the factor loop to compile, but
that should not be necessary just to feed a finite iterator to a consumer.
Moving the rank calculation into a normal `rankmod` function lets the compiler
combine the nested search and calls. Before this change, retaining the named
recipe inside its branch still prevents whole-function compilation.

The compiler now represents fresh function-local `factors` / `divisors` recipes
and their `unique` stages separately, resolving their names at loop consumers.
Bindings inside branches and loops retain lexical scope. No sequence or array
is evaluated at binding time. Every traversal recreates its native iterator.
The scalar argument uses existing function-plan lowering and preserves the
reference expression's error location, including enclosing parentheses.

This is bounded support for finite native iterator recipes, not removal of all
lazy-binding restrictions. Rebindings, escaping stages, unsupported consumers,
mutable captured inputs and array/container writes retain ordinary execution.
Builtin identity, module, inspection, polling and compiler capability guards
remain active. Ordinary `=` completion boundaries are unchanged.

The demo moves the existing search into `rankmod`, keeping `Fs'`, `binary`, its
mathematics, prime bound and segmented selection. No algorithm replacement.

## Measurements

Node v24.15.0. Apple M5 arm64 and Intel i7-10750H Linux x64. Three fresh,
sequential processes per row/variant, parsing plus execution; RSS is process
peak. The machines are shared; these are observations, not latency guarantees.

| Full program | Mac median s | Mac MiB | Intel median s | Intel MiB |
| --- | ---: | ---: | ---: | ---: |
| Original | 7.476 | 622.8 | 28.926 | 585.0 |
| Original with stored `Fs` | 4.298 | 619.2 | 17.318 | 583.2 |
| Function, direct iterator | 3.362 | 630.1 | 11.668 | 585.2 |
| Function, named `Fs'`, compiler support | 3.263 | 625.9 | 11.651 | 586.1 |
| Same named function, support disabled | 10.350 | 632.6 | 39.979 | 600.3 |

Thus the same named program benefits by about 3.17x / 3.43x from compiler
support. Against the original program the combined change is about 2.29x /
2.48x. Peak memory is essentially unchanged against the original program;
this is not a memory optimization.

The named-stage series preceded final error-location/capability refinements.
A separate full run of the final code on Mac took 3.357 s / 622.6 MiB; the
support-disabled final control took 10.904 s / 636.9 MiB. See the raw evidence
for Intel confirmation. All full runs matched every ordered modulus (SHA-256
`ca14146670c77609e515ce5b7ee01ac85c1c54c6d384a3212c89c940834a63e4`),
the selected index and complete answer.

Arithmetic bit traversal and an experimental Number kernel for text traversal
were slower: full-bound modulus preparation with the extracted helper took
4.552 s and 4.142 s respectively, versus about 2.965 s with the existing exact
text helper. These are exploratory single samples, not medians. Both approaches
are retained as research controls; neither is enabled in production.

Reference modulus preparation still takes tens of seconds: the original
completed in 38.999 s, and the final function in 43.945 s. The latter overlapped
focused test execution, so this is correctness evidence, not an isolated speed
comparison. The reference interpreter has not been accelerated. The full
reference audit exclusion is unchanged.

## Verification

- Mac: 557 tests / 24 ordinary focused files pass; full Euler 263 is included.
- Intel: 556 tests / the same 24 files pass, followed by the final added budget
  and cancellation regression in the focused plan suites.
- New cases cover repeated consumption, factor/divisor pipelines, branch and
  loop scopes, unused failing operands, exact error positions, native domain
  failures, captured input rebinding, recipe rebinding, builtin replacement,
  demand budgets, cancellation and recovery after a cached fast call.
- Euler 399's independent prime-square recurrence now runs with compilation
  enabled and disabled. Full outputs and complete modulus hashes match on
  both hosts; the original full list also matches the independent SPF oracle.
- Build and interpreter test TypeScript checks pass; semantic boundary and
  application-form checks pass. Full npm test and exhaustive audits not run.

A wider selected run found two existing `explicit-plan-demos.test.ts` failures:
`shares explicit Mertens memo entries beyond the precomputed cutoff`, in both
engines, reports `unknown name: mertens`. Both reproduce unchanged on the
separate base checkout (`9b78d09b`); they are not caused or repaired here.

## Reproduce

Build with `node node_modules/typescript/bin/tsc -b tsconfig.build.json`.

```sh
node benchmarks/euler399-followup.mjs 5714285 compiled demos/euler/399_squarefree.ra full
node --import ./benchmarks/experiments/euler399-no-iterable-bindings.mjs \
  benchmarks/euler399-followup.mjs 5714285 compiled demos/euler/399_squarefree.ra full
python3 benchmarks/experiments/euler399-plan-series.py /tmp/results.jsonl
```

`euler399-series.py` compares saved original, stored and direct-function sources.
The Number-text loader is an incomplete research prototype, not a supported
compiler mode. Raw samples and final source hashes are in
`baselines/2026-11-04-euler399-followup.json`.
