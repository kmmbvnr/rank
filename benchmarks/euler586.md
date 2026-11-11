# Euler 586 binary quadratic form

Base `f52b3076`. The full answer is **82490213**.
The [problem](https://projecteuler.net/problem=586) asks for values
with exactly R representations as `a² + 3ab + b²`, with `a > b > 0`.

The program keeps the original norm identity. A value
`x * 5^t * u²` contributes when the primes of `x` are 1 or 4 modulo 5,
the primes of `u` are 2 or 3 modulo 5, and the divisor count of `x`
is `2R` or `2R+1`. An ordered factorization of the divisor count
determines the exponents of successive split primes.

Each exponent pattern has a minimum product on the first split
primes. That product determines whether the pattern can contribute.
The minimum prefix bounds the largest prime. The minimum complete
product bounds the factor `5^t * u²`. On the full input, these
limits are 3,998,673 and 97,528. The prime list comes from the native
sieve. Its supported bound applies to large custom inputs.

For a partial product, the cheapest suffix starting at a candidate
prime uses consecutive split primes. Those costs form a sorted
vector. Upper-index queries find the feasible choices for every
partial product at once. A prefix scan expands the feasible rows.
At the last exponent, the program counts the interval of primes for
each scale. It counts the unit scale in a separate batch. The
Rank source uses recursion over exponent positions and array operations.

## Measurements

Node 24.15.0. Full runs use medians of three alternating pairs in fresh
processes. The two statement inputs are single paired controls.
The Intel host also ran another Node workload.

| Host and mode | N | Before (s) | After (s) | Before RSS (MiB) | After RSS (MiB) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Apple M5 compiled | 1000000000000000 | 0.319 | 0.482 | 288.9 | 324.4 |
| Apple M5 reference | 1000000000000000 | 7.608 | 0.463 | 552.1 | 328.9 |
| Apple M5 reference | 100000 | 3.563 | 0.202 | 428.3 | 193.6 |
| Apple M5 reference | 100000000 | 3.600 | 0.227 | 437.6 | 204.8 |
| Intel i7-10750H compiled | 1000000000000000 | 0.876 | 1.578 | 281.8 | 312.9 |
| Intel i7-10750H reference | 1000000000000000 | 27.868 | 1.508 | 530.7 | 319.4 |
| Intel i7-10750H reference | 100000 | 10.966 | 0.583 | 417.4 | 181.3 |
| Intel i7-10750H reference | 100000000 | 11.183 | 0.677 | 419.8 | 184.8 |

Reference time and memory fall on all three inputs. Full compiled
time and peak memory rise. Both modes together take much less time.
A separate compiler observation recorded 594 framed function
executions and 1,757,900 batched sorted index queries on the full input.

26 focused checks pass on each host, including direct enumeration
above the previous prime bound. The two filtered Mac differential
cases cover the demo and fixture. The TypeScript build, 25 framed
function checks on each host, and five execution policy checks pass.

## Reproduction

```sh
node benchmarks/euler586.mjs compiled
node benchmarks/euler586.mjs reference
node benchmarks/euler586.mjs reference 100000 4
node benchmarks/euler586.mjs reference 100000000 6
node benchmarks/euler586.mjs reference 1000000000000000 40 benchmarks/fixtures/euler586-original.ra
```

The driver includes parsing and execution, checks the answer and
records process peak RSS.

Raw samples are in [the benchmark record](baselines/2026-11-11-euler586.json).
