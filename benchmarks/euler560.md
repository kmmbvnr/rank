# Euler 560: compact Walsh stages and odd-only frequencies

Base: `59bb00e107d798341204550307758ff755e7cceb`.
The [problem](https://projecteuler.net/problem=560) counts losing Coprime Nim
positions with N-1 possible positive pile sizes and K independent piles.
Full exact answer: **994345168** modulo 1000000007.

The issue's old 15-second exclusion was stale: previous shared improvements
already bring the original compiled program below one second on the Mac.
Measurements below compare against the current base, not that historical figure.

## Demo

The Grundy formula and Walsh-Hadamard method are retained. Even piles have
value zero; pile 1 has value one; an odd larger pile has the one-based index
of its least prime factor. The independent test oracle derives these values
from legal coprime moves and mex, then counts zero-XOR positions by direct DP.

The sieve now represents only odd numbers, halving its live Int32 cells from
10 million to 5 million at the default bound. A library `primesieve` supplies
the total prime count through its bitmap rank index; only primes through the
square root are enumerated. There is no 664k-element array of all primes.
Large primes keep their initial frequency one.

A pure `walsh` helper reshapes the vector to blocks x 2 x half, unpacks the
two halves, and concatenates their sum and difference. A library fold applies
all stages. This avoids whole-vector XOR gathers and sign arrays per stage.
The demo has one explicit nonnested loop, short meaningful names, and no line
above 40 columns. N=1/2 and K=0 now work, including empty-pile-set cases.

## Shared compiler

Pure numeric array functions now publish proved Int32 results directly in a
fresh Int32 destination. Previously each integer result passed through a
Float64 workspace and a BigInt64 conversion. The following call could not
borrow that wide storage, causing alternating compiled and ordinary stages.
Concat propagates its sources' conservative integer bounds, so structural
array helpers retain compact results as well. Wider results keep exact wide
publication; real results retain their Float64 route. No copy-cost/Number-mode
threshold changes are involved.

The XOR-based prototype also exposed missing `band`, `bor` and `bxor` support
in this backend. These operations are now admitted when both integer operands
are proved nonnegative and at most 2^31-1. Their bounds remain conservative;
signed, wider and real operands keep ordinary behavior. Builtin identity,
input/storage guards, error replay and cancellation checks remain in place.
The final demo uses the clearer tensor butterfly rather than the XOR prototype.
The feature is general, with independent permutation and boundary tests.

Five existing numeric-function test failures reproduced on the frozen base:
scalar-call specializations intercepted calls before the backend whose counters
those tests asserted. The fixture now disables the competing scalar function
backend, retaining the same value/error assertions and strict numeric-backend
counters. All 46 tests pass. Default compiler configurations remain covered by
the Euler tests; production dispatch priority is unchanged.

## Measurements

Apple M5 arm64 and Intel i7-10750H x64, Node v24.15.0. Three fresh processes per
combination, alternating old/final/source-only/runtime-only controls. All full
runs use N=K=10000000 and check the answer. Diagnostics/profiling are disabled;
time includes parsing/execution and excludes interpreter import. RSS is the
process high-water mark. No other benchmark, test or compression job from this
session overlapped primary timings on either host.

| Host/mode | Old seconds | New seconds | Old peak RSS MiB | New peak RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac compiled | 0.463 | 0.324 | 339.6 | 318.6 |
| Mac reference | 0.579 | 0.383 | 422.0 | 359.2 |
| Intel compiled | 1.197 | 0.823 | 322.3 | 279.5 |
| Intel reference | 1.498 | 1.031 | 350.3 | 304.0 |

The rewrite and compiler changes complement each other. New source on the old
runtime takes 0.943 s / 460.4 MiB compiled on Mac, and 2.342 s / 457.6 MiB on
Intel: the compact-result fix is necessary to make this array formulation
competitive. The final compiler is about 2.9x faster on that same source, with
substantially lower RSS. New-source reference controls are 0.386 s / 370.3 MiB
and 1.041 s / 305.5 MiB, close to the final reference results as expected.
Old source on the new runtime stays near its baseline time (0.465/0.605 s on
Mac, 1.222/1.479 s on Intel, compiled/reference). This is not a claim that every
old loop benefits from the new function backend.

## Verification

TypeScript build; **233 focused checks on each host** across seven files:
Euler 560, numeric functions, numeric bitwise functions, integer and real array
functions, numeric gcd and integer roots. **Two filtered differential checks
on each host** cover the full demo and fixture. **Two filtered type and two
name-fact checks on Mac** cover the same programs. All 20 Walsh stages execute
as compiled array helpers. Tests check independent legal-move Grundy DP, the
statement fixtures, the full answer in three configurations, signed/wide/real
bitwise fallback, compact chained permutations, unchanged inputs and concat
results crossing both Int32 boundaries. Existing tests retain observer, error
and cancellation coverage. The full demo returns to ordinary corpus execution.
No exhaustive audits/full npm test were run.

```sh
node benchmarks/euler560.mjs compiled
node benchmarks/euler560.mjs reference
node benchmarks/euler560.mjs compiled 10000000 benchmarks/fixtures/euler560-original.ra
RANK560_K=5 node benchmarks/euler560.mjs compiled 10
```

`RANK560_RUNTIME` selects a built interpreter; `RANK560_K` defaults to N.
`RANK560_EXPECTED` checks an answer. `RANK560_DIAGNOSTICS=1` and
`RANK560_PROFILE=path` enable separate instrumented runs. Raw samples and module
hashes: `baselines/2026-11-10-euler560.json`.
