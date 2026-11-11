# Euler 524 First Sort II

Base `43d5ad4b`. The full answer is **2432925835413407847**.
The [problem](https://projecteuler.net/problem=524) asks for the least
lexicographic permutation rank whose First Sort cost is 12^12.

The program retains the original binary-score construction. Each
nonrecord value contributes 2^s, where s smaller values precede it.
An identity prefix doubles the cost while preserving the permutation
rank. Removing the power of two leaves an odd cost. Its construction
has one more element than the bit length and assigns each set bit once.

## Completion check

Let the nonempty prefix use u values, with maximum h. Its free
values below h are forced nonrecords. Let their number be f. For
such a value x, its score lies between the number of used values
below x and x. Both bounds increase with x, so matching the f
smallest remaining bit positions to these values is sufficient.
Any crossing match can be swapped into this order.

All remaining free values are above h. Let H be their count and
r the number of bits left after the forced matches. If r is positive,
completion requires r < H, since the largest free value is a record.
Every remaining bit position must also be at least u and at most N-2.

For sufficiency, write the remaining positions as b_j in increasing
order. Assign them to values x_j = max(h+1+j, b_j). These values
increase strictly and lie below the largest free value. Give the
remaining upper values successive record scores starting at u. The lower
score constraint is b_j >= u + x_j - (h+1) - j. It follows from
b_j >= u when x_j = h+1+j, and from h+1+j >= u otherwise.

This replaces the recursive subset search and its mutable failure
set. The implementation uses array interval checks and greedily
chooses the first feasible value. It handles zero cost directly and
uses arbitrary-precision masks.

A separate exhaustive comparison checked 86,868 completion states
through eight values against the previous recurrence. The automated
tests run First Sort itself on every permutation through eight values
and compare all 128 resulting minimum ranks in both execution modes.
They also cover 80-bit costs, a 120-bit identity prefix and the exact
full rank.

## Measurements

Node 24.15.0. The baseline is one fresh-process control per mode.
New results are medians of three fresh processes. Raw records
include load and CPU time. Intel also ran another Node workload.

| Host and mode | Before (s) | After (s) | Before RSS (MiB) | After RSS (MiB) |
| --- | ---: | ---: | ---: | ---: |
| Apple M5 compiled | 21.045 | 0.207 | 594.6 | 193.3 |
| Apple M5 reference | 21.367 | 0.199 | 1470.5 | 190.9 |
| Intel i7-10750H compiled | 93.809 | 0.551 | 720.3 | 178.9 |
| Intel i7-10750H reference | 93.492 | 0.543 | 566.3 | 178.3 |

All 20 focused tests passed on each host. The two filtered Mac
differential cases passed with the full demo restored to ordinary
corpus execution. The fixture now includes the exact full answer.
The TypeScript build and five execution policy checks passed.

## Reproduction

```sh
node benchmarks/euler524.mjs compiled
node benchmarks/euler524.mjs reference
node benchmarks/euler524.mjs compiled 1001
node benchmarks/euler524.mjs compiled 8916100448256 benchmarks/fixtures/euler524-original.ra
```

The driver includes parsing and execution and records process peak RSS.

Raw samples are in [the benchmark record](baselines/2026-11-11-euler524.json).
