"""Independent exact Euler 343 oracle: sieve by primes and modular roots.

Unlike the Rank program, discover roots with modular exponentiation, process
primes in order, and leave the final prime cofactor for a separate final pass.
Run: python3 benchmarks/quadratic-factors-oracle.py 2000000
"""
from array import array
from math import isqrt
import json
import sys
import time

limit = int(sys.argv[1]) if len(sys.argv) > 1 else 10000
assert 1 <= limit <= 2000000
start = time.perf_counter()
composite = bytearray(limit + 2)
for p in range(2, isqrt(limit + 1) + 1):
    if not composite[p]:
        composite[p*p::p] = b'\1' * len(composite[p*p::p])
rest = array('Q', (k*k-k+1 for k in range(limit + 1)))
quadratic = array('Q', [1]) * (limit + 1)
linear = array('Q', [1]) * (limit + 2)
for p in range(2, limit + 2):
    if composite[p]:
        continue
    for k in range(p, limit + 2, p):
        linear[k] = p
    if p == 3:
        roots = [2]
    elif p % 3 == 1:
        # Nontrivial cube roots w of unity give quadratic roots -w.
        base = 2
        w = pow(base, (p-1)//3, p)
        while w == 1:
            base += 1
            w = pow(base, (p-1)//3, p)
        roots = [p-w, p-(w*w % p)]
    else:
        continue
    for root in roots:
        for k in range(root, limit + 1, p):
            assert rest[k] % p == 0
            quadratic[k] = p
            while rest[k] % p == 0:
                rest[k] //= p
answer = sum(max(linear[k+1], quadratic[k], rest[k]) - 1 for k in range(1, limit + 1))
print(json.dumps(dict(limit=limit, answer=str(answer), seconds=time.perf_counter()-start)))
