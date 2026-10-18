# Project Euler

Mathematical programming problems from [Project Euler](https://projecteuler.net/). Individual examples link to the original problem.

## Folders

- [Problem input files](fixtures/) — Official [Project Euler](https://projecteuler.net/) input files for problems that need external data.

## Scalar loops in problems 121-200

Most solutions are array code. These keep a scalar loop because the
array form was measured and is far slower, or because the work is
sequential (a recurrence, a depth-first search or a union-find).

| Problem | Why a loop | Array form tried |
|---|---|---|
| 141 | 2 x 10^7 candidate squares | not run, ~75 s estimated |
| 149 | Kadane along 12000 lines | 134 s against 4 s |
| 150 | 1.7 x 10^8 sub-triangle sums | not run, over 200 s estimated |
| 186 | union-find over 2.3M calls | sequential |
| 193 | Moebius sieve to 2^25 | not run, ~50 s estimated |
| 196 | 5 row strip, neighbour counts | not run, ~100 s estimated |
| 198 | Stern-Brocot walk | sequential |

The speed gaps come from per-element costs of array operations and
BigInt based compiled loops, see issues #307, #308, #309, #311, #312
and #316.
