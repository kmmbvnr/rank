# Euler 432: totient tables and exact array updates

Full input N=100000000000, table limit L=10000000; answer **754862080**.
Primary baseline: `70ba2131594c359bf91a9ad5a2316051cdcae568`.
The historical approximately 43-second issue observation is not this baseline.

## Program

The summatory-totient/17-smooth decomposition is retained. Small-prime powers
remove factors directly from a residual-factor array; the remaining factor,
when greater than one, is prime and contributes once. The sieve has one loop
and owns its two buffers inside an ordinary function. No global residual,
index, old-phi alias or wide prefix table survives into quotient processing.

The prefix scan now reduces modulo 10^9 as it runs. A modular prefix has the
same answers as reducing the exact prefix afterwards, while keeping Int32
storage. The quotient table still uses the original hyperbola partition and
previously completed entries, in one ordinary function/loop. The triangular
term halves one factor before reducing the factors modulo 10^9, avoiding an
unsafe intermediate product in Number mode.

Smooth numbers use a seven-prime fold with one loop in its expansion helper.
There are no nested Rank loops, no handwritten index memo cache or artificial
wrapper loop. Every production/fixture line fits 40 columns. N=0 is explicitly
an empty sum; existing default inputs and fixture checkpoints are preserved.

## Compiler and reference execution

Private Number slices support `//=` and a discarded source-slice/scalar
transformation using `+`, `-`, `*`, `//` or `mod`. Identical selections can stream
pointwise; other overlaps snapshot their source. Arithmetic/domain failures
replay the ordinary region before speculative stores escape. Escaping transformed
RHS arrays keep fresh-value semantics and remain on the ordinary path.

Function-prefix discard proofs recognize later prefix statements. They exclude
the caller's terminal return. The same proof serves slices, scatters and bulk
writes; ownership, polling and the existing copy-admission thresholds remain.
This lets the sieve allocation and loop compile together without a large entry
snapshot. The delivered full program uses two Number regions, no overflows and
no slice operand copies, with over 23 million direct source cells.

Reference execution needed its own allocation repair. A positive safe scalar
floor divisor cannot widen an Int32 quotient; a native unique linear-selection
writer now commits these quotients without a boxed replacement vector or new
JavaScript compilation. It keeps ownership, revisions, type checks, range
validation and polling. Other storage/divisors, missing cells, custom headers,
shared buffers, inspection, demand budgets and host callbacks retain ordinary
execution. No public operation, language semantics or compiler limit changes.

Without this native writer, the rewritten source improved speed but raised full
reference peak RSS. That variant was rejected: see the source-only reference
control below. No reference memory regression is hidden behind compiled gains.

## Measurements

Apple M5 arm64 and Intel Core i7-10750H x86_64, Node v24.15.0. Three fresh-process
samples per variant with the middle repetition reversing order. The timed region includes
Rank file read/parsing/execution and diagnostics; JS imports and interpreter
construction precede the timer. Other sessions were active;
absolute wall times remain load-sensitive. RSS is whole-process peak, not live
array bytes or an allocation count.

| Compiled variant | Mac seconds | Mac peak MiB | Intel seconds | Intel peak MiB |
| --- | ---: | ---: | ---: | ---: |
| Original source/runtime | 12.403 | 1817.2 | 33.684 | 1363.8 |
| Runtime only | 10.293 | 1819.3 | 29.087 | 1331.1 |
| Rank program only | 3.505 | 611.3 | 8.831 | 547.3 |
| Both changes | 3.401 | 529.4 | 8.540 | 386.5 |

| Reference variant | Mac seconds | Mac peak MiB | Intel seconds | Intel peak MiB |
| --- | ---: | ---: | ---: | ---: |
| before | 14.058 | 1991.0 | 37.583 | 1599.2 |
| after | 7.620 | 1461.1 | 21.119 | 1156.8 |
| Source only (single control) | 10.562 | 2520.2 | 29.252 | 1663.8 |

Combined compiled speedup is **3.65x on Mac / 3.94x on Intel**; reference
improves **1.84x / 1.78x**. Compiled peak RSS falls about 71% on both hosts,
and reference peak falls about 27–28%.

The source-only reference probe is a single full-input control, not a median.
It isolates why the native scalar division writer is included. All probes check
the same full golden answer.

Single earlier Mac scouts of the optional L argument traded speed for memory:
L=5000000 took 4.434 s / 415.9 MiB, L=2000000 took 6.214 s / 344.4 MiB.
They are not primary samples. The default L remains 10000000 to favor speed.

## Verification and lane

- Independent oracle directly factors each `510510*i` and sums its totient,
  without summatory-phi or smooth-number inversion. Forty-two bounds through
  10000, two table settings and three execution configurations give **252
  comparisons on each host**. The middle configuration disables Number loops,
  not every native numeric primitive.
- All three fixture tests pass in all three configurations, including the
  unchanged million-element short-table checkpoint. A dedicated test retains
  the full default answer and checks private regions, no overflows/copies.
- **540 focused tests on each host** cover slices, prefix ownership, aliases, polling,
  scalar reference division, scatter, accumulation, ranked addressing and the
  demo. Native guards include shared buffers, custom readers, physical bounds,
  positive/negative/wide divisors, signed endpoints, CoW and warmed budgeted use.
- After integrating main at `5db99d8c`, **559 tests in 16 files pass on each
  host**, including the new shared Int64-extrema/shift components. Separate full
  compiled/reference controls preserve the answer on both hosts. These are
  integration checks, not extra primary samples.
- Two old boolean-scatter backend assertions failed on the clean baseline too:
  indexed gathers already produce fresh snapshots and compile. Assertions now
  reflect that behavior, with a separate named/live-array escape test retained.
  Their actual values/state were already equal across all backends.
- TypeScript build/test typecheck, semantic-boundary, application-form and
  exclusion checks pass. Exhaustive types/differential/Nurikabe audits and full
  `npm test` were not run.
- The obsolete full-default exclusion is removed after full compiled/reference
  verification on both hosts; golden inputs remain and no timeout is increased.

[Raw measurements](baselines/2026-11-06-euler432.json).

After building:

```sh
node benchmarks/experiments/euler432-verify.mjs
export RANK432_BASE_RUNTIME=file:///path/to/baseline/packages/interpreter/out/index.js
node benchmarks/experiments/euler432-pairs.mjs
node benchmarks/experiments/euler432-pairs.mjs reference
```

Keep matching language dependencies with the baseline interpreter. Runners retain
and execute the original Rank source. Run focused tests through the interpreter
package's `scripts/test.mjs` from that package directory.
