# Project Euler

Mathematical programming problems from [Project Euler](https://projecteuler.net/). Individual examples link to the original problem.

## Folders

- [Problem input files](fixtures/) — Official [Project Euler](https://projecteuler.net/) input files for problems that need external data.

## Scalar loops in problems 121-200

Most solutions are array code. These keep a scalar loop because an
array form would be far slower (estimated from operation counts at
about 0.25 us per element and operation), or because the work is
sequential (a depth-first search or a union-find). Problems 125,
126, 127, 129, 130, 142, 149, 159 and 195 were first written as loops
and then rewritten as array code.

| Problem | Why a loop | Array form |
|---|---|---|
| 141 | 2 x 10^7 candidate squares | ~75 s estimated |
| 150 | 1.7 x 10^8 sub-triangle sums | over 200 s estimated |
| 186 | union-find over 2.3M calls | sequential |
| 193 | Moebius sieve to 2^25 | ~50 s estimated |
| 196 | 5 row strip, neighbour counts | ~100 s estimated |
| 198 | Stern-Brocot walk | sequential |

These costs depend on the operation and whether a loop qualifies for safe Number
registers or uses exact BigInt operations. See issues #307, #308, #309, #311,
#312 and #316.

Euler 150 accumulates its row start once per row. Its read-only search uses
safe Number registers while public integer values remain exact BigInts.
The original and current formulations, runtime-only comparison and differential
coverage audit are recorded in [the integer-loop benchmark](../../benchmarks/number-loops-results.md).

Euler 126 uses stored mask compaction and fused arithmetic updates (#308).
Its layer-generation benchmark and full counting costs are reported separately
in [performance measurements](../../docs/design/performance-measurements.md#stored-mask-materialization-and-compound-arithmetic-308).

Euler 141, 155 and 170 use numeric builtins inside compiled integer loops (#309).
Their old/new formulations and the scalar `gcd` comparison are covered by
[the numeric loop benchmark report](../../benchmarks/numeric-loop-calls-results.md).

Euler 136 consumes the segmented prime source and starts after 2, avoiding an
extra odd-prime mask. Source generation, bounded membership and the complete
demo are timed separately in [the prime sequence benchmark](../../benchmarks/prime-sequences-results.md).

## Problems 201-300

Written: 201-210, 213, 215, 217-222, 224-228, 230-235, 237, 239-240,
242-244, 247, 250, 265-268, 271, 274, 276-278, 281-282, 284-286, 288,
290, 293-294, 297. The others are not written, mostly for the cost of
the array form in Rank:

| Problem | Why not |
|---|---|
| 211, 214, 223 | tables of 4 x 10^7 to 6.4 x 10^7 numbers run out of memory (#339) |
| 212, 238, 249, 258, 259 | minutes or more even in array form: 3-D union volume, tables of 10^8 sums, polynomial powers of degree 2000 |
| 216, 229, 251, 291 | millions of primality tests or of square roots modulo primes |
| 248, 272, 298, 300 | need a map from a key to an array, or about 10^7 states |
| the rest | not attempted |

Demos whose default input takes about a minute keep their tests on smaller
inputs and are left out of the type, name-facts and differential audits:
210 (#333), 224 (#338), 250 (#335), 266 and 268. 213 and 247 take about
40 s and 10 s.
