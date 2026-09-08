# Project Euler examples

Project Euler stress-tests Rank's numerical, sequence and array semantics.

## 1. Multiples of 3 or 5

```rank
rem Project Euler 1
rem Multiples of 3 or 5
rem https://projecteuler.net/problem=1

N = 1 until 1000

M3 = N % 3 equal 0
M5 = N % 5 equal 0

Answer = N (M3 or M5) sum

print Answer
```

This example demonstrates:
- the ordinary/lazy sequence `1 until 1000`;
- elementwise `%`;
- elementwise `equal`;
- boolean masks as first-class values;
- boolean `or`;
- boolean addressing;
- the `sum` reduction.

This example intentionally uses mask composition rather than the table-oriented
source clause syntax.
