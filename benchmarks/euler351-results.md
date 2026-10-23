# Euler 351: exact recursive summatory totients (#372)

The program in `demos/euler/351_orchards.ra` is unchanged. Both the original and
compiled versions compute `11762187201804552` for `N = 100000000`.

## Interpreter changes

1. Compile domain-preserving self calls after an earlier scalar base return.
   Admit tracked integer index arguments with their maintained domain proof;
   distinguish array reads from keyed reads. Preserve shared index mutations,
   ordinary non-tail recursion limits, self tail transfers, source errors and
   cooperative polling. Recursion that writes arrays retains ordinary execution.
2. Prove entry domains from completed trusted scalar storage when an array's
   semantic domain is unresolved. Cache code by these proven domains. This does
   not change semantic array types or function return-contract keys, inspect
   lazy cells, or admit arbitrary host arrays.

These steps matter independently. The initial recursive-kernel stage compiles
Euler 351 at one million, where its prefix array has 1001 cells. At one hundred
million the 10001-cell prefix array has an unresolved semantic type; the second
stage makes its already stored integer cells eligible too.

## Measurements

Apple M5, Node v24.15.0. Baseline: `38616d22`. Samples run sequentially in fresh
processes, with diagnostics disabled. `executeMs` includes parsing and kernel
preparation; `processMs` also includes Node startup and module loading. Every
sample checks the exact answer. A separate host implementation checks the
summatory recurrence using a numeric integer-valued sieve and BigInt totals.

Results are recorded in the linked JSONL files below. The intermediate stage is
the final compiler with only the stored-domain entry fallback disabled; this
retains semantic-domain array admission. It is a measurement build, not a
runtime option.

| Input | Baseline | Recursive kernels, semantic arrays only | Final | Final speedup |
|---|---:|---:|---:|---:|
| 10,000 | 192.72 ms | 125.11 ms | 124.94 ms | 1.54x |
| 1,000,000 | 1622.84 ms | 140.19 ms | 140.14 ms | 11.58x |
| 100,000,000 | 44671.06 ms | 44449.29 ms (one sample) | 420.47 ms | 106.24x |

Raw data: [small and million, three samples per stage](baselines/2026-10-23-euler351-small.jsonl),
[full input, three baseline/final pairs](baselines/2026-10-23-euler351-full.jsonl),
[full input, intermediate stage, one pair](baselines/2026-10-23-euler351-phase1-full.jsonl).
The one intermediate full-input sample is not a repeated median.

Reproduce after building:

```sh
node benchmarks/euler351.mjs --cases=small,million,full --trials=3
node benchmarks/euler351.mjs --baseline=/absolute/path/to/baseline/out/index.js --cases=million,full --trials=3
node benchmarks/euler351.mjs --phase1=/absolute/path/to/semantic-only/out/index.js --cases=million,full --trials=3
```

## Focused verification

- `npm run build` passed, including web builds and Capacitor sync.
- 318 tests passed in 13 scalar, recursion, call-boundary and container files.
- Both orchard shared-cache tests passed (compilation off and on).
- `351_orchards_test.ra` passed its small-orchard test block.
- The intermediate stage passed 12 recursion tests; the two stored-domain tests
  were excluded from that stage and passed in the final version.

New regressions cover independent sieve answers, large exact integers, cache
publication and reuse, index domain changes, protected writes before operand
errors, recursive error locations, callee replacement, depth recovery,
tail-transfer polling, and differing stored domains under unresolved array and
return contracts. The complete `npm test` and corpus-wide checks were not run.
