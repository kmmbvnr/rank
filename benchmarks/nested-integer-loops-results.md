# Nested integer array loops and Euler 370

Issue: [#382](https://github.com/kmmbvnr/rank/issues/382).
Baseline: `114eaf44`. Apple M5, Node v24.15.0.
Raw samples and intermediate compiler source hashes:
[`baselines/2026-10-23-nested-integer-loops.jsonl`](baselines/2026-10-23-nested-integer-loops.jsonl).

Run after `npm run build`:

```sh
node benchmarks/nested-integer-loops.mjs
node benchmarks/nested-integer-loops.mjs --cases=sieve,current --limit=25000000000000 --timeout=60000
```

Each sample uses a fresh process. Euler and SPF timings include parsing,
allocation and execution. The division microbenchmark warms the parser first.
Independent oracle work is outside every timer. The original program is retained
in `fixtures/370-triangles-original.ra` for comparison. `--diagnostics=yes`
collects compiler counters in a separate run; `--runtime=file:///.../out/index.js`
selects another built interpreter.

## Measured changes

Medians of three sequential samples per row, without concurrent builds or tests:

| Program / mechanism | Input | Time |
| --- | ---: | ---: |
| Original, baseline interpreter | 100,000,000 | 2,430.105 ms |
| Original, numeric conversion compilation alone | 100,000,000 | 2,717.335 ms |
| Original, conversion plus linked array helpers/materialization | 100,000,000 | 505.507 ms |
| Original, all interpreter changes including division | 100,000,000 | 641.744 ms |
| Revised algorithm, all interpreter changes | 100,000,000 | 340.137 ms |
| SPF alone, baseline | 25,000,000,000,000 | 442.921 ms |
| SPF alone, final interpreter | 25,000,000,000,000 | 350.717 ms |
| One million integer quotients, baseline | numerator 100,000,000,000,000 | 94.317 ms |
| One million integer quotients, bounded division | same | 27.101 ms |

Numeric conversion alone does not improve this program. It enables compilation
of `triq`, which is needed to link the surrounding helpers. Linked helpers give
an observable improvement before changing the algorithm. The bounded division
path is about 3.48 times faster in the isolated arithmetic workload. Subsecond
Euler samples include substantial cold parser/compiler startup; the table does
not attribute the difference between the two linked-helper rows to division.
The final Euler program is about 7.14 times faster than baseline at 100 million.
SPF is a small part of the full computation; its implementation is unchanged.

The original full input exceeded a 30-second timeout during diagnosis. The final
program completed all three full-input samples with `41791929448408`:

| Trial | Time |
| --- | ---: |
| 1 | 28.181 s |
| 2 | 28.330 s |
| 3 | 31.159 s |

The median is **28.330 seconds**. This is not a guarantee of completion below
30 seconds on every run or machine. A full-input speedup ratio is unavailable
because the baseline run was stopped. The full answer was also independently
reproduced by a direct JavaScript translation of the original quotient-block
algorithm (55.582 s, including its sieve).

## Interpreter changes

- Compile `integer` for real, integer and boolean scalar inputs as well as text;
  preserve truncation, non-finite errors and current builtin identity guards.
- Link helpers with proved, completed array arguments and array results. Nested callee
  array writes retain the ordinary call path. Linked integer-container arguments
  from #380 remain supported.
  Local integer queues, stacks and deques can materialize through the existing
  collection materializer, including its ordering and cancellation behavior.
- For safe numeric loops, emit `floor(a / b)` when `abs(a) < 2^52`. The rounding
  error is too small to cross an integer boundary. Wider numerators retain
  checked remainder-based division, and zero divisors retain the existing error.
  The surrounding overflow replay and partial-state publication are unchanged.

## Algorithm changes

The SPF sieve remains. Small rows enumerate candidate Q values and reject shared
prime factors directly. Large rows build signed square-free divisors once per P
and reuse them across quotient blocks. Each block computes only its upper
coprime prefix; the preceding block supplies the lower prefix. The initial lower
prefix is Euler's totient of P. This removes recursion from the hot loop and
avoids computing the same prefix twice.

Exact integer-square-root formulas replace the corrected floating estimate and
repeated boundary helper calls. The cube-root pivot changes only the amount of
work, not the answer. Scratch capacity follows the bound of at most
`2 * floor(sqrt(P))` positive divisors. Separate loops for the two row regimes
allow the existing numeric loop compiler to keep scalar state and scratch
arrays private for each region.

## Integration with concurrent main changes

The staged measurements above used baseline `114eaf44`. Before delivery the
change was rebased onto `c6422b9c`, preserving #380's linked integer-container
support and #383's integer groups. An additional test checks that a linked
container materialization is a snapshot across subsequent shared mutations.
The build and all targeted tests below were repeated after integration. A further
full-input run completed in **27.287 seconds** with `41791929448408`; it is recorded
under `integrated-main` in the raw samples.

## Verification

- `npm run build` passed.
- 354 interpreter tests passed across twelve targeted files: array arguments,
  real scalar functions, scalar kernels, recursion, proof eligibility, numeric
  loops, Euler 370, array-returning loop calls, array operations, operations,
  recursive search and integer groups.
- 133 language tests passed: compiled expressions, function effects, scalar
  read effects and collection contracts.
- `rank test demos/euler/370_triangles_test.ra` passed all five existing checks.
- New Euler tests compare both compilation modes against exhaustive primitive
  pair enumeration around small boundaries, and the compiled implementation
  against enumeration through one million. Benchmark inputs through 100 million
  also use exhaustive enumeration. SPF benchmarks check every sieve cell against
  an independent sieve.
- New tests cover linked queue/stack/deque results, empty materialization, COW
  across an aliased linked result, conversion errors, and signed division around
  both the bounded-path threshold and safe-integer limits.

The full `npm test` and corpus-wide checks were not run.
