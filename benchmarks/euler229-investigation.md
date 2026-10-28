# Euler 229: sieve execution and positive square representations

The demo now uses bulk strided marking, filters stored indices before mapping
prime values, and counts square representations through prime factors of their
roots. The code retains its prime-core algorithm, array sieve and default limit
of 2,000,000,000. All three existing fixture assertions are unchanged.
Compiler/runtime code, deferred-binding semantics and the Number copy-cost cap
are unchanged.

## Delivered source on current main

The delivery comparison uses the runtime at `24447b05`, rebuilt after the
unrelated compact-distinct cleanup. Apple M5, Node v24.15.0, darwin arm64.
Three fresh sequential processes per source and engine; original/shipping
interleaved, unchanged full default input. Module import is excluded; source
loading, parsing, preparation and execution are included.

| Source | Compiled median s | Reference median s | Compiled/reference median peak RSS MiB |
| --- | ---: | ---: | ---: |
| original | 14.84 | 88.57 | 894 / 985 |
| shipping | 3.74 | 9.83 | 856 / 1538 |

All twelve answers are **11,325,263**. Speed improves **3.97x compiled** and **9.01x reference**.

Peak RSS is process highwater, not retained memory; it varies with garbage
collection. Report each engine separately rather than claiming a universal
memory improvement. Raw samples and runtime/source hashes are in
`baselines/2026-10-28-euler229-delivery.json`.

Delivery checks passed:

- TypeScript build; 120 focused tests across five collection/mask/concat/block-copy suites.
- 176 small-limit comparisons with independent positive `(a,b)` enumeration:
  original/factor/compact/shipping sources, 22 limits, both engines.
- 20,004 independently enumerated square flags and 178,888 full-range comparisons
  against the original divisor algorithm.
- Complete existing fixture in both engines: two test blocks, three assertions,
  including the unchanged full default answer.
- CLI static checks of main and fixture, zero failures.
- Scoped fixture type audit and differential audit; the latter compares two test
  blocks with 128 compiled entries and 15 Number-loop entries.

The fixture was temporarily enabled only in the validation checkout for those
scoped audits, then its execution-exclusion entry was restored. The shipping
execution-budget catalogue is unchanged. No full runtime-suite or Intel run is
claimed. The shipping executable statements match the measured compact prototype;
comments now describe the prime-factor square criterion.

Reproduce the delivered source using the benchmark with no `--variant` option;
use `--fixture` for the complete existing test file, with optional `--reference`.
The oracle also checks the current shipping source.

## Historical investigation

Research at `781c813e` on Apple M5, Node v24.15.0, darwin arm64. The live
issue #447 inventory selects `229_foursquares.ra` and its fixture as the next
unfinished files across both the observed and execution-budget sections.
At that research stage, the demo and fixture were unchanged; variants are research prototypes captured
in the baseline JSON. No interpreter changes or Number-budget changes are made. During research main
advanced to `24447b05`, removing an unreachable compact-distinct branch. The
measurements deliberately retain the same pinned `781c813e` runtime throughout;
this demo does not use distinct.

## Findings

The existing program already uses a good structural algorithm. It sieves prime
classes modulo 168 and counts squarefree cores with one, two or three such
prime factors, weighted by square multipliers. It does not enumerate every
representation up to two billion. The expensive parts are executing the sieve
and the separate correction that requires positive coordinates for squares.

One instrumented original full run took 14.83 s compiled and 89.22 s reference.
The sieve occupied 10.83 / 36.04 s; square correction occupied 2.67 / 51.88 s.
These are exploratory single samples; the repeated comparison below is the
source for final timing claims. Source loading, parsing, preparation and execution
are included; runtime-module import and process startup are excluded.

There are three useful source improvements:

1. Replace the scalar marking loop with `Sv (Fk till Kn by Q) = 1`. This uses
   the existing bulk range-write implementation. The full prototype performs
   13,927 bulk writes covering 57,424,005 cells instead of executing each write
   through the scalar exact-integer region.
2. Filter the stored indices before affine mapping:
   `Pm = ((Ix filter Keep) * 168 + R) copy`. The old deferred `Vals`/`Pm`
   construction records 12,273,010 computed lazy cells; the new construction
   records zero. This is an explicit source materialization choice, with no
   change to the language's deferred-binding semantics.
3. Count positive representations of squares from prime factors of their roots,
   rather than constructing all divisors of `d * b^2` for each `b` and `d`.

The full default remains 2,000,000,000 and its answer remains 11,325,263.
The prime-core counting algorithm, binary searches, and array sieve are retained.

## Square correction

For a positive root `m`, the four tests are:

| Form of `m^2` | A sufficient and necessary factor in `m` |
| --- | --- |
| `a^2 + b^2` | A prime `p = 1 mod 4` |
| `a^2 + 2 b^2` | A prime `p = 1 or 3 mod 8` |
| `a^2 + 3 b^2` | A prime `p = 1 mod 3`, or `2` |
| `a^2 + 7 b^2` | An odd prime `p = 1, 2 or 4 mod 7`, or a factor `4` |

These tests are our application of the classical prime representation criteria,
not a quotation from the sources. Relevant primary exposition:
[quadratic forms and prime representations](https://math.uchicago.edu/~may/REU2014/REUPapers/Kaplan.pdf)
and [sums of squares, including the -7 criterion](https://personal.science.psu.edu/rcv4/CENT.pdf).
The task requires both coordinates to be positive, as specified on
[Project Euler 229](https://projecteuler.net/problem=229).

For sufficiency, square a representation of a splitting prime:
`p^2 = (x^2 - d*y^2)^2 + d*(2*x*y)^2`, then scale it by `m/p`.
The exceptional even roots use `2^2 = 1^2 + 3*1^2` and
`4^2 = 3^2 + 7*1^2`. For necessity, remove the common divisor of a positive
representation. Any odd inert prime dividing the remaining root would divide
both coordinates, contradicting primitiveness. Odd ramified primes likewise
cannot supply a primitive square representation. Parity leaves only the stated
2 and 4 exceptions. Factor each `m` using the existing smallest-prime-factor
sieve and combine four flags; no divisor list or representation table is needed.

The criterion was verified separately for all 44,722 roots in the default
range and each of the four forms: 178,888 matches against the original divisor
algorithm, including zero entries. An independent direct `(a,b)` enumeration
verified another 20,004 flags up to root 5,000. The default square contribution
is 12,967.

## Compiler behavior

The original square loop first attempts Number execution, but `U * U` can
exceed the exact Number range even though `N`, `U` and the eventual answer fit.
Diagnostics record one overflow and exact replay. This is correct fallback.
Since `U` is a divisor of `N`, computing `Vv = N // U` and comparing `U < Vv`
avoids the oversized product. The `safe` prototype preserves the divisor
algorithm and removes this overflow; its compiled correction takes about
0.63 s instead of 2.67 s. Reference execution still enumerates all the divisors.
The factor criterion removes that work in both engines.

The original sieve's 11.9-million-cell destination also exceeds the existing
262,144-cell copy-cost probe cap, so its scalar region uses exact execution.
This is not an integer-precision limit or a correctness failure. Bulk range
writes use the existing native path without weakening the rollback/copy policy.
Neither finding justifies increasing the cap for every program. A general
compiler follow-up worth testing would recognize constant-value, in-bounds
strided write loops and lower them to the existing bulk writer, while preserving
iteration bindings and error timing. That compiler transformation is not
implemented or benchmarked here.

## Alternatives rejected in exploration

These full-input values are single exploratory samples, not repeated medians.
Every completed variant returned the correct default answer.

| Variant | Compiled seconds | Reference seconds | Compiled peak RSS MiB |
| --- | ---: | ---: | ---: |
| Original | 14.83 | 89.22 | 889 |
| Safe divisor comparison only | 12.82 | not measured | 947 |
| Bulk marking only | 8.20 | not measured | 906 |
| Bulk marking, filter an unmaterialized range | 15.29 | not measured | 1072 |
| Bulk marking + safe divisor comparison | 6.19 | 64.66 | 889 |
| Segmented sieve, repeated concatenation, safe comparison | 12.93 | not measured | 2938 |
| Bulk marking + prime-factor square criterion | 5.42 | 11.71 | 907 |
| Filter stored indices, bulk marking, factor criterion (`compact`) | 3.72 | 9.66 | 852 |

A naive segmented version reduces individual sieve buffers but repeatedly
concatenates the growing prime list; the measured time and memory are worse.
A future segmented algorithm could count sorted queries offline instead of
retaining every prime, but that is a different design and is not implemented.

## Historical repeated comparison

| Source | Compiled median s | Reference median s | Compiled/reference median peak RSS MiB |
| --- | ---: | ---: | ---: |
| original | 14.71 | 91.76 | 902 / 985 |
| compact | 3.79 | 9.62 | 852 / 1121 |

Compiled speed improves 3.88x; reference speed improves 9.54x. All twelve full runs return 11,325,263. Compiled median peak RSS falls about 6%; reference median peak RSS rises about 14%.


Each sample is a fresh sequential process on the same unchanged runtime.
Original and compact sources are interleaved, with three samples per engine
and source. Process peak RSS is reported separately from timing and is not
retained memory; garbage collection causes substantial variation. No Intel
measurements or universal memory claims are made.

## Historical verification and reproduction

- Independent positive `(a,b)` enumeration through one million: 22 limits,
  original/factor/compact sources, both engines, 132 matching answers.
- Independent square flags and complete default-range comparison described above.
- Full default golden answer checked in each benchmark process.
- Both existing small fixture expectations are covered: 8,637 at one million
  and 75,373 at ten million. The latter also matches the official problem text.
- The portable benchmark and oracle scripts were rerun successfully. The compact
  prototype also returns 75,373 at ten million in both engines.
- The existing fixture itself and a full interpreter suite were not rerun for
  this investigation. No source/runtime release is being claimed.

Raw sources, phase diagnostics, environment, runtime hashes, exploratory samples,
repeated samples and verification results are in
`baselines/2026-10-28-euler229-investigation.json`.

```sh
node benchmarks/euler229-foursquares.mjs --variant=original --phases
node benchmarks/euler229-foursquares.mjs --variant=compact --phases
node benchmarks/euler229-foursquares.mjs --variant=compact --reference --phases
node benchmarks/experiments/euler229-oracle.mjs /absolute/path/to/out/index.js
```

Use `--runtime=/absolute/path/to/out/index.js` if the runtime is not built in
this checkout. To repeat a smaller source run, pass `--Limit=1000000`.
