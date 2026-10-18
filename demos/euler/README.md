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

The speed gaps come from per-element costs of array operations and
BigInt based compiled loops, see issues #307, #308, #309, #311, #312
and #316.

Euler 126 uses stored mask compaction and fused arithmetic updates (#308).
Its layer-generation benchmark and full counting costs are reported separately
in [performance measurements](../../docs/design/performance-measurements.md#stored-mask-materialization-and-compound-arithmetic-308).

Euler 141, 155 and 170 use numeric builtins inside compiled integer loops (#309).
Their old/new formulations and the scalar `gcd` comparison are covered by
[the numeric loop benchmark report](../../benchmarks/numeric-loop-calls-results.md).
