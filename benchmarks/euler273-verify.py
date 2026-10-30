"""Independent direct-square oracle for the Euler 273 experiment."""
import json
import math
import os
import subprocess


def oracle(limit):
    primes = [p for p in range(5, limit, 4)
              if all(p % d for d in range(2, math.isqrt(p) + 1))]
    products = [1]
    for prime in primes:
        products += [n * prime for n in products]
    answer = 0
    for n in products[1:]:
        for a in range(1, math.isqrt(n // 2) + 1):
            b2 = n - a * a
            b = math.isqrt(b2)
            if b * b == b2:
                answer += a
    return str(answer)


for limit in [1, 5, 6, 13, 14, 17, 18, 20, 29, 30, 37, 38, 40, 53, 54, 60]:
    expected = oracle(limit)
    for variant in os.environ.get('VARIANTS', 'original,prefix,shipping').split(','):
        for mode in ['compiled', 'reference']:
            result = subprocess.run(
                ['node', 'benchmarks/euler273-investigation.mjs', mode, variant, str(limit)],
                capture_output=True, text=True, check=True, timeout=60,
            )
            actual = json.loads(result.stdout)
            assert actual['answer'] == expected, (limit, variant, mode, expected, actual)
            print(json.dumps({'limit': limit, 'variant': variant, 'mode': mode,
                              'answer': expected, 'passed': True}), flush=True)
