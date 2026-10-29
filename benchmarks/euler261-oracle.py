"""Compare both Rank engines with direct consecutive square sums."""
import json
from pathlib import Path
import subprocess


def square_sum(n):
    return n * (n + 1) * (2 * n + 1) // 6


def direct_pivots(limit):
    pivots = []
    for k in range(1, limit + 1):
        for m in range(1, k):
            left = square_sum(k) - square_sum(k - m - 1)
            lo, hi = k, 2 * k * k + 1
            while lo < hi:
                n = (lo + hi) // 2
                if square_sum(n + m) - square_sum(n) < left:
                    lo = n + 1
                else:
                    hi = n
            if square_sum(lo + m) - square_sum(lo) == left:
                pivots.append(k)
                break
    return pivots


if __name__ == '__main__':
    pivots = direct_pivots(1000)
    harness = str(Path(__file__).with_name('euler261-pivotalsquare.mjs'))
    checks = 0
    for limit in [0, 3, 4, 21, 24, 110, 250, 500, 1000]:
        expected = sum(k for k in pivots if k <= limit)
        for variant in ['original', 'table']:
            for mode in ['compiled', 'reference']:
                result = json.loads(subprocess.check_output(
                    ['node', harness, str(limit), mode, variant], timeout=60))
                assert int(result['answer']) == expected, (limit, variant, mode, result, expected)
                checks += 1
        print(limit, expected, flush=True)
    print(f'{checks} checks passed')
