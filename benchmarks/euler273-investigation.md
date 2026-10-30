# Euler 273 investigation

The next unfinished numerical workload in issue [447](https://github.com/kmmbvnr/rank/issues/447)
after Euler 272 is `euler/273_sumofsquares.ra`. Its ordinary fixture checks
limits 20, 40 and 60; the issue's expensive workload is the full main at 150.
The historical table reports 146.1 s reference and 130.8 s compiled under
concurrent corpus execution. Those observations are not controlled baselines.

The [problem](https://projecteuler.net/problem=273) asks for the sum of the
smaller coordinates of all representations of squarefree products of primes
congruent to 1 modulo 4, with primes strictly below 150.

## Existing work and compiler coverage

There are 16 eligible primes. The program splits them into two groups of eight.
Each prime is omitted, included as `u + vi`, or included as its conjugate.
Each half therefore contains `3^8 = 6561` Gaussian integers. The final loop
computes `3^16 = 43,046,721` pair products and sums
`min(abs(real), abs(imaginary))`, dividing by two for conjugation symmetry.

The splitting keeps the stored input small, but it does not reduce the number
of final pair products. Every row also observes several intermediate arrays.

Two compiler limitations are relevant:

* `numbers.abs` registers a scalar builtin without a result-domain descriptor.
  `scalarBuiltinArray` cannot propagate a numeric expression recipe through
  this type-preserving operation. `abs` is also absent from the native tensor
  operator set. The loop containing deferred bindings falls back; it does not
  become one scalar loop merely because its individual arithmetic is compilable.
* The speculative Number tensor reducer handles arithmetic and comparisons,
  but not integer `min`/`max`. Replacing `abs(x)` by `max(x, -x)` and making the
  intermediate observations deferred admits an exact fused tensor fold, but
  still performs the 43 million pair products with exact integer operations.

This is not a reason to make deferred assignments eager or erase ordinary `=`
boundaries. A general fix should preserve numeric domains for pure builtins,
lower `abs`/`min`/`max` safely, retain exact BigInt arithmetic and overflow replay,
and preserve demand/error order. Generic callback purity cannot be inferred
from a familiar function name.

Diagnostic pilots at full input:

* Deferred `Lo`/`Hi` alone: 31.709 s, 301,327,294 computed cells.
* Deferred arithmetic `abs` equivalent: 11.913 s, 247 computed cells,
  6,642 compiled tensors; its 33 Number tensors belong to the setup.
* Explicit nested scalar loops with a row accumulator: 4.546 s, 247 computed
  cells, one compiled loop. Speculative numeric overflow occurs; exact replay
  preserves the final answer. This is a control for compiler coverage, not the
  recommended algorithm.

## Exact prefix-sum algorithm

The `prefix` prototype retains the half-list construction. It maps each pair
of coordinates to `(x,y)` with `x >= y >= 0`. It keeps the duplicate entries,
so it does not need deduplication or a special representation for the identity.

Sort the second half `(u,v)` by `v/u`. For fixed `(x,y)`, the two orientations
of the product contribute:

```
same conjugation: min(x*u - y*v, x*v + y*u)
other conjugation: abs(y*u - x*v)
```

Both are piecewise linear in `u,v`. Their boundaries are respectively
`(x+y)*v <= (x-y)*u` and `x*v <= y*u`. Two binary searches find the boundaries;
prefix sums of `u` and `v` then sum the whole row without forming its products.
The original half lists repeat each nonidentity canonical representation twice.
Dividing the combined two-orientation sum by four handles both these duplicates
and the cases where either half contains the identity.

Sorting is exact: let `M = max(u)`, then sort by integer keys
`floor(v*M^2/u)`. Two distinct slopes differ by at least `1/(u1*u2)`, hence
their scaled keys cannot coincide. Equal slopes can appear in either order.
Coordinates, keys, prefix sums and accumulators retain Rank integer semantics;
there are no floating angle calculations or approximate comparisons.

The expensive phase changes from `O(3^n)` pair products to
`O(3^(ceil(n/2)) * n)` sorting/search work, with `O(3^(ceil(n/2)))` storage.
At the default input it performs about 170,000 binary-search comparisons
instead of 43 million pair products. The final answer is
`2032447591196869022`.

## Scope and reproduction

Three fresh-process rounds on Node v24.15.0, macOS arm64, revision
`721b2e245e8cbd25d668fcd3906e4fffd1345365`; each round rotates case order.
Cases execute serially, with no own build/test job overlapping the timings.
Other host load is uncontrolled. All timed full-input runs assert the same
exact answer. No diagnostics or stage-print instrumentation is enabled.

| Variant | Engine | Median, s | Range, s | Median peak process RSS, MiB |
| --- | --- | ---: | ---: | ---: |
| Original | compiled | 28.384 | 27.768–30.162 | 337.6 |
| Original | reference | 29.536 | 28.821–29.899 | 335.3 |
| Deferred arithmetic `abs` | compiled | 12.484 | 12.087–12.524 | 491.0 |
| Scalar row loop | compiled | 4.949 | 4.905–5.059 | 184.7 |
| Prefix algorithm | compiled | 0.195 | 0.190–0.213 | 186.4 |
| Prefix algorithm | reference | 0.452 | 0.451–0.507 | 192.8 |

Relative to these current controls, the prefix algorithm is about **146x**
faster compiled and **65x** faster in reference mode. It also reduces median
peak process RSS by about 45% compiled and 43% reference. These are process
high-water marks, including runtime setup, not a direct live-cell measurement.
The arithmetic rewrite demonstrates compiler headroom, but uses more peak
memory and retains the inferior pair enumeration.

Recommended implementation: use the exact prefix algorithm for the demo;
separately improve type-preserving builtin maps and native numeric
`abs`/`min`/`max` consumers for general programs. Do not change numeric admission
thresholds, deferred semantics or test lanes to accommodate this workload.

Verification: the independent oracle enumerates squarefree subset products and
directly tests `a^2 + b^2 = N` with integer square roots. Sixteen limits from
1 through 60, including prime boundaries, pass for both the original and prefix
programs in both engines (**64 comparisons**). Existing fixture type and
differential checks pass (**2 selected audit tests**). Every full timing sample
also asserts `2032447591196869022`. Whole-corpus audits were not run.

The baseline JSON retains all 18 full timing samples, diagnostic pilots, oracle
results, hashes and verification scope. Frozen original and prefix Rank sources
are in `benchmarks/experiments/euler273-{original,prefix}.ra`.

The initial investigation added benchmark/experiment artifacts only. The
subsequent implementation is described below. The small fixture remains useful.

```sh
node benchmarks/euler273-investigation.mjs compiled original 150
node benchmarks/euler273-investigation.mjs reference prefix 150
STAGES=1 DIAGNOSTICS=1 node benchmarks/euler273-investigation.mjs compiled prefix 150
python3 benchmarks/euler273-verify.py
```

`original`, `deferred`, `arithmetic-abs`, `scalar`, `rows` and `prefix` are
separate experiments. `DUMP_SOURCE=1` emits the selected Rank source.
Execution timings exclude JavaScript imports and include Rank parsing/execution.
Diagnostics are optional and excluded from repeated timing samples.

## Implementation and delivery

The production demo now uses the exact prefix algorithm. The original fixture
assertions remain; limits 5 and 6 check strict prime inclusion, and a full
`Limit = 150` assertion is added in both engines.

General runtime/compiler changes:

* Pure scalar builtins can declare a numeric result that preserves the input
  domain. Integer `abs` lowers through existing negation/max IR; real `abs`
  retains its checked scalar implementation, including NaN and signed zero.
* Private checked Number tensor sums now accept integer min/max. The existing
  selected-position consumer is also reused for complete rank-one sums.
  Unsafe cells or accumulation overflow fall back to the exact consumer.
* Only runtime-owned pure scalar-kind view checks may be replayed. Other
  per-cell checks keep exact execution and callback order. Code-generation
  failure retains fallback; compilation observers receive generated Number code.
* The older stored-integer abs shortcut now checks that the builtin body has
  not been replaced, matching the new recipe guard.

No numeric thresholds or execution deadlines change. Ordinary `=` completion
and deferred capture/demand semantics remain intact.

Final three-sample serial series, same machine/Node and timing scope as above,
after the compiler changes (separate from the initial series):

| Variant | Engine | Median, s | Range, s | Median peak RSS, MiB |
| --- | --- | ---: | ---: | ---: |
| Frozen original, compiler changes only | compiled | 9.004 | 8.977–9.022 | 356.2 |
| Original with deferred Lo/Hi | compiled | 1.284 | 1.283–1.296 | 544.6 |
| Shipping prefix algorithm | compiled | 0.187 | 0.186–0.188 | 185.5 |
| Shipping prefix algorithm | reference | 0.426 | 0.425–0.428 | 191.9 |

The compiler alone improves the unchanged original from 28.384 to 9.004 s,
about 3.15x. The final algorithm plus runtime changes improve compiled time
about 152x and reference time about 69x against the initial controls.
The deferred pair-product variant is not shipped: it retains all 43 million
pairs and uses much more peak memory.

Validation: TypeScript build; 925 tests across 40 focused tensor/rank/builtin
files; four scoped type/differential audit cases for both the main and fixture;
32 additional independent oracle comparisons of the shipping source; semantic
boundary checks (11 tests, 65 owners). Full-corpus audits were not run.
