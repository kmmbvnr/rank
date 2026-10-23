# Dense bounded prime sieve

Issue: [#377](https://github.com/kmmbvnr/rank/issues/377).

Run `npm run build` and `node benchmarks/dense-prime-sieve.mjs`.
Samples are in `baselines/2026-10-23-dense-prime-sieve.jsonl`.
Apple M5, Node v24.15.0; medians of three fresh processes per case.

## Interpreter mechanism

`Limit primesieve` eagerly constructs a bitmap with one bit per odd integer.
`N in Sieve` reads the bitmap without enumerating primes or replacing segments.
The interpreter retains certified, immutable, fully stored finite sequences at
ordinary binding boundaries, including nested records and tuples. Deferred
expressions keep their usual replay semantics. Bounded views share storage.

The lookup workload makes 10,000 deterministic scattered odd queries through
100,000,001. Each individual result is checked against independent trial
division outside the timed section. All variants find 1,169 primes.

| Source | Construction | Queries | Total |
| --- | ---: | ---: | ---: |
| Bounded segmented `primes` | 0.035 ms | 723.262 ms | 723.300 ms |
| Unbounded hybrid `primes` | 0.031 ms | 8.450 ms | 8.478 ms |
| Dense `primesieve` | 92.852 ms | 0.332 ms | 93.184 ms |

Dense queries are about 2,177 times faster than scattered bounded queries and
25 times faster than the hybrid source after construction. Including construction,
this workload is 7.76 times faster than bounded `primes`. The hybrid source is
faster overall for only 10,000 queries; an eager sieve is intended for reuse.
The bitmap retains 6,250,001 bytes (5.96 MiB) at this bound. No prime array or
SPF table is retained. Bitmap memory is an exact buffer size, not process RSS.

## Euler 357 integration

The original source is preserved in `fixtures/357-primegenerating-original.ra`.
The updated demo constructs one sieve through `Limit + 1` and replaces its two
primality membership expressions. Prime candidate generation and the divisor
loop are unchanged. Both variants use the same interpreter.

| Program, Limit = 100,000,000 | Execution including parsing and construction |
| --- | ---: |
| Original | 4,559.646 ms |
| With a dense sieve | 3,665.888 ms |

The program is 1.24 times faster (19.6% less execution time). Every run returns
`1739023853137`. An SPF constructor and a different divisor algorithm were not
needed for this change; SPF is optional in the issue's acceptance criteria.

## Verification

The build passed. Focused interpreter tests cover independent primality oracles,
bounds, numeric membership, cancellation, compiled and ordinary execution,
rebinding, stored nested values, existing prime sequences and binding behavior.
The operation catalogue, generated CLI reference and Euler 357's three reduced
limits also pass. The focused language test recognizes the constructor.

An existing `scalar-dependencies.test.ts` test named `keeps recursion and effectful
callees on the ordinary path` fails unchanged on the original main commit as
well as the candidate. Its trusted sequence membership group passes separately.
The full test suite and corpus audits were not run.
