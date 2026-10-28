# Euler 211: fresh integer arrays in Number loops

The next unfinished numbered entry in issue #447 on 2026-10-27 was
`euler/211_divisorsquare.ra`. Its execution-budget exclusion remains unchanged.
The initial investigation below used c7dadbc4; shipping implementation and
verification are recorded in the final section.

## Initial investigation: finding

The existing segmented divisor-pair sieve is already compiled, but its outer
region contains `Sig = array shape Block fill 0`. `prepareNumberLoop` rejects
`plan.arrayDefinitions.size` in `number-loop-runtime.ts` at c7dadbc4, so the entire region
uses the publishing exact-integer backend. The allocation itself is not the
main cost: moving the buffer before the outer loop and explicitly clearing it
between blocks enables one private Number loop, with no overflow in the full
run. This retains the same divisor-pair enumeration.

For Limit = 64,000,000, the loop performs exactly 580,126,499 divisor-pair
updates, plus 63,999,999 perfect-square checks. Its asymptotic cost is
O(Limit log Limit), with O(Block) auxiliary storage. A more sophisticated
segmented prime-factor sieve reduces enumeration to prime multiples and uses
multiplicativity of sigma_2, but its extra divisions, remainder tests and second
buffer make the measured prototype slower than the reused-buffer original.

Safe-number arithmetic is sufficient for the default problem: sigma_2(n) / n^2
is the sum of reciprocal squares of divisors, less than 2. Thus sigma_2(n) is
less than 8.192e15 for n < 64,000,000, below 2^53. The Number backend still checks
operations and retains exact overflow replay; this is not a request to loosen
precision or loop-storage admission rules.

## Reproduce

Build TypeScript first; then from the repository root:

```sh
node benchmarks/euler211-divisor-square.mjs
node benchmarks/euler211-divisor-square.mjs --reuse
node benchmarks/euler211-divisor-square.mjs --multiplicative
node benchmarks/euler211-divisor-square.mjs --reuse --diag
node benchmarks/euler211-divisor-square.mjs --Limit=100000 --reference
```

`--runtime=/absolute/path/to/index.js` permits a separate built runtime.
`--Block=...` controls the buffer size. The prime-factor prototype is in
`benchmarks/experiments/euler211-multiplicative.ra`.

## Initial implementation requirements

Prefer general support for fresh local integer arrays in Number regions over
rewriting this demo solely to accommodate compiler eligibility. Current exact
code generation materializes and publishes each new array immediately; the
Number backend requires private speculative storage. Supporting allocations
needs their own private buffers and correct binding publication, preserving
fresh-array identity, aliases/COW snapshots, zero-iteration behavior, completed
writes on ordinary errors/cancellation, and exact replay on overflow.
Simply deleting the eligibility check does not supply this lowering.

The reuse experiment is an explicit program rewrite, not a claim that arbitrary
allocations can be hoisted transparently: it introduces a Clear binding and
creates Sig even when the outer loop is empty. Its Answer is independently
checked for empty/small limits and non-dividing block sizes.

The full-input CPU profile was collected separately from timing samples.
Self samples included frame.js (20.26%), exact run wrapper (11.44%),
owned-array anonymous code (7.34%) and integerSquareRoot (2.39%); the largest
anonymous generated body was 39.96%. These are sampling observations, not an
allocation-cost accounting or proof that all time is BigInt arithmetic.

## Initial measurements and verification

macOS arm64, Node v24.15.0, built runtime at c7dadbc4. Three serial
fresh processes per full-input variant, alternating original/reuse/prime-factor.
Imports and interpreter construction excluded; parsing, compilation and execution
included. No profiling or diagnostics in admitted timing samples.

| Variant | Median seconds | Range seconds | Median peak RSS MiB |
|---|---:|---:|---:|
| original | 47.579 | 46.622–48.562 | 392.17 |
| reuse | 5.956 | 5.832–5.956 | 219.75 |
| multiplicative | 10.303 | 10.284–10.326 | 231.98 |

All nine full-input runs returned 1922364685. Reused-buffer speedup is 7.99x;
process peak RSS falls about 44%. RSS is a GC-dependent high-water mark, not
retained storage. The separately profiled original run took 46.534 seconds.
Separate full-input diagnostic runs confirmed one compiled loop in each prototype;
reuse and prime-factor each entered one Number loop, with zero overflow replay.
The original small-input diagnostic entered one exact compiled loop and no Number loop.

96 checks compared all three variants with a brute-force divisor-square oracle:
limits 1, 2, 3, 10, 42, 100, 257 and 1000; block sizes 7 and 31;
compilation enabled and disabled, fresh interpreter each time. All passed.
A reproduction-harness smoke at Limit=1000, Block=31 also returned 1304.

Single small-input controls (Limit=100000, still allocating a million-cell block)
returned 462294 in every variant/policy. Original: compiled 190 ms, reference
621 ms. Reuse: compiled 211 ms, reference 939 ms. Prime-factor: compiled 207 ms,
reference 804 ms. These are smoke measurements, not repeated performance claims.
They demonstrate the unnecessary full-buffer clearing cost of the explicit reuse
rewrite for tiny inputs; do not replace the demo on the strength of default-only
speedup. Full-input reference execution was not measured. No full test suite was
run because this investigation does not change shipping code.

Raw timing/control samples and independent verification cases are retained in
`benchmarks/baselines/2026-10-27-euler211-investigation.json`. The temporary CPU
profile remains `/tmp/rank211.cpuprofile` and is not committed.

## Shipped implementation

The Number lowering now accepts definitely assigned fresh integer
`array shape ... fill ...` allocations. Each allocation creates its own private
Int32/Float64 buffer and shape. Scalar writes use the existing checked integer
arithmetic and widen Int32 storage before a value could truncate. Completed
arrays are published as exact integer storage, including on ordinary errors and
Atomics cancellation. The previous completed loop result retains its own array
when a later iteration allocates another array and then continues.

Overflow publishes nothing and re-enters the existing exact execution path from
the original inputs. Shape/fill dependencies are kept numeric by the general
mixed-register analysis. Fresh buffers have no entry-copy cost, so they are not
counted against the existing condition-loop copy budget. No admission thresholds
were changed. Local aliases/COW, entry-dependent local reads, local array
traversals and other constructors keep their existing fallback.

The Euler 211 main source, default Limit/Block and divisor-pair algorithm are
unchanged. Only the obsolete fixture comment was updated; its inputs and
assertions are unchanged. Neither research algorithm replacement was adopted.

### Validation

- TypeScript project build passes.
- 179 Number-loop tests pass, including 15 new cases for fresh arrays, changing
  shapes, widening, existing snapshots, zero iterations, overflow replay,
  partial errors, skipped assignments, binding contracts and cancellation.
- 9,106 ordinary interpreter tests in 401 files pass in the final full run
  (two workers, 160.25 seconds). A preceding four-worker run hit three default
  5-second deadlines, with approximately 29-second stalls in unrelated slice,
  reshape and window tests. All 79 tests in those three files passed when
  rerun serially; the subsequent complete two-worker run passed as well.
- Two Euler 211 type audits pass, including forced execution of the full main
  input in the isolated validation checkout; one fixture differential audit
  passes with compilation enabled/disabled.
- The 96 independent small-input checks were repeated against the final
  runtime, across both execution policies and all three research variants.
- A separate full-input diagnostic run returned 1922364685, entered one Number
  loop and reported zero overflow replay. Diagnostics were excluded from timing
  samples.

The unchanged main execution-budget exclusion is retained. Full default-scale
reference execution and corpus-wide demo audits were not rerun. The scoped
fixture audit and independent small oracles cover reference correctness here.

### Shipping measurements

The final baseline uses the same built runtime/dependencies, replacing only the
four changed modules with c7dadbc4 source emitted at the repository's ES2020
target. Three alternating fresh-process pairs per cohort, serial with no heavy
work in parallel. The earlier investigation and diagnostic samples are separate.

| Default compiled main | Median seconds | Range seconds | Median peak RSS MiB |
|---|---:|---:|---:|
| before | 51.184 | 49.668–52.247 | 434.48 |
| after | 5.072 | 5.046–5.078 | 279.42 |

Speedup: **10.09x**. Process peak RSS is about **36% lower**. All six
full-input timing samples returned 1922364685 from byte-identical main source.
RSS is a whole-process, GC-dependent high-water mark, not retained storage.

| Control (three pairs) | Before median ms (range) | After median ms (range) |
|---|---:|---:|
| fixture | 211.96 (207.66–216.90) | 171.13 (169.71–175.14) |
| fixture-reference | 643.27 (636.28–650.82) | 647.89 (641.88–654.44) |
| euler200-control | 420.70 (417.50–425.26) | 421.25 (420.76–421.33) |
| euler210-control | 2997.33 (2993.86–3013.50) | 2999.17 (2961.22–3026.00) |
| euler214-small-control | 326.21 (325.84–336.16) | 191.30 (184.36–196.00) |

Euler 200/210 use their unchanged full default inputs. Euler 214 is only a small
control (Limit=100000, Len=15, Block=5000, answer 162726509), not a completed
investigation of its default input. All control golden checks passed. These
small control cohorts do not establish universal performance across programs.
The reference fixture is measured separately; no full-main reference speedup
is claimed.

Raw final timings, measurement/control/oracle scripts, 96 independent checks,
and full diagnostic counters are retained in
`benchmarks/baselines/2026-10-27-euler211-optimization.json`.
